// Vice Shores: a seeded coastal city. Roads on a grid, buildings in the blocks
// between them, a beach and ocean along the south edge, and fixed landmarks the
// story missions use. Everything here is original art made from boxes, canvas
// textures and a little geometry — no imported assets.
import * as THREE from '../vendor/three.module.js';
import { clamp, dist, pick } from './util.js';

export const ROAD_PITCH = 52;
export const ROAD_W = 12;
export const ROAD_COORDS = [-208, -156, -104, -52, 0, 52, 104, 156, 208];
export const CITY_HALF = 260;

const PALETTE = {
  asphalt: '#2b2f36', sidewalk: '#7d838d', block: '#6a7078',
  sand: '#d9bd8a', grass: '#4d7a45', water: '#1d6f8e',
};

function groundTexture() {
  const S = 2048, W = 520;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  const px = (v) => ((v + W / 2) / W) * S;
  g.fillStyle = PALETTE.sidewalk; g.fillRect(0, 0, S, S);
  // Beach strip along the south edge (high z).
  g.fillStyle = PALETTE.sand; g.fillRect(0, px(216), S, S - px(216));
  g.fillStyle = '#c9a86f';
  for (let x = -260; x < 260; x += 18) g.fillRect(px(x), px(216 + ((x * 7) % 13)), 5, 3);
  // Blocks.
  g.fillStyle = PALETTE.block;
  for (const bx of ROAD_COORDS) for (const bz of ROAD_COORDS) {
    // block between road bx and next road: draw block squares centred between roads
  }
  for (let i = 0; i < ROAD_COORDS.length - 1; i++) {
    for (let j = 0; j < ROAD_COORDS.length - 1; j++) {
      const x0 = ROAD_COORDS[i] + ROAD_W / 2, x1 = ROAD_COORDS[i + 1] - ROAD_W / 2;
      const z0 = ROAD_COORDS[j] + ROAD_W / 2, z1 = ROAD_COORDS[j + 1] - ROAD_W / 2;
      g.fillRect(px(x0), px(z0), px(x1) - px(x0), px(z1) - px(z0));
    }
  }
  // Roads.
  g.fillStyle = PALETTE.asphalt;
  for (const c of ROAD_COORDS) {
    g.fillRect(px(c - ROAD_W / 2), 0, px(ROAD_W), px(216));
    g.fillRect(0, px(c - ROAD_W / 2), S, px(ROAD_W));
  }
  // Lane dashes.
  g.fillStyle = '#e8c33a';
  for (const c of ROAD_COORDS) {
    for (let v = -250; v < 210; v += 16) {
      g.fillRect(px(c) - 2, px(v), 4, 8);
      g.fillRect(px(v), px(c) - 2, 8, 4);
    }
  }
  // Crosswalks at intersections.
  g.fillStyle = 'rgba(240,240,240,0.85)';
  for (const cx of ROAD_COORDS) for (const cz of ROAD_COORDS) {
    if (cz > 210) continue;
    for (let k = -2; k <= 2; k++) {
      g.fillRect(px(cx - 5 + k * 2), px(cz - 5), 1.4, 10);
      g.fillRect(px(cx - 5), px(cz - 5 + k * 2), 10, 1.4);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function windowTexture(base, lit, rng) {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  for (let y = 10; y < 246; y += 22) {
    for (let x = 10; x < 118; x += 18) {
      const on = rng() < 0.45;
      g.fillStyle = on ? lit : 'rgba(10,14,22,0.9)';
      g.fillRect(x, y, 12, 14);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeCar(color, isPolice) {
  const group = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x14181f });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.62, 4.4), paint);
  body.position.y = 0.55; group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.2), dark);
  cabin.position.set(0, 1.1, -0.2); group.add(cabin);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.25, 0.3), dark);
  bumper.position.set(0, 0.32, 2.2); group.add(bumper);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x0c0e12 });
  const wheels = [];
  for (const [x, z] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2; w.position.set(x, 0.36, z);
    group.add(w); wheels.push(w);
  }
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  for (const x of [-0.6, 0.6]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), lightMat);
    hl.position.set(x, 0.62, 2.22); group.add(hl);
  }
  if (isPolice) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.4),
      new THREE.MeshBasicMaterial({ color: 0x2244ff }));
    bar.position.set(0, 1.45, -0.2); group.add(bar);
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.17, 0.42),
      new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    bar2.position.set(0.55, 1.45, -0.2); group.add(bar2);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.2, 4.42),
      new THREE.MeshBasicMaterial({ color: 0x111111 }));
    stripe.position.y = 0.72; group.add(stripe);
  }
  group.userData.wheels = wheels;
  return group;
}

export function makePerson(shirt, pants, isCop) {
  const group = new THREE.Group();
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const skinMat = new THREE.MeshLambertMaterial({ color: 0xc98d64 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.36), shirtMat);
  torso.position.y = 1.18; group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 0.4), skinMat);
  head.position.y = 1.78; group.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.42),
    new THREE.MeshLambertMaterial({ color: isCop ? 0x1a1a1a : 0x3a2a18 }));
  hair.position.y = 2.02; group.add(hair);
  if (isCop) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.1, 0.44),
      new THREE.MeshLambertMaterial({ color: 0x1d3a6e }));
    cap.position.y = 2.06; group.add(cap);
  }
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.8, 0.26), pantsMat);
  legL.position.set(-0.17, 0.42, 0); group.add(legL);
  const legR = legL.clone(); legR.position.x = 0.17; group.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.66, 0.2), shirtMat);
  armL.position.set(-0.42, 1.18, 0); group.add(armL);
  const armR = armL.clone(); armR.position.x = 0.42; group.add(armR);
  group.userData.limbs = { legL, legR, armL, armR };
  return group;
}

function makePalm(rng) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, 5.2, 6),
    new THREE.MeshLambertMaterial({ color: 0x7a5a34 }));
  trunk.position.y = 2.6; trunk.rotation.z = (rng() - 0.5) * 0.2; g.add(trunk);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2f7a3a });
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.5), leafMat);
    const a = (i / 6) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 1.1, 5.3, Math.sin(a) * 1.1);
    leaf.rotation.y = -a; leaf.rotation.z = 0.35;
    g.add(leaf);
  }
  return g;
}

export function buildWorld(scene, rng) {
  const world = {
    buildings: [], // {minX,maxX,minZ,maxZ,h}
    parkedSpots: [], // {x,z,heading}
    landmarks: {
      bank: { x: 26, z: -78 },
      garage: { x: -78, z: 130 },
      pickup: { x: 130, z: -130 },
      plaza: { x: 130, z: 130 },
      safehouse: { x: -182, z: 182 },
      hospital: { x: -182, z: -182 },
    },
    bounds: CITY_HALF,
  };

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(520, 520),
    new THREE.MeshLambertMaterial({ map: groundTexture() }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Ocean beyond the beach.
  const ocean = new THREE.Mesh(
    new THREE.PlaneGeometry(560, 120),
    new THREE.MeshLambertMaterial({ color: 0x1d6f8e }));
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.2, 320);
  scene.add(ocean);
  const pier = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 60),
    new THREE.MeshLambertMaterial({ color: 0x8a6a44 }));
  pier.position.set(80, 0.2, 280); scene.add(pier);

  // Building window textures.
  const winTex = [
    windowTexture('#3a4152', '#ffd97a', rng),
    windowTexture('#4a3a52', '#9fd8ff', rng),
    windowTexture('#2e3a34', '#ffe9a8', rng),
  ];

  const reserved = new Set();
  for (const lm of Object.values(world.landmarks)) {
    const bx = Math.round((lm.x + 208) / ROAD_PITCH);
    const bz = Math.round((lm.z + 208) / ROAD_PITCH);
    reserved.add(bx + ',' + bz);
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < ROAD_COORDS.length - 1; i++) {
    for (let j = 0; j < ROAD_COORDS.length - 1; j++) {
      const cx = (ROAD_COORDS[i] + ROAD_COORDS[i + 1]) / 2;
      const cz = (ROAD_COORDS[j] + ROAD_COORDS[j + 1]) / 2;
      if (cz > 208) continue; // beach row
      if (reserved.has(i + ',' + j)) continue;
      const downtown = 1 - clamp(dist(cx, cz, 0, 0) / 300, 0, 1);
      const count = rng() < 0.45 ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const w = 14 + rng() * 16, d = 12 + rng() * 14;
        const ox = count === 1 ? 0 : (k === 0 ? -11 : 11) * (rng() < 0.5 ? 1 : 0.4);
        const oz = count === 1 ? 0 : (k === 0 ? 10 : -10) * 0.5;
        const h = 7 + rng() * 10 + downtown * (8 + rng() * 26);
        const mat = new THREE.MeshLambertMaterial({ map: pick(rng, winTex) });
        const b = new THREE.Mesh(boxGeo, mat);
        b.scale.set(w, h, d);
        b.position.set(cx + ox, h / 2, cz + oz);
        scene.add(b);
        // Rooftop box.
        const roof = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x22262e }));
        roof.scale.set(w * 0.3, 1.6, d * 0.3);
        roof.position.set(cx + ox, h + 0.8, cz + oz);
        scene.add(roof);
        world.buildings.push({
          minX: cx + ox - w / 2, maxX: cx + ox + w / 2,
          minZ: cz + oz - d / 2, maxZ: cz + oz + d / 2, h,
        });
      }
    }
  }

  // Landmark buildings (distinct looks, still boxes + signs).
  const landmarkDefs = [
    { key: 'bank', color: 0xd8c98a, h: 16, label: 'SHORES BANK' },
    { key: 'garage', color: 0x8a4a3a, h: 9, label: 'DELIA\'S GARAGE' },
    { key: 'safehouse', color: 0x4a6a8a, h: 11, label: 'SAFEHOUSE' },
    { key: 'hospital', color: 0xd8d8d8, h: 13, label: 'GENERAL HOSPITAL' },
  ];
  for (const def of landmarkDefs) {
    const lm = world.landmarks[def.key];
    const mat = new THREE.MeshLambertMaterial({ color: def.color, map: winTex[0] });
    const b = new THREE.Mesh(boxGeo, mat);
    b.scale.set(26, def.h, 20);
    b.position.set(lm.x, def.h / 2, lm.z);
    scene.add(b);
    world.buildings.push({
      minX: lm.x - 13, maxX: lm.x + 13, minZ: lm.z - 10, maxZ: lm.z + 10, h: def.h,
    });
  }

  // Plaza: park with grass, trees and benches.
  {
    const p = world.landmarks.plaza;
    const lawn = new THREE.Mesh(new THREE.BoxGeometry(38, 0.4, 38),
      new THREE.MeshLambertMaterial({ color: 0x4d7a45 }));
    lawn.position.set(p.x, 0.2, p.z); scene.add(lawn);
    for (let i = 0; i < 8; i++) {
      const palm = makePalm(rng);
      palm.position.set(p.x - 15 + rng() * 30, 0, p.z - 15 + rng() * 30);
      scene.add(palm);
    }
    const fountain = new THREE.Mesh(new THREE.CylinderGeometry(4, 4.5, 1.2, 16),
      new THREE.MeshLambertMaterial({ color: 0x9fb8c8 }));
    fountain.position.set(p.x, 0.6, p.z); scene.add(fountain);
  }

  // Palm trees along the beach.
  for (let x = -240; x <= 240; x += 26) {
    if (Math.abs(x - 80) < 12) continue; // pier gap
    const palm = makePalm(rng);
    palm.position.set(x + (rng() - 0.5) * 8, 0, 228 + rng() * 8);
    scene.add(palm);
  }

  // Streetlights at intersections.
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x30343c });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const lampGeo = new THREE.SphereGeometry(0.5, 8, 6);
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 6, 6);
  for (const cx of ROAD_COORDS) for (const cz of ROAD_COORDS) {
    if (cz > 208) continue;
    if (rng() < 0.4) continue;
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(cx + 7.5, 3, cz + 7.5); scene.add(pole);
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(cx + 7.5, 6.2, cz + 7.5); scene.add(lamp);
  }

  // Parked cars along road edges.
  const carColors = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xe67e22, 0x95a5a6, 0x1abc9c, 0xd35400, 0x34495e];
  for (let n = 0; n < 16; n++) {
    const alongZ = rng() < 0.5;
    const road = pick(rng, ROAD_COORDS);
    const seg = pick(rng, ROAD_COORDS.slice(0, -1)) + 26 + (rng() - 0.5) * 20;
    const side = rng() < 0.5 ? -1 : 1;
    const x = alongZ ? road + side * 9.2 : seg;
    const z = alongZ ? seg : road + side * 9.2;
    const heading = alongZ ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
    world.parkedSpots.push({ x, z, heading, color: pick(rng, carColors) });
  }

  return world;
}
