// Vice Shores — boot. Creates the game, runs the frame loop, and handles the
// ?shot= scenes used for the entry screenshots (fixed seed, fixed steps).
import { Game } from './game.js';

const params = new URLSearchParams(window.location.search);
const seed = Number(params.get('seed') || '1337') || 1337;
const shot = params.get('shot');

const canvas = document.getElementById('game');
const game = new Game(canvas, seed);
window.__game = game;

if (shot) {
  // Screenshot mode: no animation loop, the scene is staged and rendered once.
  game.runShot(shot);
} else {
  const loop = () => {
    requestAnimationFrame(loop);
    game.frame();
  };
  requestAnimationFrame(loop);
}
