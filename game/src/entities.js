// Cars, pedestrians, police and pickups for Vice Shores. All models are built
// from boxes and cylinders at runtime — no model files. Traffic follows the road
// grid; pedestrians stroll the sidewalks and flee gunfire; police chase and ram.

import * as THREE from '../vendor/three.module.min.js';
import { makeRng, range, pick, clamp, angleDiff, dist2 } from './rng.js';
import { CITY, collideCircle, nearestRoad } from './city.js';

const CAR_COLORS = [0xc23b2e, 0x2e6bc2, 0xd8b83a, 0x3aa84f, 0x8a4fb0, 0xd8d8d8, 0x222222, 0xe07a2e];

export function makeCarMesh(color, isPolice = false) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: isPolice ? 0x1a1a22 : color });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.62, 4.3), bodyMat);
  body.position.y = 0.62;
  body.castShadow = true;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.58, 2.2),
    new THREE.MeshLambertMaterial({ color: 0x18242e }));
  cabin.position.set(0, 1.18, -0.25);
  cabin.castShadow = true;
  g.add(cabin);
  if (isPolice) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.22, 0.5),
      new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x888888 }));
    bar.position.set(0, 1.55, -0.25);
    g.add(bar);
    g.userData.lightBar = bar;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.2, 4.32),
      new THREE.MeshLambertMaterial({ color: 0xffffff }));
    stripe.position.y = 0.86;
    g.add(stripe);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 12);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  g.userData.wheels = [];
  for (const [wx, wz] of [[-1.0, 1.45], [1.0, 1.45], [-1.0, -1.45], [1.0, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.42, wz);
    g.add(w);
    g.userData.wheels.push(w);
  }
  // Headlights.
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
  for (const hx of [-0.7, 0.7]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.08), lampMat);
    lamp.position.set(hx, 0.68, 2.16);
    g.add(lamp);
  }
  return g;
}

// A drivable / traffic car. heading 0 = facing -z (north).
export class Car {
  constructor(scene, x, z, heading, color, opts = {}) {
    this.mesh = makeCarMesh(color, !!opts.police);
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = heading;
    scene.add(this.mesh);
    this.x = x; this.z = z; this.heading = heading;
    this.speed = 0;
    this.maxSpeed = opts.maxSpeed || 26;
    this.color = color;
    this.police = !!opts.police;
    this.stolen = false;
    this.dead = false;
    // Traffic AI state: which road axis it follows and which way.
    this.axis = opts.axis || 'x';
    this.dir = opts.dir || 1;
    this.lane = (opts.lane ?? 1) * 2.2;
    this.targetSpeed = range(makeRng((x * 13 + z * 7) | 0), 8, 13);
    this.wait = 0;
  }

  get pos() { return { x: this.x, z: this.z }; }

  // Arcade drive step. input: {throttle (-1..1), steer (-1..1), brake}.
  drive(dt, input, colliders) {
    const accel = 22;
    if (input.throttle > 0) this.speed += accel * input.throttle * dt;
    else if (input.throttle < 0) this.speed -= (this.speed > 0.5 ? 30 : 12) * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 8 * dt);
    if (input.brake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 40 * dt);
    this.speed = clamp(this.speed, -10, this.maxSpeed);
    const steerAuthority = clamp(Math.abs(this.speed) / 8, 0, 1) * (this.speed >= 0 ? 1 : -1);
    this.heading += input.steer * 1.9 * steerAuthority * dt;
    const nx = this.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.z + Math.cos(this.heading) * this.speed * dt;
    const res = collideCircle(nx, nz, 1.9, colliders);
    if (res.hit && Math.abs(this.speed) > 6) this.speed *= 0.45;
    this.x = clamp(res.x, -CITY.half, CITY.half);
    this.z = clamp(res.z, -CITY.half, CITY.half);
    this.syncMesh();
  }

  // Traffic: cruise along a road, turn at intersections, stop briefly at random.
  cruise(dt, colliders, others) {
    if (this.wait > 0) { this.wait -= dt; this.speed = 0; this.syncMesh(); return; }
    const target = this.targetSpeed;
    this.speed += clamp(target - this.speed, -14 * dt, 10 * dt);
    let nx = this.x, nz = this.z;
    if (this.axis === 'x') { nx += this.dir * this.speed * dt; }
    else { nz += this.dir * this.speed * dt; }
    // Car ahead? Slow down instead of rear-ending it.
    for (const o of others) {
      if (o === this || o.dead) continue;
      const d2 = dist2(nx, nz, o.x, o.z);
      if (d2 < 30) { this.speed = Math.min(this.speed, 2); }
    }
    const res = collideCircle(nx, nz, 1.9, colliders);
    this.x = clamp(res.x, -CITY.half, CITY.half);
    this.z = clamp(res.z, -CITY.half, CITY.half);
    // At an intersection, sometimes turn onto the crossing road.
    const onX = Math.abs(this.x - nearestRoad(this.x, [0])) < 999; // (kept simple below)
    const nearX = Math.abs(this.x % CITY.roadEvery) < 1.2 || Math.abs(this.x % CITY.roadEvery - CITY.roadEvery) < 1.2;
    if (this.axis === 'x' && Math.abs(((this.x % CITY.roadEvery) + CITY.roadEvery) % CITY.roadEvery) < 1.0) {
      if (Math.random() < 0.25) this.turnOnto('z');
    }
    if (this.axis === 'z' && Math.abs(((this.z % CITY.roadEvery) + CITY.roadEvery) % CITY.roadEvery) < 1.0) {
      if (Math.random() < 0.25) this.turnOnto('x');
    }
    if (Math.random() < 0.0006) this.wait = 1 + Math.random() * 2;
    this.syncMesh();
  }

  turnOnto(axis) {
    this.axis = axis;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    if (axis === 'x') this.heading = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    else this.heading = this.dir > 0 ? Math.PI : 0;
    // Snap onto the road line so turns stay on the grid.
    if (axis === 'x') this.z = nearestRoad(this.z, roadGrid());
    else this.x = nearestRoad(this.x, roadGrid());
  }

  syncMesh() {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
    const spin = this.speed * 0.12;
    for (const w of this.mesh.userData.wheels) w.rotation.x += spin;
  }

  remove(scene) {
    scene.remove(this.mesh);
    this.dead = true;
  }
}

let _grid = null;
function roadGrid() {
  if (!_grid) { _grid = []; for (let c = -160; c <= 160; c += CITY.roadEvery) _grid.push(c); }
  return _grid;
}

export function spawnTrafficCar(scene, rng, colliders) {
  const axis = rng() < 0.5 ? 'x' : 'z';
  const road = pick(rng, roadGrid());
  const along = range(rng, -180, 180);
  const x = axis === 'x' ? along : road;
  const z = axis === 'x' ? road : along;
  const dir = rng() < 0.5 ? 1 : -1;
  const heading = axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? Math.PI : 0);
  const car = new Car(scene, x, z, heading, pick(rng, CAR_COLORS), { axis, dir });
  return car;
}

// A pedestrian: box body, head, swinging arms, wanders sidewalks, flees danger.
export class Ped {
  constructor(scene, rng, x, z) {
    this.rng = rng;
    const g = new THREE.Group();
    const shirt = pick(rng, [0xd84a4a, 0x4a7ad8, 0x4ad87a, 0xd8c84a, 0x8a4ad8, 0xd8d8d8]);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.4),
      new THREE.MeshLambertMaterial({ color: shirt }));
    body.position.y = 1.0;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshLambertMaterial({ color: pick(rng, [0xe8b88a, 0xc88a5a, 0x8a5a3a]) }));
    head.position.y = 1.75;
    g.add(head);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.35),
      new THREE.MeshLambertMaterial({ color: 0x2a2a3a }));
    legs.position.y = 0.38;
    g.add(legs);
    this.armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8, 0.16),
      new THREE.MeshLambertMaterial({ color: shirt }));
    this.armL.position.set(-0.45, 1.05, 0);
    g.add(this.armL);
    this.armR = this.armL.clone();
    this.armR.position.x = 0.45;
    g.add(this.armR);
    this.mesh = g;
    this.mesh.position.set(x, 0, z);
    scene.add(this.mesh);
    this.x = x; this.z = z;
    this.heading = rng() * Math.PI * 2;
    this.speed = range(rng, 1.2, 2.2);
    this.fleeing = 0;
    this.walkPhase = rng() * 6;
    this.dead = false;
  }

  update(dt, danger, colliders) {
    if (this.dead) return;
    this.walkPhase += dt * 6;
    let speed = this.speed;
    if (danger) {
      const d2 = dist2(this.x, this.z, danger.x, danger.z);
      if (d2 < 900) {
        this.fleeing = 2.5;
        this.heading = Math.atan2(this.x - danger.x, this.z - danger.z);
        speed = 5.5;
      }
    }
    if (this.fleeing > 0) this.fleeing -= dt;
    else if (Math.random() < 0.003) this.heading += range(this.rng, -1.2, 1.2);
    const nx = this.x + Math.sin(this.heading) * speed * dt;
    const nz = this.z + Math.cos(this.heading) * speed * dt;
    const res = collideCircle(nx, nz, 0.5, colliders);
    this.x = clamp(res.x, -CITY.half, CITY.half);
    this.z = clamp(res.z, -CITY.half, CITY.half);
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
    const swing = Math.sin(this.walkPhase) * 0.55;
    this.armL.rotation.x = swing;
    this.armR.rotation.x = -swing;
  }

  remove(scene) { scene.remove(this.mesh); this.dead = true; }
}

// Floating pickup: cash, health or armour. Spins and bobs; respawns elsewhere.
export class Pickup {
  constructor(scene, rng, kind, x, z) {
    this.kind = kind; // 'cash' | 'health' | 'armor'
    this.rng = rng;
    const color = kind === 'cash' ? 0x39d353 : kind === 'health' ? 0xe5484d : 0x4a9eda;
    const geo = kind === 'cash' ? new THREE.BoxGeometry(0.9, 0.5, 0.12)
      : new THREE.IcosahedronGeometry(0.6, 0);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 }));
    this.mesh.position.set(x, 1.4, z);
    scene.add(this.mesh);
    this.x = x; this.z = z;
    this.taken = false;
    this.spin = rng() * 6;
  }

  update(dt) {
    if (this.taken) return;
    this.spin += dt * 2.4;
    this.mesh.rotation.y = this.spin;
    this.mesh.position.y = 1.4 + Math.sin(this.spin * 1.6) * 0.2;
  }

  take(scene) { scene.remove(this.mesh); this.taken = true; }
}

export function randomStreetSpot(rng, roadXs) {
  const road = pick(rng, roadXs);
  const along = range(rng, -180, 180);
  return rng() < 0.5 ? { x: along, z: road + 8 } : { x: road + 8, z: along };
}
