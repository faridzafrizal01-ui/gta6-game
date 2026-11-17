// Vice Shores — the game itself. Third-person open-world crime:
// walk and drive a seeded city, steal cars, traffic and pedestrians, police
// with a 5-star wanted system, shooting, pickups and four story missions.
// Written for this entry; Three.js is the only library (vendored).
import * as THREE from '../vendor/three.module.js';
import { buildWorld, makeCar, makePerson, ROAD_COORDS, CITY_HALF } from './world.js';
import { mulberry32, clamp, lerp, dist, angleLerp, angleDiff, pick, fmtMoney, fmtClock } from './util.js';
import { SoundManager } from './audio.js';

const SAVE_KEY = 'viceshores-save-v1';
const DT = 1 / 60;
const CAR_COLORS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xe67e22, 0x95a5a6, 0x1abc9c, 0xd35400, 0x34495e];
const SHIRT_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6, 0x1abc9c, 0xecf0f1, 0x34495e];
const PANTS_COLORS = [0x2c3e50, 0x34495e, 0x7f8c8d, 0x5d4037, 0x1a1a1a];

function el(id) { return document.getElementById(id); }

export class Game {
  constructor(canvas, seed) {
    this.canvas = canvas;
    this.seed = seed || 1337;
    this.rng = mulberry32(this.seed);
    this.sound = new SoundManager();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87b5e0);
    this.scene.fog = new THREE.Fog(0x87b5e0, 140, 460);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);

    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.4);
    this.sun.position.set(120, 200, 60);
    this.scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xbdd7ff, 0x3a3f2a, 0.9);
    this.scene.add(this.hemi);

    this.world = buildWorld(this.scene, this.rng);
    this.landmarks = this.world.landmarks;

    // Marker beacon for mission objectives.
    this.marker = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 2.6, 60, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = 30; this.marker.add(beam);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3, 4.4, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15; this.marker.add(ring);
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.resetState();
    this.buildEntities();
    this.bindInput();
    this.buildMissions();
    window.addEventListener('resize', () => this.onResize());
  }

  resetState() {
    this.mode = 'title'; // title | play | pause | end
    this.elapsed = 0;
    this.timeHours = 10.0;
    this.keys = {};
    this.camYaw = Math.PI; // behind player, looking north (-z)
    this.camPitch = 0.32;
    this.camDist = 8;
    this.camOffset = 0; // mouse offset while driving
    this.player = {
      x: 0, z: 60, heading: Math.PI, vx: 0, vz: 0,
      health: 100, armor: 0, money: 0, ammo: 12, mag: 12,
      reloading: 0, inCar: false, car: null, speed: 0,
      lastHurt: -99, walkPhase: 0, armed: true, dead: false,
    };
    this.wanted = 0;
    this.lastCrime = -999;
    this.wantedTick = 0;
    this.missionIndex = 0;
    this.missionStep = 0;
    this.missionActive = false;
    this.holdProgress = 0;
    this.killCount = 0;
    this.storyDone = false;
    this.endKind = null;
    this.shotMode = null;
    this.hudTimer = 0;
    this.msgTimer = 0;
    this.saveTimer = 0;
    this.arrestT = 0;
    this.shotFlash = 0;
    this.titleOrbit = 0;
  }

  buildEntities() {
    // Player character.
    this.playerMesh = makePerson(0x222831, 0x2c3e50, false);
    this.playerMesh.children[1].material = new THREE.MeshLambertMaterial({ color: 0x8a5a3a });
    this.scene.add(this.playerMesh);

    // Parked cars (stealable).
    this.parked = [];
    for (const spot of this.world.parkedSpots) {
      const mesh = makeCar(spot.color, false);
      mesh.position.set(spot.x, 0, spot.z);
      mesh.rotation.y = spot.heading;
      this.scene.add(mesh);
      const car = { mesh, x: spot.x, z: spot.z, heading: spot.heading, speed: 0, health: 100, state: 'parked', color: spot.color };
      mesh.userData.car = car;
      this.parked.push(car);
    }

    // Traffic.
    this.traffic = [];
    for (let i = 0; i < 14; i++) {
      const car = this.spawnTrafficCar(true);
      this.traffic.push(car);
    }

    // Pedestrians.
    this.peds = [];
    for (let i = 0; i < 26; i++) {
      const ped = this.spawnPed(true);
      this.peds.push(ped);
    }

    this.police = [];
    this.officers = [];
    this.rivals = [];
    this.pickups = [];
    this.spawnPickup('health', this.landmarks.hospital.x + 16, this.landmarks.hospital.z + 4);
    this.spawnPickup('armor', this.landmarks.garage.x + 16, this.landmarks.garage.z);
    this.spawnPickup('cash', 52, 52, 150);
    this.spawnPickup('cash', -52, -52, 100);
  }

  spawnTrafficCar(randomPos) {
    const road = pick(this.rng, ROAD_COORDS);
    const other = pick(this.rng, ROAD_COORDS);
    const axis = this.rng() < 0.5 ? 'z' : 'x';
    const dir = this.rng() < 0.5 ? 1 : -1;
    const lane = dir > 0 ? 3 : -3;
    const x = axis === 'z' ? road + lane : other;
    const z = axis === 'z' ? other : road + lane;
    const mesh = makeCar(pick(this.rng, CAR_COLORS), false);
    this.scene.add(mesh);
    const car = {
      mesh, x, z, heading: axis === 'z' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2),
      speed: 8 + this.rng() * 4, health: 100, state: 'traffic', axis, dir, road,
      target: this.nextIntersection(x, z, axis, dir, road),
    };
    mesh.userData.car = car;
    return car;
  }

  nextIntersection(x, z, axis, dir, road) {
    // Next road crossing along the car's axis, with lane offset.
    const coords = ROAD_COORDS;
    let next;
    if (axis === 'z') {
      const ahead = coords.filter((c) => (dir > 0 ? c > z + 4 : c < z - 4));
      next = dir > 0 ? ahead[0] : ahead[ahead.length - 1];
      if (next === undefined) { // end of road: turn around
        return { x: road, z: dir > 0 ? 208 : -208, uTurn: true };
      }
      return { x: road + (dir > 0 ? 3 : -3), z: next };
    }
    const ahead = coords.filter((c) => (dir > 0 ? c > x + 4 : c < x - 4));
    next = dir > 0 ? ahead[0] : ahead[ahead.length - 1];
    if (next === undefined) {
      return { x: dir > 0 ? 208 : -208, z: road, uTurn: true };
    }
    return { x: next, z: road + (dir > 0 ? -3 : 3) };
  }

  spawnPed(randomPos) {
    const x = (this.rng() * 2 - 1) * 200;
    const z = (this.rng() * 2 - 1) * 200;
    const mesh = makePerson(pick(this.rng, SHIRT_COLORS), pick(this.rng, PANTS_COLORS), false);
    this.scene.add(mesh);
    const ped = {
      mesh, x, z, heading: this.rng() * Math.PI * 2, speed: 1.2 + this.rng() * 0.8,
      health: 100, state: 'walk', tx: x, tz: z, fleeT: 0, walkPhase: this.rng() * 6,
    };
    mesh.userData.ped = ped;
    this.pickSidewalkTarget(ped);
    return ped;
  }

  pickSidewalkTarget(ped) {
    const road = pick(this.rng, ROAD_COORDS);
    const along = pick(this.rng, ROAD_COORDS) + (this.rng() - 0.5) * 30;
    if (this.rng() < 0.5) { ped.tx = road + (this.rng() < 0.5 ? 8 : -8); ped.tz = along; }
    else { ped.tx = along; ped.tz = road + (this.rng() < 0.5 ? 8 : -8); }
  }

  // ---------- input ----------
  bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys[k] = true;
      if (this.mode !== 'play') return;
      if (k === 'e') this.tryInteract();
      if (k === 'r') this.reload();
      if (k === 'f') this.shoot();
      if (k === 'm') { this.sound.setMuted(!this.sound.muted); this.addMsg(this.sound.muted ? '🔇 Sound off' : '🔊 Sound on'); }
      if (k === 'c') { this.camDist = this.camDist > 9 ? 6.5 : this.camDist + 3; }
      if (k === 'p' || k === 'escape') this.pauseGame();
      if (k === ' ') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.key.toLowerCase()] = false; });
    let dragging = false, lx = 0, ly = 0;
    this.canvas.addEventListener('mousedown', (e) => {
      dragging = true; lx = e.clientX; ly = e.clientY;
      if (this.mode === 'play') { this.sound.ensure(); this.shoot(); }
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      this.camYaw -= dx * 0.005;
      this.camPitch = clamp(this.camPitch + dy * 0.004, 0.08, 1.1);
      if (this.player.inCar) this.camOffset = clamp(this.camOffset - dx * 0.004, -1.2, 1.2);
    });
    window.addEventListener('mouseup', () => { dragging = false; });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    el('btnstart').addEventListener('click', () => { this.sound.ensure(); this.sound.click(); this.startGame(false); });
    el('btncontinue').addEventListener('click', () => { this.sound.ensure(); this.sound.click(); this.startGame(true); });
    el('btnresume').addEventListener('click', () => { this.sound.click(); this.resumeGame(); });
    el('btnrestart').addEventListener('click', () => { this.sound.click(); this.restartGame(); });
    el('btnquit').addEventListener('click', () => { this.sound.click(); this.quitToTitle(); });
    el('btnrespawn').addEventListener('click', () => { this.sound.click(); this.respawn(); });
    el('btnendquit').addEventListener('click', () => { this.sound.click(); this.quitToTitle(); });
    if (localStorage.getItem(SAVE_KEY)) el('btncontinue').classList.remove('hidden');
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ---------- save / load ----------
  saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        money: this.player.money, health: this.player.health, armor: this.player.armor,
        missionIndex: this.missionIndex, storyDone: this.storyDone,
        x: this.player.x, z: this.player.z, timeHours: this.timeHours,
      }));
    } catch { /* storage unavailable (shot mode) */ }
  }

  loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  // ---------- missions ----------
  buildMissions() {
    const L = this.landmarks;
    this.missions = [
      {
        title: 'Hot Wheels', reward: 500,
        briefing: 'Delia Voss: "Jax, you need wheels. Any car on the street is yours — walk up and press E. Bring it to my garage."',
        steps: [
          { type: 'steal', text: 'Steal a car — walk up to any parked car and press E' },
          { type: 'goto', x: L.garage.x, z: L.garage.z, r: 16, text: 'Drive the car to Delia\'s Garage' },
        ],
      },
      {
        title: 'The Pickup', reward: 1200,
        briefing: 'Delia: "A package is waiting at the north-east lot. Grab it, then run it to the Safehouse. The cops will be watching."',
        steps: [
          { type: 'goto', x: L.pickup.x, z: L.pickup.z, r: 9, text: 'Go to the pickup point (north-east lot)' },
          { type: 'interact', x: L.pickup.x, z: L.pickup.z, r: 7, text: 'Press E to grab the package' },
          { type: 'goto', x: L.safehouse.x, z: L.safehouse.z, r: 16, text: 'Deliver the package to the Safehouse — the cops are onto you!',
            onStart: () => { this.setWanted(2); } },
        ],
      },
      {
        title: 'Street Heat', reward: 2000,
        briefing: 'Delia: "The Vipers jumped one of ours at the plaza. Three of them. Make it loud, make it quick, then get back here."',
        steps: [
          { type: 'goto', x: L.plaza.x, z: L.plaza.z, r: 15, text: 'Head to the plaza' },
          { type: 'kill', count: 3, text: 'Take out the 3 Viper rivals' },
          { type: 'goto', x: L.garage.x, z: L.garage.z, r: 16, text: 'Get back to Delia\'s Garage' },
        ],
      },
      {
        title: 'The Big Score', reward: 5000,
        briefing: 'Delia: "Shores Bank. Fifteen seconds on the vault and we walk away rich. Three stars the moment the alarm trips — so run."',
        steps: [
          { type: 'goto', x: L.bank.x, z: L.bank.z, r: 16, text: 'Get to Shores Bank' },
          { type: 'hold', x: L.bank.x, z: L.bank.z + 14, r: 10, seconds: 15, text: 'Hold the bank floor — crack the vault (stay in the zone)' },
          { type: 'goto', x: L.safehouse.x, z: L.safehouse.z, r: 16, text: 'Escape to the Safehouse with the score!',
            onStart: () => { this.setWanted(3); } },
        ],
      },
    ];
  }

  currentMission() { return this.missions[this.missionIndex] || null; }
  currentStep() {
    const m = this.currentMission();
    return m ? m.steps[this.missionStep] : null;
  }

  startMission(index) {
    this.missionIndex = index;
    this.missionStep = 0;
    this.missionActive = true;
    this.holdProgress = 0;
    this.killCount = 0;
    const m = this.currentMission();
    if (!m) { this.missionActive = false; return; }
    this.sound.phone();
    this.addMsg('📱 ' + m.title + ' — ' + m.briefing);
    this.beginStep();
  }

  beginStep() {
    const step = this.currentStep();
    if (!step) return;
    if (step.onStart) step.onStart();
    if (step.type === 'kill') this.spawnRivals();
    this.updateMarker();
  }

  completeStep() {
    this.sound.pickup();
    const m = this.currentMission();
    this.missionStep += 1;
    if (this.missionStep >= m.steps.length) {
      this.player.money += m.reward;
      this.sound.mission();
      this.addMsg('✅ Mission complete: ' + m.title + ' — +' + fmtMoney(m.reward));
      this.missionActive = false;
      this.marker.visible = false;
      this.saveGame();
      if (this.missionIndex + 1 < this.missions.length) {
        setTimeout(() => { if (this.mode === 'play') this.startMission(this.missionIndex + 1); }, 2500);
      } else {
        this.storyDone = true;
        this.addMsg('🏆 STORY COMPLETE — You own Vice Shores now. Free roam: keep the chaos going.');
      }
    } else {
      this.beginStep();
    }
  }

  updateMarker() {
    const step = this.currentStep();
    if (!step || !this.missionActive || step.type === 'steal' || step.type === 'kill') {
      this.marker.visible = false;
      return;
    }
    this.marker.visible = true;
    this.marker.position.set(step.x, 0, step.z);
  }

  spawnRivals() {
    const p = this.landmarks.plaza;
    for (let i = 0; i < 3; i++) {
      const mesh = makePerson(0x7a1f1f, 0x1a1a1a, false);
      const x = p.x + (this.rng() - 0.5) * 22;
      const z = p.z + (this.rng() - 0.5) * 22;
      mesh.position.set(x, 0, z);
      this.scene.add(mesh);
      const rival = { mesh, x, z, heading: 0, health: 100, shootT: 1 + this.rng() * 1.5 };
      mesh.userData.rival = rival;
      this.rivals.push(rival);
    }
    this.addMsg('🔴 Vipers spotted at the plaza — take them out!');
  }

  // ---------- game flow ----------
  startGame(fromSave) {
    const save = fromSave ? this.loadSave() : null;
    if (save) {
      this.player.money = save.money || 0;
      this.player.health = save.health || 100;
      this.player.armor = save.armor || 0;
      this.player.x = save.x || 0; this.player.z = save.z || 60;
      this.timeHours = save.timeHours || 10;
      this.storyDone = !!save.storyDone;
      this.missionIndex = Math.min(save.missionIndex || 0, this.missions.length - 1);
    } else {
      this.resetState();
      // Entities keep their meshes; rebuild parked/traffic positions is unnecessary.
    }
    el('title').classList.add('hidden');
    el('end').classList.add('hidden');
    el('hud').classList.remove('hidden');
    this.mode = 'play';
    this.sound.startMusic();
    this.startMission(this.missionIndex);
    this.addMsg('Welcome to Vice Shores. Follow the yellow marker.');
  }

  pauseGame() {
    if (this.mode !== 'play') return;
    this.mode = 'pause';
    el('pause').classList.remove('hidden');
    el('pausestats').textContent = 'Cash ' + fmtMoney(this.player.money) + ' · Mission: ' +
      (this.currentMission() ? this.currentMission().title + ' (' + (this.missionStep + 1) + '/' + this.currentMission().steps.length + ')' : '—') +
      ' · Wanted ' + this.wanted + '★';
    this.sound.engine(false, 0);
    this.sound.siren(false);
  }

  resumeGame() {
    el('pause').classList.add('hidden');
    this.mode = 'play';
  }

  restartGame() {
    el('pause').classList.add('hidden');
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    el('btncontinue').classList.add('hidden');
    this.startGame(false);
  }

  quitToTitle() {
    this.saveGame();
    el('pause').classList.add('hidden');
    el('end').classList.add('hidden');
    el('hud').classList.add('hidden');
    el('title').classList.remove('hidden');
    if (localStorage.getItem(SAVE_KEY)) el('btncontinue').classList.remove('hidden');
    this.mode = 'title';
    this.sound.engine(false, 0);
    this.sound.siren(false);
  }

  gameOver(kind) {
    if (this.mode !== 'play') return;
    this.mode = 'end';
    this.endKind = kind;
    this.sound.fail();
    this.sound.engine(false, 0);
    this.sound.siren(false);
    const title = el('endtitle');
    if (kind === 'wasted') {
      title.textContent = 'WASTED';
      title.className = 'big wasted';
      el('endsub').textContent = 'Jax got flatlined on the streets of Vice Shores. The hospital patched him up — for a price.';
    } else {
      title.textContent = 'BUSTED';
      title.className = 'big busted';
      el('endsub').textContent = 'The Vice Shores PD hauled Jax in. Bail, a fine, and a long walk back to the streets.';
    }
    el('end').classList.remove('hidden');
  }

  respawn() {
    el('end').classList.add('hidden');
    this.player.money = Math.max(0, this.player.money - 200);
    this.player.health = 100;
    this.player.armor = 0;
    this.wanted = 0;
    this.player.x = this.landmarks.hospital.x + 16;
    this.player.z = this.landmarks.hospital.z + 4;
    this.player.heading = Math.PI;
    if (this.player.inCar) this.exitCar();
    this.mode = 'play';
    this.addMsg('🏥 You wake up at General Hospital. -$200 fine.');
    this.saveGame();
  }

  // ---------- wanted ----------
  setWanted(n) {
    this.wanted = clamp(n, 0, 5);
    this.lastCrime = this.elapsed;
    this.wantedTick = 0;
  }

  addCrime(n) {
    this.setWanted(Math.max(this.wanted, n));
  }

  // ---------- interaction ----------
  nearestCar(maxD) {
    let best = null, bestD = maxD;
    for (const car of this.parked) {
      if (car.state !== 'parked') continue;
      const d = dist(this.player.x, this.player.z, car.x, car.z);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  tryInteract() {
    const p = this.player;
    if (p.inCar) { this.exitCar(); return; }
    // Pickups.
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      if (dist(p.x, p.z, pk.x, pk.z) < 2.4) { this.collectPickup(pk); return; }
    }
    // Mission interact step.
    const step = this.currentStep();
    if (this.missionActive && step && step.type === 'interact' &&
        dist(p.x, p.z, step.x, step.z) < step.r) {
      this.addMsg('📦 Package grabbed. Move!');
      this.sound.cash();
      this.completeStep();
      return;
    }
    // Enter a car.
    const car = this.nearestCar(4.5);
    if (car) { this.enterCar(car); return; }
  }

  enterCar(car) {
    const p = this.player;
    car.state = 'player';
    const idx = this.parked.indexOf(car);
    if (idx >= 0) this.parked.splice(idx, 1);
    p.inCar = true;
    p.car = car;
    p.speed = 0;
    this.playerMesh.visible = false;
    this.camOffset = 0;
    this.sound.engine(true, 0);
    this.addMsg('🚗 You took the car. ' + (this.wanted === 0 ? 'Nobody saw a thing.' : 'The cops saw that.'));
    const step = this.currentStep();
    if (this.missionActive && step && step.type === 'steal') this.completeStep();
    if (this.wanted > 0) this.lastCrime = this.elapsed;
  }

  exitCar() {
    const p = this.player;
    const car = p.car;
    if (!car) return;
    const side = 2.6;
    p.x = car.x + Math.cos(car.heading) * side;
    p.z = car.z - Math.sin(car.heading) * side;
    p.heading = car.heading;
    p.inCar = false;
    p.car = null;
    car.state = 'parked';
    car.speed = 0;
    this.parked.push(car);
    this.playerMesh.visible = true;
    this.sound.engine(false, 0);
  }

  reload() {
    const p = this.player;
    if (p.inCar || p.reloading > 0 || p.ammo === p.mag) return;
    p.reloading = 0.8;
    this.sound.reload();
  }

  // ---------- combat ----------
  shoot() {
    const p = this.player;
    if (this.mode !== 'play' || p.inCar || p.reloading > 0 || p.dead) return;
    if (p.ammo <= 0) { this.sound.empty(); return; }
    p.ammo -= 1;
    this.sound.shoot();
    this.shotFlash = 0.08;
    const rc = new THREE.Raycaster();
    rc.setFromCamera({ x: 0, y: 0 }, this.camera);
    rc.far = 90;
    const targets = [];
    for (const ped of this.peds) if (ped.health > 0) targets.push(ped.mesh);
    for (const r of this.rivals) if (r.health > 0) targets.push(r.mesh);
    for (const o of this.officers) if (o.health > 0) targets.push(o.mesh);
    for (const c of this.traffic) targets.push(c.mesh);
    for (const c of this.police) targets.push(c.mesh);
    const hits = rc.intersectObjects(targets, true);
    if (hits.length === 0) return;
    let obj = hits[0].object;
    while (obj && !obj.userData.ped && !obj.userData.rival && !obj.userData.officer && !obj.userData.car) obj = obj.parent;
    if (!obj) return;
    this.sound.hit();
    if (obj.userData.ped) this.damagePed(obj.userData.ped, 34);
    else if (obj.userData.rival) this.damageRival(obj.userData.rival, 34);
    else if (obj.userData.officer) this.damageOfficer(obj.userData.officer, 34);
    else if (obj.userData.car) this.damageCar(obj.userData.car, 34);
  }

  damagePed(ped, dmg) {
    ped.health -= dmg;
    ped.fleeT = 6;
    if (ped.health <= 0) {
      ped.state = 'dead';
      ped.mesh.rotation.z = Math.PI / 2;
      ped.mesh.position.y = 0.3;
      this.addCrime(2);
      this.spawnPickup('cash', ped.x, ped.z, 40 + Math.floor(this.rng() * 80));
      this.addMsg('A bystander is down. The cops noticed.');
    }
  }

  damageRival(rival, dmg) {
    rival.health -= dmg;
    if (rival.health <= 0) {
      rival.mesh.rotation.z = Math.PI / 2;
      rival.mesh.position.y = 0.3;
      this.killCount += 1;
      this.addMsg('Viper down (' + this.killCount + '/3).');
      this.spawnPickup('cash', rival.x, rival.z, 120);
      const step = this.currentStep();
      if (this.missionActive && step && step.type === 'kill' && this.killCount >= step.count) {
        this.rivals = this.rivals.filter((r) => r.health > 0);
        this.completeStep();
      }
    }
  }

  damageOfficer(off, dmg) {
    off.health -= dmg;
    if (off.health <= 0) {
      off.mesh.rotation.z = Math.PI / 2;
      off.mesh.position.y = 0.3;
      off.state = 'dead';
      this.addCrime(4);
      this.addMsg('You dropped a cop. Every unit in the city is coming.');
    }
  }

  damageCar(car, dmg) {
    car.health -= dmg;
    if (car.health <= 0 && car.state !== 'wreck') {
      car.state = 'wreck';
      car.speed = 0;
      this.sound.crash();
      this.addMsg('💥 The car is wrecked.');
      if (car === this.player.car) { this.exitCar(); this.hurtPlayer(15, 'crash'); }
    }
  }

  hurtPlayer(dmg, kind) {
    const p = this.player;
    if (p.dead || this.mode !== 'play') return;
    if (p.armor > 0) {
      const absorbed = Math.min(p.armor, dmg);
      p.armor -= absorbed;
      dmg -= absorbed;
    }
    p.health -= dmg;
    p.lastHurt = this.elapsed;
    el('vignette').style.opacity = '0.9';
    setTimeout(() => { el('vignette').style.opacity = p.health < 40 ? '0.55' : '0'; }, 180);
    if (p.health <= 0) {
      p.health = 0;
      p.dead = true;
      this.gameOver('wasted');
    }
  }

  // ---------- collision ----------
  // Push a circle out of building AABBs and the city bounds. Returns true on hit.
  collideCircle(x, z, r) {
    let hit = false;
    for (const b of this.world.buildings) {
      const cx = clamp(x, b.minX, b.maxX);
      const cz = clamp(z, b.minZ, b.maxZ);
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        hit = true;
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2);
          x = cx + (dx / d) * r;
          z = cz + (dz / d) * r;
        } else {
          // Centre inside the box: push out along the smallest penetration axis.
          const pl = x - (b.minX - r), pr = (b.maxX + r) - x;
          const pt = z - (b.minZ - r), pb = (b.maxZ + r) - z;
          const m = Math.min(pl, pr, pt, pb);
          if (m === pl) x = b.minX - r; else if (m === pr) x = b.maxX + r;
          else if (m === pt) z = b.minZ - r; else z = b.maxZ + r;
        }
      }
    }
    const B = CITY_HALF - 2;
    if (x < -B) { x = -B; hit = true; }
    if (x > B) { x = B; hit = true; }
    if (z < -B) { z = -B; hit = true; }
    if (z > 250) { z = 250; hit = true; } // the ocean
    return { x, z, hit };
  }

  carHitsBuilding(car, nx, nz) {
    // Check the front and rear bumper points.
    const fx = nx + Math.sin(car.heading) * 2.3, fz = nz + Math.cos(car.heading) * 2.3;
    const bx = nx - Math.sin(car.heading) * 2.3, bz = nz - Math.cos(car.heading) * 2.3;
    const f = this.collideCircle(fx, fz, 0.9);
    const b = this.collideCircle(bx, bz, 0.9);
    return f.hit || b.hit;
  }

  // ---------- pickups ----------
  spawnPickup(kind, x, z, value) {
    let color = 0x2ecc71, geo = new THREE.BoxGeometry(1, 1, 1);
    if (kind === 'health') { color = 0xffffff; geo = new THREE.BoxGeometry(1.2, 0.4, 1.2); }
    if (kind === 'armor') { color = 0x3498db; geo = new THREE.CylinderGeometry(0.7, 0.7, 0.4, 12); }
    if (kind === 'cash') { color = 0x2ecc71; geo = new THREE.BoxGeometry(0.9, 0.5, 0.9); }
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    mesh.position.set(x, 1.2, z);
    this.scene.add(mesh);
    this.pickups.push({ mesh, kind, x, z, value: value || 0, phase: this.rng() * 6 });
  }

  collectPickup(pk) {
    const p = this.player;
    if (pk.kind === 'health') { p.health = Math.min(100, p.health + 50); this.addMsg('❤️ Health +50'); }
    if (pk.kind === 'armor') { p.armor = Math.min(100, p.armor + 50); this.addMsg('🛡️ Armor +50'); }
    if (pk.kind === 'cash') { p.money += pk.value; this.addMsg('💵 +' + fmtMoney(pk.value)); this.sound.cash(); }
    this.sound.pickup();
    this.scene.remove(pk.mesh);
    this.pickups.splice(this.pickups.indexOf(pk), 1);
    this.saveGame();
  }

  // ---------- police ----------
  spawnPoliceCar() {
    const p = this.player;
    const road = pick(this.rng, ROAD_COORDS);
    const other = clamp(p.z + (this.rng() < 0.5 ? -55 : 55), -200, 200);
    const x = road, z = other;
    const mesh = makeCar(0x111111, true);
    this.scene.add(mesh);
    const car = { mesh, x, z, heading: 0, speed: 0, health: 100, state: 'police', officerOut: false };
    mesh.userData.car = car;
    this.police.push(car);
    return car;
  }

  spawnOfficer(fromCar) {
    if (this.officers.filter((o) => o.state !== 'dead').length >= 4) return;
    const mesh = makePerson(0x1d3a6e, 0x1d3a6e, true);
    mesh.position.set(fromCar.x, 0, fromCar.z);
    this.scene.add(mesh);
    const off = { mesh, x: fromCar.x, z: fromCar.z, heading: 0, health: 100, state: 'chase', arrestT: 0, walkPhase: 0 };
    mesh.userData.officer = off;
    this.officers.push(off);
  }

  // ---------- per-frame update ----------
  update(dt, input) {
    if (this.mode === 'title') {
      this.titleOrbit += dt * 0.05;
      this.updateDayNight(dt);
      this.updateCamera(dt);
      return;
    }
    if (this.mode !== 'play') return;
    this.elapsed += dt;
    this.timeHours += dt / 30; // one game hour every 30 real seconds
    if (this.timeHours >= 24) this.timeHours -= 24;

    const p = this.player;
    if (p.reloading > 0) {
      p.reloading -= dt;
      if (p.reloading <= 0) { p.ammo = p.mag; }
    }
    // Slow health regen out of combat.
    if (this.elapsed - p.lastHurt > 10 && p.health > 0 && p.health < 100) p.health = Math.min(100, p.health + 2 * dt);

    if (p.inCar) this.updateDriving(dt, input);
    else this.updateOnFoot(dt, input);

    this.updateTraffic(dt);
    this.updatePeds(dt);
    this.updatePolice(dt);
    this.updateRivals(dt);
    this.updatePickups(dt);
    this.updateWanted(dt);
    this.updateMissions(dt);
    this.updateDayNight(dt);
    this.updateCamera(dt);
    this.updateHUD(dt);
    this.updateAudio();
    this.saveTimer += dt;
    if (this.saveTimer > 30) { this.saveTimer = 0; this.saveGame(); }
  }

  updateOnFoot(dt, input) {
    const p = this.player;
    let mx = 0, mz = 0;
    const fwdX = Math.sin(this.camYaw), fwdZ = Math.cos(this.camYaw);
    const rightX = Math.cos(this.camYaw), rightZ = -Math.sin(this.camYaw);
    if (input.up) { mx += fwdX; mz += fwdZ; }
    if (input.down) { mx -= fwdX; mz -= fwdZ; }
    if (input.left) { mx -= rightX; mz -= rightZ; }
    if (input.right) { mx += rightX; mz += rightZ; }
    const len = Math.hypot(mx, mz);
    const sprint = input.sprint ? 1.7 : 1;
    const targetSpeed = len > 0 ? 6.5 * sprint : 0;
    if (len > 0) {
      mx /= len; mz /= len;
      p.heading = angleLerp(p.heading, Math.atan2(mx, mz), 1 - Math.pow(0.0001, dt));
    }
    const accel = 40;
    p.vx = lerp(p.vx, mx * targetSpeed, clamp(accel * dt / Math.max(targetSpeed, 1), 0, 1));
    p.vz = lerp(p.vz, mz * targetSpeed, clamp(accel * dt / Math.max(targetSpeed, 1), 0, 1));
    let nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
    // Collide with cars (parked / traffic) as circles.
    for (const car of [...this.parked, ...this.traffic, ...this.police]) {
      if (car.state === 'wreck') continue;
      const d = dist(nx, nz, car.x, car.z);
      if (d < 2.4 && d > 0.01) {
        nx = car.x + ((nx - car.x) / d) * 2.4;
        nz = car.z + ((nz - car.z) / d) * 2.4;
      }
    }
    const res = this.collideCircle(nx, nz, 0.6);
    p.x = res.x; p.z = res.z;
    p.walkPhase += Math.hypot(p.vx, p.vz) * dt * 1.6;
    p.speed = Math.hypot(p.vx, p.vz);
    this.playerMesh.position.set(p.x, 0, p.z);
    this.playerMesh.rotation.y = p.heading;
    const swing = Math.sin(p.walkPhase) * clamp(p.speed / 6, 0, 1) * 0.55;
    const L = this.playerMesh.userData.limbs;
    L.legL.rotation.x = swing; L.legR.rotation.x = -swing;
    L.armL.rotation.x = -swing * 0.8; L.armR.rotation.x = swing * 0.8;
    if (input.jump) { /* jump is cosmetic on foot: a small hop */ }
  }

  updateDriving(dt, input) {
    const p = this.player;
    const car = p.car;
    if (!car) return;
    const maxSpeed = 30, maxReverse = 10;
    if (input.up) car.speed += 16 * dt;
    else if (input.down) car.speed -= (car.speed > 0.5 ? 22 : 10) * dt;
    else car.speed -= Math.sign(car.speed) * 6 * dt;
    if (input.handbrake) car.speed -= Math.sign(car.speed) * 26 * dt;
    car.speed = clamp(car.speed, -maxReverse, maxSpeed);
    if (Math.abs(car.speed) < 0.15 && !input.up && !input.down) car.speed = 0;
    const steer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const steerAuthority = clamp(Math.abs(car.speed) / 8, 0, 1);
    car.heading += steer * steerAuthority * (car.speed >= 0 ? 1 : -1) * 1.9 * dt * (input.handbrake ? 1.5 : 1);
    const nx = car.x + Math.sin(car.heading) * car.speed * dt;
    const nz = car.z + Math.cos(car.heading) * car.speed * dt;
    if (this.carHitsBuilding(car, nx, nz)) {
      if (Math.abs(car.speed) > 14) { this.sound.crash(); this.hurtPlayer(6, 'crash'); car.health -= 12; }
      car.speed *= 0.45;
    } else {
      car.x = nx; car.z = nz;
    }
    // Car-vs-car shoves.
    for (const other of [...this.traffic, ...this.police, ...this.parked]) {
      if (other === car || other.state === 'wreck') continue;
      const d = dist(car.x, car.z, other.x, other.z);
      if (d < 4.2 && d > 0.01) {
        const push = (4.2 - d) / 2;
        const ux = (car.x - other.x) / d, uz = (car.z - other.z) / d;
        car.x += ux * push; car.z += uz * push;
        if (other.state === 'traffic' || other.state === 'police') {
          other.x -= ux * push; other.z -= uz * push;
          other.speed *= 0.7;
        }
        if (Math.abs(car.speed) > 10) { this.sound.crash(); car.speed *= 0.6; }
      }
    }
    // Running over pedestrians.
    for (const ped of this.peds) {
      if (ped.state !== 'walk' && ped.state !== 'flee') continue;
      if (dist(car.x, car.z, ped.x, ped.z) < 2.4 && Math.abs(car.speed) > 3) {
        this.damagePed(ped, 100);
        car.speed *= 0.92;
        this.addMsg('You ran someone over!');
      }
    }
    p.x = car.x; p.z = car.z;
    p.speed = Math.abs(car.speed);
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    const wheels = car.mesh.userData.wheels;
    if (wheels) for (const w of wheels) w.rotation.x += car.speed * dt * 2;
    this.camOffset = lerp(this.camOffset, 0, dt * 1.2);
    if (car.health <= 0) this.damageCar(car, 0);
  }

  updateTraffic(dt) {
    for (const car of this.traffic) {
      if (car.state === 'wreck') continue;
      // Slow for a car ahead.
      let targetSpeed = car.speed;
      const aheadX = car.x + Math.sin(car.heading) * 9;
      const aheadZ = car.z + Math.cos(car.heading) * 9;
      for (const other of [...this.traffic, ...this.police]) {
        if (other === car) continue;
        if (dist(aheadX, aheadZ, other.x, other.z) < 5) { targetSpeed = Math.min(targetSpeed, 3); }
      }
      const p = this.player;
      if (p.inCar && dist(aheadX, aheadZ, p.car.x, p.car.z) < 5) targetSpeed = Math.min(targetSpeed, 3);
      car.speed = lerp(car.speed, Math.max(targetSpeed, 4), dt * 0.8);
      // Steer toward the target intersection.
      const desired = Math.atan2(car.target.x - car.x, car.target.z - car.z);
      car.heading = angleLerp(car.heading, desired, 1 - Math.pow(0.02, dt));
      const nx = car.x + Math.sin(car.heading) * car.speed * dt;
      const nz = car.z + Math.cos(car.heading) * car.speed * dt;
      car.x = nx; car.z = nz;
      if (dist(car.x, car.z, car.target.x, car.target.z) < 5) {
        if (car.target.uTurn) {
          // Reached the edge: reverse direction on the same road.
          car.dir *= -1;
          car.heading += Math.PI;
          car.target = this.nextIntersection(car.x, car.z, car.axis, car.dir, car.road);
        } else {
          // Arrived at an intersection: maybe turn.
          const roll = this.rng();
          if (roll < 0.55) {
            car.target = this.nextIntersection(car.x, car.z, car.axis, car.dir, car.road);
          } else {
            // Turn onto the crossing road.
            const newAxis = car.axis === 'z' ? 'x' : 'z';
            const crossRoad = car.axis === 'z' ? car.target.z : car.target.x;
            const newDir = this.rng() < 0.5 ? 1 : -1;
            car.axis = newAxis; car.dir = newDir; car.road = crossRoad;
            car.target = this.nextIntersection(car.x, car.z, newAxis, newDir, crossRoad);
          }
        }
      }
      // Keep traffic inside the city.
      if (Math.abs(car.x) > 240 || Math.abs(car.z) > 240) {
        const fresh = this.spawnTrafficCar(true);
        car.mesh.position.copy(fresh.mesh.position);
        Object.assign(car, fresh, { mesh: car.mesh });
        this.scene.remove(fresh.mesh);
      }
      car.mesh.position.set(car.x, 0, car.z);
      car.mesh.rotation.y = car.heading;
    }
  }

  updatePeds(dt) {
    const p = this.player;
    for (const ped of this.peds) {
      if (ped.state === 'dead') continue;
      // Flee from fast cars and gunfire.
      const carNear = p.inCar && dist(ped.x, ped.z, p.car.x, p.car.z) < 12 && Math.abs(p.car.speed) > 8;
      if (carNear || ped.fleeT > 0) {
        ped.state = 'flee';
        ped.fleeT -= dt;
        const away = Math.atan2(ped.x - p.x, ped.z - p.z);
        ped.heading = angleLerp(ped.heading, away, dt * 4);
        ped.x += Math.sin(ped.heading) * 4.2 * dt;
        ped.z += Math.cos(ped.heading) * 4.2 * dt;
        if (ped.fleeT <= 0) ped.state = 'walk';
      } else {
        ped.state = 'walk';
        const d = dist(ped.x, ped.z, ped.tx, ped.tz);
        if (d < 2) this.pickSidewalkTarget(ped);
        const desired = Math.atan2(ped.tx - ped.x, ped.tz - ped.z);
        ped.heading = angleLerp(ped.heading, desired, dt * 3);
        ped.x += Math.sin(ped.heading) * ped.speed * dt;
        ped.z += Math.cos(ped.heading) * ped.speed * dt;
      }
      const res = this.collideCircle(ped.x, ped.z, 0.5);
      ped.x = res.x; ped.z = res.z;
      ped.walkPhase += ped.speed * dt * 3;
      const swing = Math.sin(ped.walkPhase) * 0.5;
      const L = ped.mesh.userData.limbs;
      L.legL.rotation.x = swing; L.legR.rotation.x = -swing;
      L.armL.rotation.x = -swing * 0.7; L.armR.rotation.x = swing * 0.7;
      ped.mesh.position.set(ped.x, 0, ped.z);
      ped.mesh.rotation.y = ped.heading;
    }
  }

  updatePolice(dt) {
    const p = this.player;
    // Maintain the right number of police cars.
    const want = this.wanted > 0 ? Math.min(this.wanted, 5) : 0;
    while (this.police.length < want) this.spawnPoliceCar();
    while (this.police.length > want) {
      const car = this.police.pop();
      this.scene.remove(car.mesh);
    }
    for (const car of this.police) {
      const desired = Math.atan2(p.x - car.x, p.z - car.z);
      car.heading = angleLerp(car.heading, desired, 1 - Math.pow(0.05, dt));
      car.speed = lerp(car.speed, 33, dt * 0.7);
      const nx = car.x + Math.sin(car.heading) * car.speed * dt;
      const nz = car.z + Math.cos(car.heading) * car.speed * dt;
      if (!this.carHitsBuilding(car, nx, nz)) { car.x = nx; car.z = nz; }
      else { car.heading += 0.6 * dt * 10; car.speed *= 0.8; }
      car.mesh.position.set(car.x, 0, car.z);
      car.mesh.rotation.y = car.heading;
      const d = dist(car.x, car.z, p.x, p.z);
      // Ram the player's car: a bump every half second, not a constant pin.
      if (p.inCar && d < 4.5) {
        if (this.elapsed - (car.lastRam || -9) > 0.5) {
          car.lastRam = this.elapsed;
          p.car.speed *= 0.82;
          p.car.health -= 3;
          if (Math.abs(p.car.speed) > 12) this.sound.crash();
          if (p.car.health <= 0) this.damageCar(p.car, 0);
        }
      }
      // On foot: a cop gets out and chases.
      if (!p.inCar && d < 9 && !car.officerOut) {
        car.officerOut = true;
        this.spawnOfficer(car);
      }
      if (d > 180) { // too far: respawn closer
        const road = pick(this.rng, ROAD_COORDS);
        car.x = clamp(p.x + (this.rng() < 0.5 ? -60 : 60), -200, 200);
        car.z = clamp(p.z + (this.rng() < 0.5 ? -60 : 60), -200, 200);
      }
    }
    // Officers on foot.
    for (const off of this.officers) {
      if (off.state === 'dead') continue;
      const d = dist(off.x, off.z, p.x, p.z);
      if (p.inCar || d > 120) {
        // Give up and jog back to the car.
        off.state = 'return';
      }
      if (off.state === 'chase') {
        const desired = Math.atan2(p.x - off.x, p.z - off.z);
        off.heading = angleLerp(off.heading, desired, dt * 5);
        off.x += Math.sin(off.heading) * 5.6 * dt;
        off.z += Math.cos(off.heading) * 5.6 * dt;
        if (d < 1.7) {
          off.arrestT += dt;
          if (off.arrestT > 2.2) { this.gameOver('busted'); return; }
        } else off.arrestT = Math.max(0, off.arrestT - dt);
      } else if (off.state === 'return') {
        if (d > 60) { this.scene.remove(off.mesh); this.officers.splice(this.officers.indexOf(off), 1); continue; }
        const desired = Math.atan2(p.x - off.x, p.z - off.z);
        off.heading = angleLerp(off.heading, desired, dt * 3);
        off.x += Math.sin(off.heading) * 4 * dt;
        off.z += Math.cos(off.heading) * 4 * dt;
      }
      const res = this.collideCircle(off.x, off.z, 0.5);
      off.x = res.x; off.z = res.z;
      off.walkPhase += 5 * dt * 3;
      const swing = Math.sin(off.walkPhase) * 0.5;
      const L = off.mesh.userData.limbs;
      L.legL.rotation.x = swing; L.legR.rotation.x = -swing;
      off.mesh.position.set(off.x, 0, off.z);
      off.mesh.rotation.y = off.heading;
    }
  }

  updateRivals(dt) {
    const p = this.player;
    for (const r of this.rivals) {
      if (r.health <= 0) continue;
      const d = dist(r.x, r.z, p.x, p.z);
      r.shootT -= dt;
      // Face the player and strafe a little.
      r.heading = angleLerp(r.heading, Math.atan2(p.x - r.x, p.z - r.z), dt * 3);
      r.mesh.rotation.y = r.heading;
      if (r.shootT <= 0 && d < 38 && this.mode === 'play') {
        r.shootT = 2 + this.rng() * 1.2;
        this.sound.shoot();
        if (this.rng() < 0.4) {
          this.hurtPlayer(8, 'shot');
          this.addMsg('🔫 A Viper hit you!');
        }
      }
    }
  }

  updatePickups(dt) {
    for (const pk of this.pickups) {
      pk.phase += dt * 2;
      pk.mesh.position.y = 1.2 + Math.sin(pk.phase) * 0.25;
      pk.mesh.rotation.y += dt * 1.5;
      if (dist(this.player.x, this.player.z, pk.x, pk.z) < 2.2) this.collectPickup(pk);
    }
  }

  updateWanted(dt) {
    if (this.wanted === 0) return;
    const p = this.player;
    const nearestCop = this.police.reduce((m, c) => Math.min(m, dist(c.x, c.z, p.x, p.z)), 999);
    if (this.elapsed - this.lastCrime > 25 && nearestCop > 90) {
      this.wantedTick += dt;
      if (this.wantedTick > 8) {
        this.wantedTick = 0;
        this.wanted -= 1;
        if (this.wanted === 0) this.addMsg('👮 The heat is off — for now.');
      }
    } else this.wantedTick = 0;
  }

  updateMissions(dt) {
    if (!this.missionActive) return;
    const step = this.currentStep();
    if (!step) return;
    const p = this.player;
    if (step.type === 'goto' || step.type === 'interact') {
      if (dist(p.x, p.z, step.x, step.z) < step.r) {
        if (step.type === 'goto') this.completeStep();
      }
    } else if (step.type === 'hold') {
      if (dist(p.x, p.z, step.x, step.z) < step.r) {
        this.holdProgress += dt;
        el('progress').classList.remove('hidden');
        el('progresslbl').textContent = '💰 CRACKING THE VAULT… ' + Math.ceil(step.seconds - this.holdProgress) + 's';
        el('progressfill').style.width = clamp(this.holdProgress / step.seconds * 100, 0, 100) + '%';
        if (this.holdProgress >= step.seconds) {
          el('progress').classList.add('hidden');
          this.holdProgress = 0;
          this.addMsg('💰 Vault cracked! RUN!');
          this.completeStep();
        }
      } else {
        this.holdProgress = Math.max(0, this.holdProgress - dt * 0.5);
        el('progressfill').style.width = clamp(this.holdProgress / step.seconds * 100, 0, 100) + '%';
        if (this.holdProgress <= 0) el('progress').classList.add('hidden');
      }
    }
  }

  // ---------- day / night ----------
  updateDayNight(dt) {
    const t = this.timeHours;
    // Sun elevation: 6:00 sunrise, 12:00 noon, 18:00 sunset.
    const sunAngle = ((t - 6) / 12) * Math.PI;
    const elev = Math.sin(sunAngle);
    const dayF = clamp(elev * 1.6 + 0.15, 0, 1);
    const duskF = clamp(1 - Math.abs(elev) * 4, 0, 1) * (t > 6 && t < 20 ? 1 : 0);
    const daySky = new THREE.Color(0x87b5e0);
    const nightSky = new THREE.Color(0x0a1024);
    const duskSky = new THREE.Color(0xff8a4a);
    const sky = nightSky.clone().lerp(daySky, dayF).lerp(duskSky, duskF * 0.45);
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);
    this.sun.intensity = 0.25 + dayF * 1.25;
    this.sun.color.setHex(duskF > 0.4 ? 0xffb070 : 0xfff2d8);
    this.sun.position.set(Math.cos(sunAngle) * 180, Math.max(30, elev * 220), 80);
    this.hemi.intensity = 0.35 + dayF * 0.6;
  }

  // ---------- camera ----------
  updateCamera(dt) {
    const p = this.player;
    if (this.mode === 'title') {
      const a = this.titleOrbit;
      this.camera.position.set(Math.cos(a) * 190, 95, Math.sin(a) * 190);
      this.camera.lookAt(0, 8, 0);
      return;
    }
    let targetX, targetZ, targetY, yaw;
    if (p.inCar && p.car) {
      yaw = p.car.heading + Math.PI + this.camOffset;
      targetX = p.car.x; targetZ = p.car.z; targetY = 1.4;
    } else {
      yaw = this.camYaw;
      targetX = p.x; targetZ = p.z; targetY = 1.7;
    }
    const pitch = this.camPitch;
    const distCam = this.camDist + (p.inCar ? 3.5 : 0);
    const cx = targetX + Math.sin(yaw) * Math.cos(pitch) * distCam;
    const cz = targetZ + Math.cos(yaw) * Math.cos(pitch) * distCam;
    const cy = targetY + Math.sin(pitch) * distCam;
    this.camera.position.set(cx, Math.max(cy, 1.2), cz);
    this.camera.lookAt(targetX, targetY, targetZ);
  }

  // ---------- audio ----------
  updateAudio() {
    const p = this.player;
    this.sound.engine(p.inCar && this.mode === 'play', p.inCar ? clamp(Math.abs(p.car.speed) / 30, 0, 1) : 0);
    this.sound.siren(this.wanted > 0 && this.mode === 'play');
  }

  // ---------- HUD ----------
  addMsg(text) {
    const box = el('msg');
    const div = document.createElement('div');
    div.textContent = text;
    box.prepend(div);
    while (box.children.length > 4) box.removeChild(box.lastChild);
    setTimeout(() => { if (div.parentNode) div.remove(); }, 9000);
    el('status').textContent = text;
  }

  updateHUD(dt) {
    this.hudTimer += dt;
    const p = this.player;
    el('cash').textContent = fmtMoney(p.money);
    el('healthfill').style.width = clamp(p.health, 0, 100) + '%';
    el('armorfill').style.width = clamp(p.armor, 0, 100) + '%';
    el('clock').textContent = fmtClock(this.timeHours);
    if (this.hudTimer < 0.12) return;
    this.hudTimer = 0;
    // Wanted stars.
    let stars = '';
    for (let i = 0; i < 5; i++) stars += i < this.wanted ? '★' : '<span class="dim">☆</span>';
    el('wanted').innerHTML = stars;
    el('ammo').classList.toggle('hidden', p.inCar);
    el('ammo').textContent = '🔫 ' + p.ammo + ' / ' + (p.reloading > 0 ? '…' : '∞');
    el('crosshair').classList.toggle('hidden', p.inCar || this.mode !== 'play');
    const speedo = el('speedo');
    if (p.inCar) {
      speedo.classList.remove('hidden');
      speedo.querySelector('b').textContent = Math.round(Math.abs(p.car.speed) * 2.2);
    } else speedo.classList.add('hidden');
    // Objective.
    const step = this.currentStep();
    const obj = el('objective');
    if (this.missionActive && step) {
      obj.classList.remove('hidden');
      const d = step.x !== undefined ? Math.round(dist(p.x, p.z, step.x, step.z)) : null;
      obj.innerHTML = '<b>' + this.currentMission().title + '</b> — ' + step.text + (d !== null ? ' · ' + d + 'm' : '');
    } else if (this.storyDone) {
      obj.classList.remove('hidden');
      obj.innerHTML = '<b>Free roam</b> — the city is yours. Steal cars, dodge cops, stack cash.';
    } else obj.classList.add('hidden');
    // Interact prompt.
    const inter = el('interact');
    if (p.inCar) { inter.classList.remove('hidden'); inter.innerHTML = '<b>E</b> — exit car'; }
    else {
      const car = this.nearestCar(4.5);
      const stepI = this.missionActive && step && step.type === 'interact' && dist(p.x, p.z, step.x, step.z) < step.r;
      const pkNear = this.pickups.some((pk) => dist(p.x, p.z, pk.x, pk.z) < 2.4);
      if (car) { inter.classList.remove('hidden'); inter.innerHTML = '<b>E</b> — steal car'; }
      else if (stepI) { inter.classList.remove('hidden'); inter.innerHTML = '<b>E</b> — grab the package'; }
      else if (pkNear) { inter.classList.remove('hidden'); inter.innerHTML = '<b>E</b> — pick up'; }
      else inter.classList.add('hidden');
    }
    this.drawMinimap();
  }

  drawMinimap() {
    const cv = el('minimap');
    const g = cv.getContext('2d');
    const S = 190, W = 520;
    const px = (v) => ((v + W / 2) / W) * S;
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#101623'; g.fillRect(0, 0, S, S);
    // Ocean.
    g.fillStyle = '#1d6f8e'; g.fillRect(0, px(216), S, S - px(216));
    // Roads.
    g.strokeStyle = '#3a3f47'; g.lineWidth = 4;
    for (const c of ROAD_COORDS) {
      g.beginPath(); g.moveTo(px(c), 0); g.lineTo(px(c), px(216)); g.stroke();
      g.beginPath(); g.moveTo(0, px(c)); g.lineTo(S, px(c)); g.stroke();
    }
    // Mission marker.
    const step = this.currentStep();
    if (this.missionActive && step && step.x !== undefined) {
      const pulse = 5 + Math.sin(this.elapsed * 5) * 2;
      g.fillStyle = '#ffd23e';
      g.beginPath();
      g.moveTo(px(step.x), px(step.z) - pulse - 3);
      g.lineTo(px(step.x) + pulse, px(step.z));
      g.lineTo(px(step.x), px(step.z) + pulse + 3);
      g.lineTo(px(step.x) - pulse, px(step.z));
      g.closePath(); g.fill();
    }
    // Traffic (white), police (blue).
    g.fillStyle = '#dfe6ee';
    for (const c of this.traffic) g.fillRect(px(c.x) - 1.5, px(c.z) - 1.5, 3, 3);
    g.fillStyle = '#4d8dff';
    for (const c of this.police) {
      g.beginPath(); g.arc(px(c.x), px(c.z), 3.5, 0, Math.PI * 2); g.fill();
    }
    // Player arrow.
    const p = this.player;
    g.save();
    g.translate(px(p.x), px(p.z));
    g.rotate(Math.atan2(Math.sin(p.heading), -Math.cos(p.heading)) + Math.PI);
    g.fillStyle = '#ff5a5a';
    g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(-5, 5); g.closePath(); g.fill();
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); g.stroke();
  }

  // ---------- main driver ----------
  readInput() {
    const k = this.keys;
    return {
      up: !!(k['w'] || k['arrowup']),
      down: !!(k['s'] || k['arrowdown']),
      left: !!(k['a'] || k['arrowleft']),
      right: !!(k['d'] || k['arrowright']),
      sprint: !!k['shift'],
      handbrake: !!k[' '],
      jump: !!k[' '],
    };
  }

  // Fixed-step simulation driven by wall-clock time, so the game runs at
  // full speed even when the renderer is slow (software GL): logic steps
  // catch up in bulk, then one render per frame.
  frame() {
    const now = performance.now();
    if (this._lastT === undefined) this._lastT = now;
    let delta = (now - this._lastT) / 1000;
    this._lastT = now;
    if (delta > 0.5) delta = 0.5;
    this._acc = (this._acc || 0) + delta;
    let steps = 0;
    while (this._acc >= DT && steps < 40) {
      if (this.mode !== 'title' && this.mode !== 'play') break;
      this.update(DT, this.readInput());
      this._acc -= DT;
      steps += 1;
    }
    if (steps >= 40) this._acc = 0; // drop backlog rather than spiral
    if (this.mode === 'title' || this.mode === 'play') {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // ---------- screenshot mode ----------
  // Deterministic staged scenes for screenshots: fixed seed, fixed steps,
  // scripted inputs. After runShot returns, window.__shotReady is set.
  runShot(name) {
    this.shotMode = name;
    const L = this.landmarks;
    if (name === 'start') {
      this.mode = 'title';
      this.titleOrbit = 0.6;
      this.timeHours = 16.5; // golden hour over the city
      this.update(DT, this.readInput());
      window.__shotReady = true;
      return;
    }
    // All other shots: a live game, scripted.
    el('title').classList.add('hidden');
    el('hud').classList.remove('hidden');
    this.mode = 'play';
    this.player.money = 1250;
    this.player.health = 100;
    this.camPitch = 0.45;
    this.camDist = 11;
    const giveCar = (x, z, heading) => {
      const spot = this.parked[0];
      spot.x = x; spot.z = z; spot.heading = heading;
      spot.mesh.position.set(x, 0, z);
      spot.mesh.rotation.y = heading;
      this.player.x = x; this.player.z = z;
      this.enterCar(spot);
      this.player.car.speed = 14;
      return spot;
    };
    const driveToward = (tx, tz, ticks) => {
      for (let i = 0; i < ticks; i++) {
        const car = this.player.car;
        const desired = Math.atan2(tx - car.x, tz - car.z);
        const diff = angleDiff(car.heading, desired);
        const input = { up: true, down: false, left: diff > 0.12, right: diff < -0.12, sprint: false, handbrake: false, jump: false };
        this.update(DT, input);
      }
      this.renderer.render(this.scene, this.camera);
    };
    if (name === 'drive') {
      this.startMission(0);
      this.missionStep = 1; // past the steal step: objective = drive to the garage
      this.beginStep();
      giveCar(0, -156, 0); // on the x=0 road, heading south (+z), mid-city
      driveToward(0, 104, 240);
    } else if (name === 'chase') {
      this.startMission(1);
      this.missionStep = 2;
      this.beginStep();
      this.setWanted(3);
      giveCar(-156, 52, Math.PI / 2); // on the z=52 road, heading east (+x)
      for (let i = 0; i < 3; i++) {
        const cop = this.spawnPoliceCar();
        cop.x = -182 - i * 12; cop.z = 52 + (i - 1) * 7;
        cop.heading = Math.PI / 2;
      }
      // One unit pulls up alongside, so the chase reads in the frame.
      const wingman = this.police[2];
      wingman.x = -140; wingman.z = 55; wingman.heading = Math.PI / 2;
      this.timeHours = 17.2; // dusk, sirens in the streets
      driveToward(156, 52, 150);
    } else if (name === 'mission') {
      this.startMission(1);
      this.missionStep = 2;
      this.beginStep();
      this.setWanted(2);
      this.player.money = 2450;
      giveCar(52, 156, -Math.PI / 2); // on the z=156 road, heading west toward the safehouse
      this.timeHours = 10;
      driveToward(-156, 156, 240);
    }
    this.updateHUD(1);
    this.renderer.render(this.scene, this.camera);
    window.__shotReady = true;
  }
}
