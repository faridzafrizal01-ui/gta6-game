// Retakes the four Vice Shores screenshots with Playwright: start screen,
// driving, police chase and a mission. Serves game/ locally, loads each staged
// scene (?shot=…&seed=1), waits for window.__shotReady, checks for console and
// page errors, and writes JPEGs under 256 KiB into screenshots/.
// Run: node tools/shots.mjs

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require('/home/hatch/workspace/makefun/node_modules/playwright-core');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const PORT = 8901;
const SHOTS = [
  { name: '1-start.jpg', query: '?shot=start&seed=1' },
  { name: '2-drive.jpg', query: '?shot=drive&seed=1' },
  { name: '3-chase.jpg', query: '?shot=chase&seed=1' },
  { name: '4-mission.jpg', query: '?shot=mission&seed=1' },
];

function findChromium() {
  const base = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(base)) return undefined;
  for (const dir of readdirSync(base)) {
    if (!dir.startsWith('chromium')) continue;
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const p = join(base, dir, sub);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

async function waitForServer(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('server did not come up: ' + url);
}

const server = spawn(process.execPath, [join(root, 'serve.ts'), '--port', String(PORT)], {
  stdio: 'inherit',
});
let failed = false;
try {
  await waitForServer(`http://127.0.0.1:${PORT}/`);
  const executablePath = findChromium();
  const browser = await chromium.launch({
    executablePath,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  for (const shot of SHOTS) {
    errors.length = 0;
    await page.goto(`http://127.0.0.1:${PORT}/${shot.query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true, { timeout: 20000 });
    await page.waitForTimeout(1200); // let the scene settle: traffic, sirens, marker bob
    const out = join(root, 'screenshots', shot.name);
    await page.screenshot({ path: out, type: 'jpeg', quality: 72 });
    const size = statSync(out).size;
    console.log(`${shot.name}: ${size} bytes${size > 262144 ? '  OVER 256 KiB!' : ''}`);
    if (size > 262144) failed = true;
    if (errors.length) {
      console.error(`${shot.name}: ${errors.length} error(s):\n  ` + errors.join('\n  '));
      failed = true;
    }
  }
  await browser.close();
} finally {
  server.kill();
}
if (failed) { console.error('SHOT RUN FAILED'); process.exit(1); }
console.log('all 4 screenshots OK, 0 errors');
