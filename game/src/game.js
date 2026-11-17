// Vice Shores game state: the player on foot or in a car, the wanted system,
// police, four story missions, shooting, pickups, HUD, minimap, day/night and
// save/continue. The renderer and input live in main.js; this class owns the rules.

import * as THREE from '../vendor/three.module.min.js';
import { makeRng, range, pick, clamp, angleDiff, dist2 } from './rng.js';
import { CITY, buildCity, collideCircle, nearestRoad } from './city.js';
import { Car, Ped, Pickup, spawnTrafficCar, randomStreetSpot } from './entities.js';
import { SoundBank } from './audio.js';

const SAVE_KEY = 'vice-shores-save-v1';
const SEED = 20261117;

const MISSIONS = [
  {
    name: 'Hot Wheels', brief: 'Steal the yellow sports car and bring it to the garage.',
    steps: ['Go to the yellow sports car', 'Steal the car (press E)', 'Drive it to the garage marker'],
  },
  {
    name: 'The Pickup', brief: 'Grab the package from the alley, then drop it at the pier. The cops will notice.',
    steps: ['Go to the alley pickup', 'Grab the package (press E)', 'Deliver it to the pier — wanted level 2'],
  },
  {
    name: 'Street Heat', brief: 'Rival crew owns the plaza. Hold the plaza for 60 seconds.',
    steps: ['Go to the plaza', 'Hold the plaza — survive 60 seconds'],
  },
  {
    name: 'The Big Score', brief: 'Rob the downtown bank, then lose the heat at the pier.',
    steps: ['Go to the bank', 'Hold E at the vault door to crack it', 'Getaway to the pier with 4 stars'],
  },
];

const GARAGE = { x: 120, z: -120 };
const ALLEY = { x: -120, z: 40 };
const PLAZA = { x: 0, z: -80 };
const BANK = { x: -20, z: -20 };
const PIER_END = { x: 0, z: 235 };

function makePlayerMesh() {
  const g = new THREE.Group();
  const jacket = new THREE.MeshLambertMaterial({ color: 0x1e6f8e });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.05, 0.45), jacket);
  body.position.y = 1.05;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55),
    new THREE.MeshLambertMaterial({ color: 0xe8b88a }));
  head.position.y = 1.9;
  g.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.22, 0.58),
    new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
  hair.position.y = 2.2;
  g.add(hair);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x22223a });
  g.userData.legL = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.85, 0.36), legMat);
  g.userData.legL.position.set(-0.22, 0.42, 0);
  g.add(g.userData.legL);
  g.userData.legR = g.userData.legL.clone();
  g.userData.legR.position.x = 0.22;
  g.add(g.userData.legR);
  g.userData.armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.85, 0.2), jacket);
  g.userData.armL.position.set(-0.55, 1.05, 0);
  g.add(g.userData.armL);
  g.userData.armR = g.userData.armL.clone();
  g.userData.armR.position.x = 0.55;
  g.add(g.userData.armR);
  // A simple pistol in the right hand when armed.
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x111111 }));
  gun.position.set(0.55, 0.7, 0.25);
  g.add(gun);
  return g;
}

export class Game {
  constructor(scene, camera, hud, opts = {}) {
    this.scene = scene;
    this.camera = camera;
    this.hud = hud; // DOM element ids wired in main.js via hud object
    this.rng = makeRng(SEED);
    this.city = buildCity(scene, SEED);
    this.sounds = new SoundBank();
    this.clock = new THREE.Clock();
    this.time = 0;
    this.dayTime = 0.35; // 0..1 across a 4-minute day
    this.paused = false;
    this.started = false;
    this.over = null; // 'BUSTED' | 'WASTED' | null
    this.overTimer = 0;

    // Player state.
    this.cash = 250;
    this.health = 100;
    this.armor = 0;
    this.wanted = 0;
    this.ammo = 12;
    this.ammoReserve = 48;
    this.reloading = 0;
    this.score = 0;
    this.kills = 0;
    this.player = {
      x: 0, z: 20, heading: Math.PI, speed: 0,
      mesh: makePlayerMesh(), walkPhase: 0, onFoot: true,
    };
    this.player.mesh.position.set(0, 0, 20);
    scene.add(this.player.mesh);

    this.car = null;          // car the player is driving
    this.cars = [];           // traffic + parked + police
    this.peds = [];
    this.police = [];
    this.officers = [];
    this.rivals = [];
    this.pickups = [];
    this.lastCrime = -999;
    this.bustTimer = 0;
    this.shootCooldown = 0;
    this.heatTimer = 0;

    // Mission state.
    this.missionIndex = 0;
    this.missionStep = 0;
    this.missionDone = false;
    this.holdTimer = 0;       // holdout / vault progress
    this.hasPackage = false;
    this.targetCar = null;    // mission 1 sports car

    // Lights: sun + ambient + a hemisphere for the sky.
    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
    this.sun.position.set(120, 180, 60);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -220; this.sun.shadow.camera.right = 220;
    this.sun.shadow.camera.top = 220; this.sun.shadow.camera.bottom = -220;
    scene.add(this.sun);
    this.ambient = new THREE.AmbientLight(0x8899bb, 0.55);
    scene.add(this.ambient);
    scene.fog = new THREE.Fog(0x87a8c8, 260, 620);
    scene.background = new THREE.Color(0x87a8c8);

    // Mission beacon: a glowing column + a floating marker.
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 60, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
    this.beacon.position.y = 30;
    scene.add(this.beacon);
    this.marker = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0),
      new THREE.MeshBasicMaterial({ color: 0xffd23a }));
    scene.add(this.marker);
    this.markerTarget = null;

    this.spawnWorld(opts.shot);
    this.updateMissionMarker();
    this.hud.setObjective(this.currentObjective());
    this.hud.setCash(this.cash);
    this.hud.setStars(this.wanted); // staged shots may already carry heat
  }

  spawnWorld(shot) {
    const rng = this.rng;
    // Parked cars the player can steal, scattered on road edges.
    for (let i = 0; i < 14; i++) {
      const spot = randomStreetSpot(rng, this.city.roadXs);
      const c = new Car(this.scene, spot.x, spot.z, rng() * Math.PI * 2,
        pick(rng, [0xc23b2e, 0x2e6bc2, 0xd8b83a, 0x3aa84f, 0xd8d8d8]), { maxSpeed: 26 });
      c.speed = 0;
      this.cars.push(c);
    }
    // The mission-1 sports car: bright yellow, parked on the east edge of the
    // x=40 road near the start so the first mission reads clearly.
    this.targetCar = new Car(this.scene, 44, 24, Math.PI / 2, 0xf2d13a, { maxSpeed: 34 });
    this.cars.push(this.targetCar);
    // Traffic.
    for (let i = 0; i < 12; i++) this.cars.push(spawnTrafficCar(this.scene, rng, this.city.colliders));
    // Pedestrians.
    for (let i = 0; i < 26; i++) {
      const spot = randomStreetSpot(rng, this.city.roadXs);
      this.peds.push(new Ped(this.scene, rng, spot.x, spot.z));
    }
    // Pickups: cash on the streets, health near the hospital, armour downtown.
    const pickupSpots = [
      ['cash', 60, 60], ['cash', -80, 80], ['cash', 80, -40], ['cash', -40, -120],
      ['cash', 140, 40], ['health', 0, -140], ['health', -140, -60], ['armor', 40, 0],
      ['armor', -60, 120], ['cash', 160, 120],
    ];
    for (const [kind, x, z] of pickupSpots) this.pickups.push(new Pickup(this.scene, rng, kind, x, z));

    // Deterministic screenshot setups.
    if (shot === 'drive') {
      this.started = true;
      this.enterCar(this.cars[0]);
      this.car.speed = 18;
      this.player.heading = Math.PI / 2;
      this.car.heading = Math.PI / 2;
      this.car.x = -60; this.car.z = 40;
      this.car.syncMesh();
    } else if (shot === 'chase') {
      this.started = true;
      this.enterCar(this.cars[0]);
      this.car.x = -80; this.car.z = 40;
      this.car.heading = Math.PI / 2;
      this.car.speed = 20;
      this.car.syncMesh();
      this.setWanted(3);
      this.spawnPolice();
      // Two cruisers ahead in frame, closing in on the player.
      this.police[0].x = -55; this.police[0].z = 44; this.police[0].syncMesh();
      this.police[1].x = -30; this.police[1].z = 36; this.police[1].syncMesh();
    } else if (shot === 'mission') {
      this.started = true;
      this.missionIndex = 0; this.missionStep = 0;
      // On foot on the x=40 road, facing north up the road at the yellow car
      // and its beacon.
      this.player.x = 44; this.player.z = 52;
      this.player.heading = Math.PI;
      this.player.mesh.position.set(44, 0, 52);
      this.player.mesh.rotation.y = Math.PI;
      this.updateMissionMarker();
    }
  }

  // ----- missions -------------------------------------------------------

  currentMission() { return MISSIONS[this.missionIndex] || null; }
  currentObjective() {
    const m = this.currentMission();
    if (!m) return 'Free roam — Vice Shores is yours. Grab cash, steal cars, stay out of jail.';
    return `${m.name}: ${m.steps[this.missionStep] || m.brief}`;
  }

  missionTargetPos() {
    const i = this.missionIndex, s = this.missionStep;
    if (i === 0) return s === 0 ? { x: 44, z: 24 } : s === 1 ? { x: 44, z: 24 } : GARAGE;
    if (i === 1) return s === 0 ? ALLEY : s === 1 ? ALLEY : PIER_END;
    if (i === 2) return PLAZA;
    if (i === 3) return s === 0 ? BANK : s === 1 ? BANK : PIER_END;
    return null;
  }

  updateMissionMarker() {
    const t = this.missionTargetPos();
    this.markerTarget = t;
    if (!t) { this.beacon.visible = false; this.marker.visible = false; return; }
    this.beacon.visible = true;
    this.marker.visible = true;
    this.beacon.position.set(t.x, 30, t.z);
    this.marker.position.set(t.x, 6, t.z);
  }

  advanceMission() {
    const m = this.currentMission();
    if (!m) return;
    this.missionStep++;
    if (this.missionStep >= m.steps.length) {
      const reward = [800, 1200, 1500, 5000][this.missionIndex];
      this.cash += reward;
      this.score += reward;
      this.hud.toast(`Mission complete: ${m.name} — +$${reward}`);
      this.hud.setCash(this.cash);
      this.sounds.blip(880, 0.25, 'sine', 0.2);
      this.sounds.blip(1320, 0.3, 'sine', 0.15);
      this.missionIndex++;
      this.missionStep = 0;
      this.hasPackage = false;
      this.holdTimer = 0;
      if (this.missionIndex >= MISSIONS.length) {
        this.missionDone = true;
        this.hud.toast('All missions complete! Free roam — Vice Shores is yours.');
      }
    }
    this.updateMissionMarker();
    this.hud.setObjective(this.currentObjective());
  }

  // ----- wanted / police ------------------------------------------------

  setWanted(n) {
    this.wanted = clamp(n, 0, 5);
    this.hud.setStars(this.wanted);
    this.sounds.setSiren(this.wanted > 0);
  }

  commitCrime(level) {
    this.setWanted(Math.max(this.wanted, level));
    this.lastCrime = this.time;
  }

  spawnPolice() {
    while (this.police.length < Math.min(this.wanted + 1, 5)) {
      const a = this.rng() * Math.PI * 2;
      const px = clamp(this.player.x + Math.sin(a) * 70, -180, 180);
      const pz = clamp(this.player.z + Math.cos(a) * 70, -180, 180);
      const car = new Car(this.scene, px, pz, 0, 0x111111, { police: true, maxSpeed: 30 + this.wanted });
      this.cars.push(car);
      this.police.push(car);
    }
  }

  updatePolice(dt) {
    const px = this.player.x, pz = this.player.z;
    if (this.wanted > 0) {
      this.spawnPolice();
      // Heat fades if the player stays clean and out of sight.
      if (this.time - this.lastCrime > 25) {
        this.heatTimer += dt;
        if (this.heatTimer > 12) { this.heatTimer = 0; this.setWanted(this.wanted - 1); }
      } else this.heatTimer = 0;
    } else if (this.police.length) {
      // No heat: cruisers give up and drive off.
      for (const p of this.police) p.remove(this.scene);
      this.police = [];
      this.cars = this.cars.filter(c => !c.police);
    }
    for (const p of this.police) {
      if (p.dead) continue;
      const d = Math.sqrt(dist2(p.x, p.z, px, pz));
      const want = Math.atan2(px - p.x, pz - p.z);
      p.heading += clamp(angleDiff(p.heading, want), -2.4 * dt, 2.4 * dt);
      const target = d > 10 ? 30 : 12;
      p.speed += clamp(target - p.speed, -26 * dt, 18 * dt);
      const nx = p.x + Math.sin(p.heading) * p.speed * dt;
      const nz = p.z + Math.cos(p.heading) * p.speed * dt;
      const res = collideCircle(nx, nz, 1.9, this.city.colliders);
      p.x = res.x; p.z = res.z;
      if (d < 3.4) {
        // Ram: shove the player's car / hurt the player on foot.
        if (this.car) {
          this.car.speed *= 0.6;
          this.car.x += Math.sin(p.heading) * 1.2;
          this.car.z += Math.cos(p.heading) * 1.2;
        } else this.damage(6 * dt * 10, 'police');
        if (Math.random() < 0.02) this.sounds.crash();
      }
      p.syncMesh();
      if (p.mesh.userData.lightBar) {
        p.mesh.userData.lightBar.material.color.setHex(Math.sin(this.time * 10) > 0 ? 0xff2222 : 0x2244ff);
      }
    }
    // Foot officers at 3+ stars: they close in and arrest a slow player.
    if (this.wanted >= 3 && this.player.onFoot) {
      if (this.officers.length < 2 && Math.random() < 0.005) {
        const a = this.rng() * Math.PI * 2;
        const o = new Ped(this.scene, this.rng, px + Math.sin(a) * 25, pz + Math.cos(a) * 25);
        o.speed = 4.2;
        this.officers.push(o);
      }
      for (const o of this.officers) {
        const d = Math.sqrt(dist2(o.x, o.z, px, pz));
        o.heading = Math.atan2(px - o.x, pz - o.z);
        o.speed = 4.2;
        o.update(dt, null, this.city.colliders);
        if (d < 1.6) {
          this.bustTimer += dt;
          if (this.bustTimer > 1.6) this.gameOver('BUSTED');
        } else this.bustTimer = Math.max(0, this.bustTimer - dt);
      }
    }
  }

  // ----- damage / death -------------------------------------------------

  damage(amount, source) {
    if (this.over) return;
    let rest = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, rest);
      this.armor -= absorbed; rest -= absorbed;
    }
    this.health -= rest;
    this.hud.setHealth(this.health, this.armor);
    if (this.health <= 0) this.gameOver('WASTED');
  }

  gameOver(kind) {
    this.over = kind;
    this.overTimer = 0;
    this.hud.showOver(kind);
    this.sounds.setSiren(false);
    this.sounds.setEngine(0, false);
  }

  respawn() {
    const fine = Math.min(this.cash, 500);
    this.cash -= fine;
    this.health = 100;
    this.armor = 0;
    this.setWanted(0);
    this.player.x = 0; this.player.z = -140;
    this.player.heading = Math.PI;
    if (this.car) { this.car = null; this.player.onFoot = true; }
    this.player.mesh.visible = true;
    this.over = null;
    this.hud.hideOver();
    this.hud.setCash(this.cash);
    this.hud.setHealth(100, 0);
    this.hud.toast(fine > 0 ? `Released — hospital bill $${fine}.` : 'Released.');
    this.save();
  }

  // ----- cars -----------------------------------------------------------

  nearestCar(maxD = 6) {
    let best = null, bd = maxD * maxD;
    for (const c of this.cars) {
      if (c.dead || c.police) continue;
      const d2 = dist2(this.player.x, this.player.z, c.x, c.z);
      if (d2 < bd) { bd = d2; best = c; }
    }
    return best;
  }

  enterCar(car) {
    this.car = car;
    this.player.onFoot = false;
    this.player.mesh.visible = false;
    if (!car.stolen) {
      car.stolen = true;
      this.commitCrime(1);
      this.hud.toast('Car stolen — the cops noticed.');
    }
    this.sounds.blip(330, 0.1, 'square', 0.1);
  }

  exitCar() {
    if (!this.car) return;
    const c = this.car;
    c.speed = 0;
    this.player.x = c.x + Math.sin(c.heading + Math.PI / 2) * 3;
    this.player.z = c.z + Math.cos(c.heading + Math.PI / 2) * 3;
    this.player.heading = c.heading;
    this.player.mesh.position.set(this.player.x, 0, this.player.z);
    this.player.mesh.visible = true;
    this.player.onFoot = true;
    this.car = null;
    this.sounds.setEngine(0, false);
  }

  // ----- shooting -------------------------------------------------------

  shoot() {
    if (!this.player.onFoot || this.reloading > 0 || this.shootCooldown > 0) return;
    if (this.ammo <= 0) { this.reload(); return; }
    this.ammo--;
    this.shootCooldown = 0.28;
    this.sounds.gunshot();
    this.hud.setAmmo(this.ammo, this.ammoReserve);
    // Raycast from the player along the facing direction.
    const origin = new THREE.Vector3(this.player.x, 1.4, this.player.z);
    const dir = new THREE.Vector3(Math.sin(this.player.heading), 0, Math.cos(this.player.heading));
    const ray = new THREE.Raycaster(origin, dir, 0.1, 70);
    const targets = [];
    for (const p of [...this.peds, ...this.officers, ...this.rivals]) {
      if (!p.dead) targets.push(p.mesh);
    }
    for (const c of this.cars) if (!c.dead) targets.push(c.mesh);
    const hits = ray.intersectObjects(targets, true);
    let hitPed = null;
    if (hits.length) {
      let obj = hits[0].object;
      while (obj.parent && obj.parent !== this.scene) obj = obj.parent;
      hitPed = [...this.peds, ...this.officers, ...this.rivals].find(p => p.mesh === obj);
      const hitCar = this.cars.find(c => c.mesh === obj);
      if (hitPed) {
        hitPed.remove(this.scene);
        this.kills++;
        this.cash += 25;
        this.hud.setCash(this.cash);
        this.commitCrime(hitPed === this.rivals.find(r => r === hitPed) ? 0 : 1);
        if (this.rivals.includes(hitPed)) this.rivals = this.rivals.filter(r => r !== hitPed);
      } else if (hitCar && hitCar.police) {
        this.commitCrime(2);
        this.hud.toast('You shot at a cop car!');
      }
    }
    // Muzzle flash + tracer feedback via the HUD crosshair pulse.
    this.hud.pulseCrosshair();
  }

  reload() {
    if (this.reloading > 0 || this.ammoReserve <= 0 || this.ammo >= 12) return;
    this.reloading = 1.1;
    this.hud.toast('Reloading…');
  }

  // ----- main update ----------------------------------------------------

  update(dt, input) {
    if (this.paused || this.over) {
      if (this.over) {
        this.overTimer += dt;
        if (this.overTimer > 2.2 && input.anyKey) this.respawn();
      }
      return;
    }
    this.time += dt;
    this.dayTime = (this.dayTime + dt / 240) % 1;
    this.shootCooldown = Math.max(0, this.shootCooldown - dt);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const take = Math.min(12 - this.ammo, this.ammoReserve);
        this.ammo += take; this.ammoReserve -= take;
        this.hud.setAmmo(this.ammo, this.ammoReserve);
      }
    }

    const p = this.player;
    if (this.car) {
      const c = this.car;
      const throttle = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
      const steer = (input.left ? 1 : 0) + (input.right ? -1 : 0);
      c.drive(dt, { throttle, steer, brake: input.brake }, this.city.colliders);
      p.x = c.x; p.z = c.z; p.heading = c.heading;
      this.sounds.setEngine(Math.abs(c.speed) / c.maxSpeed, true);
      this.sounds.sirenTick(this.time);
      this.hud.setSpeed(Math.round(Math.abs(c.speed) * 3.6));
      if (input.interact) this.exitCar();
      // Running over a pedestrian is a crime.
      for (const ped of this.peds) {
        if (!ped.dead && dist2(c.x, c.z, ped.x, ped.z) < 4 && Math.abs(c.speed) > 5) {
          ped.remove(this.scene);
          this.commitCrime(1);
          this.hud.toast('You hit a pedestrian!');
          this.sounds.crash();
          c.speed *= 0.6;
        }
      }
    } else {
      // On foot: WASD moves relative to camera yaw (input.yaw), mouse aims.
      const move = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
      const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      const run = input.run ? 9 : 5;
      const yaw = input.yaw;
      const mx = Math.sin(yaw) * move - Math.cos(yaw) * strafe;
      const mz = Math.cos(yaw) * move + Math.sin(yaw) * strafe;
      const len = Math.hypot(mx, mz);
      if (len > 0.01) {
        const nx = p.x + (mx / len) * run * dt;
        const nz = p.z + (mz / len) * run * dt;
        const res = collideCircle(nx, nz, 0.6, this.city.colliders);
        p.x = clamp(res.x, -CITY.half, CITY.half);
        p.z = clamp(res.z, -CITY.half, CITY.half);
        p.heading = Math.atan2(mx, mz);
        p.walkPhase += dt * 9;
      }
      p.mesh.position.set(p.x, 0, p.z);
      p.mesh.rotation.y = p.heading;
      const swing = len > 0.01 ? Math.sin(p.walkPhase) * 0.5 : 0;
      p.mesh.userData.legL.rotation.x = swing;
      p.mesh.userData.legR.rotation.x = -swing;
      p.mesh.userData.armL.rotation.x = -swing;
      p.mesh.userData.armR.rotation.x = swing;
      this.sounds.setEngine(0, false);
      this.hud.setSpeed(0);
      if (input.interact) {
        const car = this.nearestCar();
        if (car) this.enterCar(car);
      }
      if (input.shoot) this.shoot();
      if (input.reloadKey) this.reload();
    }

    // Traffic + pedestrians.
    for (const c of this.cars) {
      if (c.dead || c === this.car || c.police) continue;
      c.cruise(dt, this.city.colliders, this.cars);
    }
    const danger = input.shotFired ? { x: p.x, z: p.z } : null;
    for (const ped of this.peds) if (!ped.dead) ped.update(dt, danger, this.city.colliders);
    for (const pk of this.pickups) pk.update(dt);

    // Pickups.
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      if (dist2(p.x, p.z, pk.x, pk.z) < 4.5) {
        pk.take(this.scene);
        if (pk.kind === 'cash') { this.cash += 100; this.hud.setCash(this.cash); this.hud.toast('+$100 cash'); }
        if (pk.kind === 'health') { this.health = 100; this.hud.setHealth(100, this.armor); this.hud.toast('Health restored'); }
        if (pk.kind === 'armor') { this.armor = 100; this.hud.setHealth(this.health, 100); this.hud.toast('Armour fitted'); }
        this.sounds.blip(990, 0.15, 'sine', 0.15);
        // Respawn a fresh pickup elsewhere after a while.
        setTimeout(() => {
          const spot = randomStreetSpot(this.rng, this.city.roadXs);
          this.pickups.push(new Pickup(this.scene, this.rng, pk.kind, spot.x, spot.z));
        }, 20000);
      }
    }

    this.updatePolice(dt);
    this.updateMission(dt, input);
    this.updateRivals(dt);
    this.updateDayNight();
    this.hud.setClock(this.dayTime);
    this.hud.updateMinimap(this);
    // Marker bob.
    if (this.marker.visible) {
      this.marker.rotation.y += dt * 2;
      this.marker.position.y = 6 + Math.sin(this.time * 2.5) * 0.6;
      this.beacon.material.opacity = 0.28 + Math.sin(this.time * 2.5) * 0.1;
    }
    if (this.time % 1 < dt) this.save();
  }

  updateRivals(dt) {
    for (const r of this.rivals) {
      if (r.dead) continue;
      const d = Math.sqrt(dist2(r.x, r.z, this.player.x, this.player.z));
      if (d < 46) {
        r.heading = Math.atan2(this.player.x - r.x, this.player.z - r.z);
        r.speed = d > 12 ? 3.6 : 0;
        r.update(dt, null, this.city.colliders);
        if (d < 40 && Math.random() < dt * 0.5) {
          this.damage(4, 'rival');
          this.sounds.gunshot();
          this.hud.toast('Taking fire!');
        }
      }
    }
    this.rivals = this.rivals.filter(r => !r.dead);
  }

  updateMission(dt, input) {
    const m = this.currentMission();
    if (!m) return;
    const p = this.player;
    const t = this.missionTargetPos();
    const near = t && dist2(p.x, p.z, t.x, t.z) < 100; // within 10 units
    const i = this.missionIndex, s = this.missionStep;
    if (i === 0) {
      if (s === 0 && near) { this.missionStep = 1; this.hud.setObjective(this.currentObjective()); this.hud.toast('That yellow car is yours. Press E.'); }
      else if (s === 1 && this.car === this.targetCar) { this.missionStep = 2; this.updateMissionMarker(); this.hud.setObjective(this.currentObjective()); }
      else if (s === 2 && near && this.car === this.targetCar) this.advanceMission();
    } else if (i === 1) {
      if (s === 0 && near) { this.missionStep = 1; this.hud.setObjective(this.currentObjective()); this.hud.toast('Grab the package — press E.'); }
      else if (s === 1 && near && input.interact) {
        this.hasPackage = true; this.missionStep = 2; this.setWanted(2);
        this.updateMissionMarker(); this.hud.setObjective(this.currentObjective());
        this.hud.toast('Package grabbed. Lose the heat at the pier!');
      } else if (s === 2 && near) this.advanceMission();
    } else if (i === 2) {
      if (s === 0 && near) {
        this.missionStep = 1;
        this.hud.setObjective(this.currentObjective());
        this.hud.toast('Hold the plaza — 60 seconds!');
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          const rv = new Ped(this.scene, this.rng, PLAZA.x + Math.sin(a) * 22, PLAZA.z + Math.cos(a) * 22);
          rv.speed = 3.6;
          this.rivals.push(rv);
        }
      } else if (s === 1) {
        if (!near) { this.holdTimer = Math.max(0, this.holdTimer - dt); }
        else {
          this.holdTimer += dt;
          this.hud.setObjective(`Street Heat: hold the plaza — ${Math.ceil(60 - this.holdTimer)}s left`);
          if (this.holdTimer >= 60) this.advanceMission();
        }
      }
    } else if (i === 3) {
      if (s === 0 && near) { this.missionStep = 1; this.hud.setObjective(this.currentObjective()); }
      else if (s === 1) {
        if (near && input.interactHeld) {
          this.holdTimer += dt;
          this.hud.setObjective(`Cracking the vault… ${Math.ceil(5 - this.holdTimer)}s (hold E)`);
          if (this.holdTimer >= 5) {
            this.cash += 2000; this.hud.setCash(this.cash);
            this.setWanted(4);
            this.missionStep = 2; this.holdTimer = 0;
            this.updateMissionMarker(); this.hud.setObjective(this.currentObjective());
            this.hud.toast('Vault cracked — $2,000! Run to the pier!');
          }
        } else this.holdTimer = Math.max(0, this.holdTimer - dt * 2);
      } else if (s === 2 && near) this.advanceMission();
    }
  }

  updateDayNight() {
    // Sun angle: dayTime 0 = dawn, 0.5 = dusk. Night is 0.55..0.95.
    const a = this.dayTime * Math.PI * 2;
    const elevation = Math.sin(a);
    const night = clamp(1 - elevation * 2.2, 0.25, 1);
    this.sun.intensity = 1.7 * (1 - night) + 0.12;
    this.sun.position.set(Math.cos(a) * 180, 60 + elevation * 160, 80);
    const sky = new THREE.Color().setHSL(0.58, 0.5, 0.55 - night * 0.42);
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
    this.ambient.intensity = 0.6 - night * 0.35;
    const lampOn = night > 0.6;
    for (const lamp of this.city.lamps) lamp.color.setHex(lampOn ? 0xfff2b0 : 0x555544);
  }

  // ----- save / load ----------------------------------------------------

  save() {
    if (!this.started) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        cash: this.cash, health: this.health, armor: this.armor,
        missionIndex: this.missionIndex, missionStep: this.missionStep,
        x: this.player.x, z: this.player.z, score: this.score, kills: this.kills,
      }));
    } catch { /* storage unavailable: ignore */ }
  }

  loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      this.cash = s.cash; this.health = s.health; this.armor = s.armor;
      this.missionIndex = s.missionIndex; this.missionStep = s.missionStep;
      this.player.x = s.x; this.player.z = s.z;
      this.score = s.score || 0; this.kills = s.kills || 0;
      this.player.mesh.position.set(s.x, 0, s.z);
      this.hud.setCash(this.cash);
      this.hud.setHealth(this.health, this.armor);
      this.updateMissionMarker();
      this.hud.setObjective(this.currentObjective());
      return true;
    } catch { return false; }
  }

  static hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
  }
}
