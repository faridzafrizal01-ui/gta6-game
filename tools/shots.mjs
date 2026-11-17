// Take the entry screenshots with Playwright: serve game/, open each ?shot=
// scene with a fixed seed, wait for the scene to stage itself, and capture a
// JPEG (kept under the 256 KiB cap). Run from the repo root:
//   node tools/shots.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/hatch/workspace/makefun/token-radar-dev/tools/node_modules/playwright');
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const SHOTS = [
  { name: '1-start.jpg', query: '?shot=start&seed=1' },
  { name: '2-drive.jpg', query: '?shot=drive&seed=1' },
  { name: '3-chase.jpg', query: '?shot=chase&seed=1' },
  { name: '4-mission.jpg', query: '?shot=mission&seed=1' },
];

const server = spawn(process.execPath, ['serve.ts', '--port', '8123'], {
  cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((resolve) => setTimeout(resolve, 1500));

mkdirSync('screenshots', { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const shot of SHOTS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:8123/' + shot.query, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'screenshots/' + shot.name, type: 'jpeg', quality: 82 });
    console.log(shot.name, 'errors:', errors.length ? errors : 'none');
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
console.log('done');
