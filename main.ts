// Vice Shores entry program (Node 22, standard library only): hands the game in.
// It copies game/ and screenshots/ from beside this file to /output (or
// $MAKEFUN_OUTPUT_DIR outside the grader) and writes /output/dossier.json with
// the scorer's own library, buildDossier from ./vendor/makefun-game.ts.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The scorer's caps: text_max_bytes shapes the dossier bytes; the rest refuse
// an entry the scorer would refuse (more than 4 screenshots or one over 256 KiB;
// more than 993 files in game/ or 48 MiB of game files in all; a path under
// game/ over 1000 bytes).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
console.log(`dossier written to ${join(out, 'dossier.json')}`);
// Read it back and report what was handed in, so a bad run is visible at once.
const dossierPath = join(out, 'dossier.json');
const dossierBytes = statSync(dossierPath).size;
const shotNames = existsSync(join(out, 'screenshots')) ? readdirSync(join(out, 'screenshots')) : [];
console.log(`dossier: ${dossierBytes} bytes, ${shotNames.length} screenshot(s): ${shotNames.join(', ')}`);
