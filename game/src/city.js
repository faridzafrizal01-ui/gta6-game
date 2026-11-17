// Vice Shores city builder. Everything is procedural boxes/cylinders from a seed:
// a road grid, a downtown of towers, houses, a beach with a pier, palms and lamps.
// Returns the scene group plus the data the game logic needs (colliders, road
// lines, spawn points, beach bounds). No external assets, no network.

import * as THREE from '../vendor/three.module.min.js';
import { makeRng, range, pick } from './rng.js';

export const CITY = {
  half: 210,            // playable ground extends -210..210 on both axes
  roadEvery: 40,        // grid spacing
  roadHalf: 5,          // half width of a road
  beachAt: 168,         // z beyond this is sand, then water
  waterAt: 196,
};

const PALETTE = {
  grass: 0x4a7c3a, asphalt: 0x2b2e33, sidewalk: 0x8d8d84, sand: 0xd9c28a,
  water: 0x1d6f8e, building: [0x9a8f7a, 0x7a8a9a, 0xb08a6a, 0x6a7a6a, 0x8a6a7a, 0x5a6a8a],
  glass: 0x2a4a5a, palm: 0x2f6b2f, trunk: 0x7a5a38, lamp: 0xd8d8c8,
};

function box(w, h, d, color, x, y, z, opts = {}) {
  const mat = new THREE.MeshLambertMaterial({ color, emissive: opts.emissive || 0x000000 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (opts.ry) m.rotation.y = opts.ry;
  m.castShadow = !!opts.shadow;
  m.receiveShadow = true;
  return m;
}

export function buildCity(scene, seed = 20261117) {
  const rng = makeRng(seed);
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];   // {x, z, hx, hz}
  const roadXs = [];
  for (let c = -160; c <= 160; c += CITY.roadEvery) roadXs.push(c);

  // Ground: grass slab, then road strips, sidewalks, sand and water.
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(CITY.half * 2 + 80, 1, CITY.half * 2 + 80),
    new THREE.MeshLambertMaterial({ color: PALETTE.grass }));
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  group.add(ground);

  const roadMat = new THREE.MeshLambertMaterial({ color: PALETTE.asphalt });
  for (const c of roadXs) {
    for (const [w, d, x, z] of [
      [CITY.roadHalf * 2, CITY.half * 2, c, 0],
      [CITY.half * 2, CITY.roadHalf * 2, 0, c],
    ]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), roadMat);
      r.position.set(x, 0.06, z);
      r.receiveShadow = true;
      group.add(r);
    }
  }
  // Dashed centre lines.
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xd8c84a });
  for (const c of roadXs) {
    for (let t = -200; t < 200; t += 12) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 5), lineMat);
      dash.position.set(c, 0.12, t);
      group.add(dash);
    }
  }

  // Beach + sea at the south edge, and a wooden pier.
  const sand = new THREE.Mesh(new THREE.BoxGeometry(CITY.half * 2 + 80, 0.3, CITY.waterAt - CITY.beachAt + 8),
    new THREE.MeshLambertMaterial({ color: PALETTE.sand }));
  sand.position.set(0, 0.1, (CITY.beachAt + CITY.waterAt) / 2);
  sand.receiveShadow = true;
  group.add(sand);
  const sea = new THREE.Mesh(new THREE.BoxGeometry(CITY.half * 2 + 260, 0.2, 120),
    new THREE.MeshLambertMaterial({ color: PALETTE.water }));
  sea.position.set(0, 0.05, CITY.waterAt + 60);
  group.add(sea);
  const pierMat = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
  for (let z = CITY.beachAt; z < CITY.waterAt + 46; z += 6) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(10, 0.3, 5), pierMat);
    plank.position.set(0, 0.7, z);
    group.add(plank);
  }
  for (const px of [-4.5, 4.5]) for (let z = CITY.beachAt; z < CITY.waterAt + 46; z += 12) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 2.4, 6), pierMat);
    post.position.set(px, 0, z);
    group.add(post);
  }

  // Buildings: towers downtown, houses elsewhere. Every block between roads
  // gets 1-4 buildings, each registered as a collider.
  const downtown = (x, z) => Math.abs(x) < 60 && Math.abs(z) < 60;
  for (let ix = 0; ix < roadXs.length - 1; ix++) {
    for (let iz = 0; iz < roadXs.length - 1; iz++) {
      const x0 = roadXs[ix] + CITY.roadHalf + 3, x1 = roadXs[ix + 1] - CITY.roadHalf - 3;
      const z0 = roadXs[iz] + CITY.roadHalf + 3, z1 = roadXs[iz + 1] - CITY.roadHalf - 3;
      if (z0 > CITY.beachAt - 4) continue; // no buildings on the sand
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const bw = x1 - x0, bd = z1 - z0;
      if (downtown(cx, cz)) {
        const h = range(rng, 26, 64);
        const tower = box(range(rng, 14, 20), h, range(rng, 14, 20),
          pick(rng, PALETTE.building), cx + range(rng, -3, 3), h / 2, cz + range(rng, -3, 3), { shadow: true });
        group.add(tower);
        // Lit window band near the top.
        const band = box(tower.geometry.parameters.width + 0.3, 2, tower.geometry.parameters.depth + 0.3,
          0xffe9a8, tower.position.x, h * 0.72, tower.position.z, { emissive: 0x554411 });
        group.add(band);
        colliders.push({ x: tower.position.x, z: tower.position.z, hx: 11, hz: 11 });
      } else {
        const n = 1 + Math.floor(rng() * 2);
        for (let k = 0; k < n; k++) {
          const w = range(rng, 7, 12), d = range(rng, 7, 12), h = range(rng, 4, 9);
          const bx = cx + range(rng, -bw / 4, bw / 4), bz = cz + range(rng, -bd / 4, bd / 4);
          const house = box(w, h, d, pick(rng, PALETTE.building), bx, h / 2, bz, { shadow: true });
          group.add(house);
          const roof = box(w + 0.6, 0.8, d + 0.6, 0x5a3a2a, bx, h + 0.4, bz);
          group.add(roof);
          colliders.push({ x: bx, z: bz, hx: w / 2 + 0.4, hz: d / 2 + 0.4 });
        }
      }
    }
  }

  // Palms along the beach and scattered in parks; lamps at road corners.
  const palmSpots = [];
  for (let x = -180; x <= 180; x += 18) palmSpots.push([x + range(rng, -4, 4), CITY.beachAt + 6 + rng() * 10]);
  for (let i = 0; i < 26; i++) palmSpots.push([range(rng, -170, 170), range(rng, -170, 150)]);
  for (const [px, pz] of palmSpots) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.45, 6, 6),
      new THREE.MeshLambertMaterial({ color: PALETTE.trunk }));
    trunk.position.set(px, 3, pz);
    trunk.rotation.z = range(rng, -0.12, 0.12);
    group.add(trunk);
    const top = new THREE.Mesh(new THREE.ConeGeometry(2.6, 3.2, 7),
      new THREE.MeshLambertMaterial({ color: PALETTE.palm }));
    top.position.set(px, 7.2, pz);
    group.add(top);
  }
  const lamps = [];
  for (const c of roadXs) for (const d of roadXs) {
    if (Math.abs(c) > 160 || Math.abs(d) > 160 || d > CITY.beachAt - 8) continue;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6.5, 6),
      new THREE.MeshLambertMaterial({ color: 0x3a3a3a }));
    pole.position.set(c + 6, 3.25, d + 6);
    group.add(pole);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), bulbMat);
    bulb.position.set(c + 6, 6.6, d + 6);
    group.add(bulb);
    lamps.push(bulbMat);
  }

  // Landmarks the missions use: bank (downtown), pier end, plaza.
  const bank = box(18, 12, 14, 0xd8c8a0, -20, 6, -20, { shadow: true });
  group.add(bank);
  colliders.push({ x: -20, z: -20, hx: 9.4, hz: 7.4 });

  return { group, colliders, roadXs, lamps, rng };
}

// Circle (radius r) vs axis-aligned colliders: push the point out, return true on hit.
export function collideCircle(x, z, r, colliders) {
  let hit = false;
  for (const c of colliders) {
    const nx = Math.max(c.x - c.hx, Math.min(x, c.x + c.hx));
    const nz = Math.max(c.z - c.hz, Math.min(z, c.z + c.hz));
    const dx = x - nx, dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      hit = true;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        x = nx + (dx / d) * r;
        z = nz + (dz / d) * r;
      } else {
        x += r; // dead centre: nudge out
      }
    }
  }
  return { x, z, hit };
}

// Snap a point onto the nearest road line (used by traffic AI).
export function nearestRoad(v, roadXs) {
  let best = roadXs[0], bd = Infinity;
  for (const c of roadXs) { const d = Math.abs(v - c); if (d < bd) { bd = d; best = c; } }
  return best;
}
