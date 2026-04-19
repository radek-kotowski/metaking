# MetaKing

![Platform](https://img.shields.io/badge/platform-browser-blue)
![Mode](https://img.shields.io/badge/mode-offline%20browser%20game-2d7ff9)
![Renderer](https://img.shields.io/badge/renderer-Three.js-000000)

Fast-paced browser action game built with Three.js. Fight warlocks on floating islands, raid portals, steal mana from deterministic offline targets, and climb the local leaderboard to become the MetaKing.

---

## Screenshots

![Mushroom island with warlocks and Voronoi terrain](docs/screenshots/Screenshot%202026-04-18%20at%2021.15.04.png)

![Grass island with trees, portals, and leaderboard](docs/screenshots/Screenshot%202026-04-18%20at%2021.12.12.png)

---

## The Game

You're a mage jumping between floating islands in space — stone ruins, crystal formations, mushroom caps, volcanoes. Kill warlocks to gain stamina, use portals to steal mana from offline targets, and push up the deterministic client-side leaderboard.

- **Mana** — your score. Never drops below 100. Enter portals to steal from others.
- **Stamina** — your resource. Kill warlocks (+5 each), spend on portals (-40 per use, need ≥50).
- **Hearts** — your health. 20 max. Warlocks hit for 1. Die and you lose 100 mana.
- **Weapons** — 9 tiers from Sword to The MetaKing Blade, unlocked as your mana grows.
- **Bots** — 10,000 deterministic bot players simulate a live world entirely on the client.

## Controls

| Key | Action |
|-----|--------|
| WASD | Move |
| Space | Jump |
| P | Dodge roll |
| O | Attack |
| E | Enter portal (when nearby) |
| Scroll | Zoom camera |
| Click canvas | Lock mouse for free camera |
| Walk near warlocks | Auto-attack |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Game client | Three.js r165 (browser, ES modules) |
| Local server | Python `http.server` via `serve.py` |
| Data model | Deterministic client-side bots + local save |

---

## Repo Structure

```
metaking/
├── client/                   Browser game (Three.js)
│   ├── index.html
│   ├── src/
│   │   ├── game.js           3D scene, physics, AI, combat
│   │   ├── main.js           Boot, session management
│   │   ├── hud.js            HUD elements
│   │   ├── vitals.js         Mana/stamina/hearts logic
│   │   ├── bots.js           Deterministic leaderboard + bot pool
│   │   ├── islands.js        Procedural island graph generation
│   │   ├── voronoi.js        Voronoi terrain surface builder
│   │   ├── api.js            Legacy stub kept for compatibility
│   │   └── constants.js      Game tuning values
│   ├── assets/               portal.png, sky.hdr, warlock.glb
│   └── audio/                footstep, attack, hurt, heal, mana, dodge
├── docs/                     Specs, design notes, implementation plans
├── serve.py                  No-cache local web server on port 8080
└── RUN_INSTRUCTIONS.md       Broader project notes (partly historical)
```

---

## Quick Start

```bash
cd metaking
python3 serve.py
```

Open [http://localhost:8080](http://localhost:8080).

---


## Architecture

The current project is a fully local browser game. Island generation, bot generation, leaderboard updates, combat, and progression all run client-side. The leaderboard and bot pool are deterministic, so the same seed/window produces the same world state without a backend.

Player progress is stored locally in the browser, and `serve.py` is only there to serve the static client on `localhost:8080` with caching disabled.

Islands are generated procedurally using a Poisson-disk sampled graph with Kruskal MST connectivity. Each island has a biome (grass, volcanic, crystal, desert, mushroom, ruins) and shape (blob, elongated, L-shape, archipelago) with matching Voronoi terrain surface.
