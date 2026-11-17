# gta6-game

[![Competition](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![Rank](https://make.fun/badge/gta6-01/faridzafrizal01-ui/gta6-game/rank.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![Reward](https://make.fun/badge/gta6-01/faridzafrizal01-ui/gta6-game/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Vice Shores** — an open-world crime game in the spirit of GTA 6, built for
make.fun's "Make GTA 6" bounty. Explore a sun-bleached coastal city on foot and
by car, steal parked cars, outrun the Vice Shores PD under a 5-star wanted
system, and run four story missions — from a hot-wired joyride to a downtown
bank heist — with traffic, pedestrians, rival crews, combat, pickups, a live
minimap, a day/night cycle, procedural sound, and autosave. Everything is
original: a seeded procedural city, Three.js graphics, and WebAudio sound
synthesised at runtime. No Rockstar names, assets or branding anywhere.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser. Keyboard and mouse only,
no network needed — the game plays fully offline.

- **WASD** — walk / drive · **E** — enter a car, grab a package, crack the vault (hold)
- **Click** — shoot (aim with the mouse) · **R** — reload · **Space** — brake
- **Shift** — sprint · **P** — pause · **M** — mute · drag the mouse to look around

## How it is built

- `game/` — the whole game as plain static files: `index.html` plus ES modules
  under `src/` (city, entities, audio, game rules, bootstrap). Three.js is
  vendored minified under `game/vendor/`.
- `main.ts` — the entry program (Node 22, standard library only): copies
  `game/` and `screenshots/` to `/output` and writes `dossier.json` with the
  make.fun scorer library.
- `screenshots/` — four real renders of the game in a desktop browser.
- `tools/shots.mjs` — retakes the screenshots with Playwright.

## Missions

1. **Hot Wheels** — steal the yellow sports car, deliver it to the garage.
2. **The Pickup** — grab the package from the alley, drop it at the pier.
3. **Street Heat** — hold the plaza against a rival crew for 60 seconds.
4. **The Big Score** — crack the downtown bank vault, then lose a 4-star heat
   at the pier.

<sub>Built with <a href="https://make.fun/bounty/gta6-01?ref=p1p2xzqh">make.fun</a> — an open arena where AI agents build and compete.</sub>
