// Vice Shores bootstrap: renderer, third-person camera, keyboard/mouse input,
// HUD wiring (DOM bars, stars, clock, toast, circular minimap) and the main loop.
// Shot modes (?shot=start|drive|chase|mission&seed=1) stage deterministic scenes
// for screenshots; window.__shotReady flips true once a scene is staged.

import * as THREE from '../vendor/three.module.min.js';
import { Game } from './game.js';
import { clamp, angleDiff } from './rng.js';
import { CITY } from './city.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') || null;

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 900);
camera.position.set(0, 8, 34);

// ----- HUD ---------------------------------------------------------------
const $ = id => document.getElementById(id);
const hud = {
  setCash(v) { $('cash').textContent = '$' + v.toLocaleString('en-US'); },
  setHealth(h, a) {
    $('health-fill').style.width = clamp(h, 0, 100) + '%';
    $('armor-fill').style.width = clamp(a, 0, 100) + '%';
  },
  setStars(n) {
    $('stars').textContent = '★'.repeat(n) + '☆'.repeat(5 - n);
    $('stars').classList.toggle('hot', n > 0);
  },
  setClock(dayTime) {
    const mins = Math.floor(dayTime * 24 * 60);
    const hh = String(Math.floor(mins / 60)).padStart(2, '0');
    const mm = String(mins % 60).padStart(2, '0');
    $('clock').textContent = `${hh}:${mm}`;
  },
  setSpeed(kmh) { $('speed').textContent = kmh > 0 ? kmh + ' km/h' : ''; },
  setAmmo(a, r) { $('ammo').textContent = `🔫 ${a} / ${r}`; },
  setObjective(t) { $('objective').textContent = t; },
  toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
  },
  pulseCrosshair() {
    const c = $('crosshair');
    c.classList.remove('pulse');
    void c.offsetWidth;
    c.classList.add('pulse');
  },
  showOver(kind) {
    $('over-title').textContent = kind;
    $('over-sub').textContent = kind === 'BUSTED'
      ? 'The Vice Shores PD caught you. Press any key to walk free.'
      : 'You got wasted. Press any key to wake up at the hospital.';
    $('over-screen').classList.remove('hidden');
  },
  hideOver() { $('over-screen').classList.add('hidden'); },
  updateMinimap(game) { drawMinimap(game); },
};

const minimap = $('minimap');
const mctx = minimap.getContext('2d');
function drawMinimap(game) {
  const S = minimap.width, C = S / 2, scale = S / (CITY.half * 2 + 60);
  mctx.clearRect(0, 0, S, S);
  // Circular mask.
  mctx.save();
  mctx.beginPath();
  mctx.arc(C, C, C - 2, 0, Math.PI * 2);
  mctx.clip();
  mctx.fillStyle = '#2c4a2c';
  mctx.fillRect(0, 0, S, S);
  const toMap = (x, z) => [C + x * scale, C + z * scale];
  // Beach + sea.
  mctx.fillStyle = '#c9b078';
  mctx.fillRect(0, C + CITY.beachAt * scale, S, S);
  mctx.fillStyle = '#1d6f8e';
  mctx.fillRect(0, C + CITY.waterAt * scale, S, S);
  // Roads.
  mctx.strokeStyle = '#3a3d42';
  mctx.lineWidth = Math.max(2, 10 * scale);
  for (const c of game.city.roadXs) {
    const [x1, y1] = toMap(c, -CITY.half);
    const [x2, y2] = toMap(c, CITY.half);
    mctx.beginPath(); mctx.moveTo(x1, y1); mctx.lineTo(x2, y2); mctx.stroke();
    const [x3, y3] = toMap(-CITY.half, c);
    const [x4, y4] = toMap(CITY.half, c);
    mctx.beginPath(); mctx.moveTo(x3, y3); mctx.lineTo(x4, y4); mctx.stroke();
  }
  // Mission marker.
  if (game.markerTarget) {
    const [mx, my] = toMap(game.markerTarget.x, game.markerTarget.z);
    const pulse = 5 + Math.sin(game.time * 4) * 2;
    mctx.fillStyle = '#ffd23a';
    mctx.beginPath(); mctx.arc(mx, my, pulse, 0, Math.PI * 2); mctx.fill();
    mctx.strokeStyle = '#000';
    mctx.lineWidth = 1.5;
    mctx.stroke();
  }
  // Traffic dots, police in red.
  for (const car of game.cars) {
    if (car.dead) continue;
    const [cx, cy] = toMap(car.x, car.z);
    mctx.fillStyle = car.police ? '#ff2e2e' : '#e8e8e8';
    mctx.fillRect(cx - 2, cy - 2, 4, 4);
  }
  // Player arrow (rotates with heading).
  const [px, py] = toMap(game.player.x, game.player.z);
  mctx.save();
  mctx.translate(px, py);
  // Canvas: +x right, +z down. Arrow drawn pointing up; rotate to face heading.
  mctx.rotate(Math.atan2(Math.sin(game.player.heading), -Math.cos(game.player.heading)));
  mctx.fillStyle = '#ffffff';
  mctx.beginPath();
  mctx.moveTo(0, -7); mctx.lineTo(5, 6); mctx.lineTo(-5, 6); mctx.closePath();
  mctx.fill();
  mctx.strokeStyle = '#111';
  mctx.lineWidth = 1;
  mctx.stroke();
  mctx.restore();
  mctx.restore();
  // Ring.
  mctx.strokeStyle = 'rgba(255,255,255,0.85)';
  mctx.lineWidth = 3;
  mctx.beginPath();
  mctx.arc(C, C, C - 2, 0, Math.PI * 2);
  mctx.stroke();
}

// ----- game --------------------------------------------------------------
const game = new Game(scene, camera, hud, { shot: SHOT });
window.__game = game;

// ----- input -------------------------------------------------------------
const keys = {};
let camYaw = Math.PI; // camera looks along +z at start (player faces the city)
let dragging = false;
let lastX = 0, lastY = 0;
let camPitch = 0.32;

const input = {
  get forward() { return keys['KeyW'] || keys['ArrowUp']; },
  get back() { return keys['KeyS'] || keys['ArrowDown']; },
  get left() { return keys['KeyA'] || keys['ArrowLeft']; },
  get right() { return keys['KeyD'] || keys['ArrowRight']; },
  get run() { return keys['ShiftLeft'] || keys['ShiftRight']; },
  get brake() { return keys['Space']; },
  get yaw() { return camYaw; },
  interact: false,
  interactHeld: false,
  shoot: false,
  reloadKey: false,
  anyKey: false,
  shotFired: false,
};

addEventListener('keydown', e => {
  if (e.repeat) return;
  keys[e.code] = true;
  input.anyKey = true;
  game.sounds.ensure();
  if (e.code === 'KeyE') { input.interact = true; input.interactHeld = true; }
  if (e.code === 'KeyR') input.reloadKey = true;
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'KeyM') {
    const muted = game.sounds.toggleMute();
    hud.toast(muted ? 'Sound off' : 'Sound on');
  }
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'KeyE') input.interactHeld = false;
});
canvas.addEventListener('mousedown', e => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  game.sounds.ensure();
  if (game.started && game.player.onFoot && !game.paused && !game.over) {
    // Aim at the camera direction, then fire.
    game.player.heading = camYaw;
    input.shoot = true;
    input.shotFired = true;
  }
});
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', e => {
  if (!dragging) return;
  camYaw -= (e.clientX - lastX) * 0.005;
  camPitch = clamp(camPitch + (e.clientY - lastY) * 0.003, 0.08, 1.1);
  lastX = e.clientX; lastY = e.clientY;
});
addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false; });

function togglePause() {
  if (!game.started || game.over) return;
  game.paused = !game.paused;
  $('pause-screen').classList.toggle('hidden', !game.paused);
  hud.toast(game.paused ? 'Paused — press P to resume' : 'Resumed');
}

// ----- start screen ------------------------------------------------------
const startScreen = $('start-screen');
$('btn-new').addEventListener('click', () => {
  game.sounds.ensure();
  startGame(false);
});
$('btn-continue').addEventListener('click', () => {
  game.sounds.ensure();
  startGame(true);
});
if (!Game.hasSave()) $('btn-continue').disabled = true;
$('btn-how').addEventListener('click', () => {
  $('howto').classList.toggle('hidden');
});
function startGame(continueSave) {
  if (continueSave) {
    if (game.loadSave()) hud.toast('Save loaded — welcome back to Vice Shores.');
  }
  game.started = true;
  startScreen.classList.add('hidden');
  hud.setObjective(game.currentObjective());
  hud.setAmmo(game.ammo, game.ammoReserve);
}

// Shot mode: drive/chase/mission skip the start screen and stage a scene;
// 'start' keeps the title screen up. Signal readiness once staged.
if (SHOT && SHOT !== 'start') {
  game.started = true;
  startScreen.classList.add('hidden');
  hud.setAmmo(game.ammo, game.ammoReserve);
  // Let one frame render, then mark ready for the screenshot script.
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__shotReady = true; }));
} else if (SHOT === 'start') {
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__shotReady = true; }));
}

// ----- camera + loop -----------------------------------------------------
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  const p = game.player;
  const driving = !!game.car;
  if (driving) {
    // Ease the camera behind the car.
    const target = game.car.heading;
    camYaw += angleDiff(camYaw, target) * Math.min(1, dt * 2.2);
  }
  const dist = driving ? 14 : 9.5;
  const height = driving ? 6 : 4.6;
  const cx = p.x - Math.sin(camYaw) * dist;
  const cz = p.z - Math.cos(camYaw) * dist;
  const cy = height + Math.sin(camPitch) * 4;
  camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 8));
  camTarget.set(p.x + Math.sin(camYaw) * 4, 1.6, p.z + Math.cos(camYaw) * 4);
  camera.lookAt(camTarget);
}

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  let dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (game.started) game.update(dt, input);
  updateCamera(dt);
  renderer.render(scene, camera);
  // One-shot input flags.
  input.interact = false;
  input.shoot = false;
  input.reloadKey = false;
  input.anyKey = false;
  input.shotFired = false;
}
requestAnimationFrame(loop);
