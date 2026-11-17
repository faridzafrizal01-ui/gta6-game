# gta6-game

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/faridzafrizal01-ui/gta6-game/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/faridzafrizal01-ui/gta6-game/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Vice Shores** — an open-world crime game that plays fully offline in a desktop
browser. You are Jax Moreno, fresh out of lockup and broke in a sun-baked coastal
city run by crews, cops and bad decisions. Steal cars, outrun the law, take jobs
from the fixer Delia Voss and pull the score that buys you a way out.

- 🏙️ A seeded 3D city to explore **on foot and by car** — downtown towers, a
  beach and pier, traffic and pedestrians with their own routines
- 🚗 Drivable cars with arcade physics: steal any parked car, ram traffic,
  handbrake turns — and watch the **5-star wanted system** answer
- 👮 Police cars that chase and ram, officers who get out and arrest you
  (**BUSTED**) — or take you down (**WASTED**)
- 🎯 **Four story missions**: Hot Wheels, The Pickup, Street Heat and The Big
  Score — with markers, objectives, a vault-cracking holdout and a getaway
- 🔫 Combat: shoot on foot, reload, health/armor/cash pickups
- 🗺️ HUD with cash, health, wanted stars, clock and a live **minimap**
- 🌆 Day/night cycle with dusk streets and lit windows, procedural WebAudio
  sound (engine, sirens, gunshots, a bass groove) and a save that keeps your
  cash and mission progress in `localStorage`

An original game built for make.fun's "Make GTA 6" bounty — every character,
vehicle, name, street and sound is original work. No Rockstar assets, names or
branding are used anywhere in the game.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 — no build step, no network requests, the game
is plain static files under `game/`.

Controls: **WASD** move / drive · **mouse drag** look · **E** enter / exit car,
pick up · **Click / F** shoot · **R** reload · **Space** handbrake / jump ·
**Shift** sprint · **P / Esc** pause · **M** mute · **C** camera.

## Build the entry dossier

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

This copies `game/` and `screenshots/` into the output directory and writes
`dossier.json` (Node 22, standard library only).

---

<sub>Entered on [make.fun](https://make.fun/?ref=p1p2xzqh&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
