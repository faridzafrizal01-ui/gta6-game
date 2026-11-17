// Vice Shores — the entry program (Node 22, standard library only). It hands
// the game in: game/ and screenshots/ are copied from beside this file into
// /output (or $MAKEFUN_OUTPUT_DIR when set), and /output/dossier.json is the
// summary the judge reads, written by the vendored make.fun library.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//   node serve.ts   # play game/ locally on http://localhost:8080
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
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

// The scorer's caps (reference/gate.json): text_max_bytes is the only one that
// shapes the bytes; the rest refuse an entry the scorer would refuse — more
// than 4 screenshots or one over 256 KiB, more than 993 files in game/ or
// 48 MiB of game files in all, or a path under game/ over 1000 bytes.
const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(out, 'dossier.json'), dossier);

// Verify the dossier we just wrote parses back and report its size, so a
// broken hand-in is loud here instead of silent at the scorer.
const parsed = JSON.parse(new TextDecoder().decode(dossier));
console.log(
  `dossier.json: ${dossier.byteLength} bytes, schema ${parsed.schema}, ` +
  `${parsed.images.length} screenshots, cover ${parsed.cover}`,
);
