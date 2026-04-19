# MetaKing — Game Design Spec

_2026-04-17_

## Overview

MetaKing is a fast-paced single-player 3D mobile game for iOS with asynchronous multiplayer mechanics. You are a knight living on a closed island. Your goal is to accumulate as much mana as possible and reach the top of the global leaderboard, becoming the MetaKing.

The game is free for 3 days with an annual subscription, then gated behind a paid subscription (annual/monthly/weekly via RevenueCat).

---

## Tech Stack

| Layer               | Technology                                          |
| ------------------- | --------------------------------------------------- |
| Game client         | Unity 6 LTS, iOS-first (Android-ready architecture) |
| Backend             | Node.js + TypeScript, Express                       |
| Database            | PostgreSQL                                          |
| Auth                | Sign in with Apple                                  |
| IAP / Subscriptions | RevenueCat                                          |
| Hosting             | Single VPS (Hetzner or Fly.io)                      |

---

## Architecture

### Client

- All gameplay runs fully local during a session
- Server calls happen only at discrete moments:
  - Session start (auth, entitlement check, load player state, get portal assignments)
  - Portal traversal (mana exchange, message send, new portal assignment)
  - Session end (mark offline, flush state)
  - Leaderboard fetch (cached, every 5 minutes)
- No WebSocket, no real-time connection

### Server

Single Express app with:

- REST API for all player operations
- `node-cron` jobs for bot simulation (every 2–4 hours)
- PostgreSQL for all persistent state

### Auth & Subscriptions

- Sign in with Apple → server stores `apple_user_id` as primary identity
- RevenueCat linked to same Apple ID
- On session start: server validates active RevenueCat entitlement
- No active entitlement → paywall shown, can't play

---

## Database Schema (key tables)

```
players
  id UUID PK
  apple_user_id TEXT UNIQUE
  nickname TEXT UNIQUE
  mana INTEGER DEFAULT 100 CHECK >= 100
  stamina INTEGER DEFAULT 10 CHECK >= 10
  hearts INTEGER DEFAULT 20
  weapon_id INTEGER
  is_online BOOLEAN DEFAULT false
  last_seen_at TIMESTAMP
  created_at TIMESTAMP

portals
  id UUID PK
  owner_id UUID FK players
  is_active BOOLEAN
  assigned_to_player_id UUID FK players (nullable)
  assigned_at TIMESTAMP

messages
  id UUID PK
  from_player_id UUID FK players
  to_player_id UUID FK players
  emoji TEXT
  mana_stolen INTEGER
  seen BOOLEAN DEFAULT false
  created_at TIMESTAMP

leaderboard_cache
  rank INTEGER
  player_id UUID FK players
  nickname TEXT
  mana INTEGER
  weapon_tier INTEGER
  updated_at TIMESTAMP

bots
  id UUID PK
  nickname TEXT UNIQUE
  mana INTEGER
  is_online BOOLEAN
  last_cron_at TIMESTAMP
```

---

## Game World & Map

- **Size:** 500×500 Unity units (~5 minutes to traverse at full sprint)
- **Camera:** Fixed high isometric, ~60° pitch, no rotation

### Terrain composition

- Central open grassland — main combat zone, fast movement
- Dense low-poly forest clusters — slightly slows movement, good for dodging
- 2–3 mountain ridges — impassable, forces routing and tactical navigation
- Small clearings — portal and heart pickup spawn points
- Island edges drop into stylised void/ocean

### Visual style — Stylized Low-Poly / Cel-Shaded

- Bold flat colors, clean geometry, cel-shaded outlines
- Directional lighting: warm golden sun angle, cool shadow fill
- Animated grass shader (subtle sway)
- Particle systems on portals: swirling mana dust, owner-coloured glow (MetaKing portal glows gold)
- Screen-space ambient occlusion for depth
- Subtle vignette + color grading (LUT)
- Consistent golden hour lighting (no day/night cycle)

### Movement

- Virtual joystick (left thumb)
- Always sprinting — no walk mode
- Dodge roll: dedicated button (right side)

---

## Warlocks

- **Active groups:** 12–16 groups of 3–6 warlocks each, always present on map
- **Patrol:** Random waypoints when idle
- **Chase:** Player enters ~8 unit radius → warlocks give chase
- **Top speed:** Slightly slower than player (running is viable but not guaranteed against large groups)
- **Respawn:** When a group is wiped, a new group spawns off-screen (outside camera frustum) to maintain constant density

---

## Vitals System

### Mana

- Primary objective score
- Minimum: 100 (never goes below)
- Increases: portal traversal (+10)
- Decreases: death (−50, floor 100), being raided while offline (−10 per visit, floor 100)

### Stamina

- Resource for portal use
- Minimum: 10 (never goes below)
- First login: starts at 10 — player must kill warlocks before any portal can be used
- Increases: killing a warlock (+5)
- Decreases: portal traversal (−40), warlock hit (−1, floor 10)
- Must have ≥ 50 stamina to enter a portal

### Hearts (Life)

- Maximum: 20
- Increases: collecting heart pickup (+5)
- Decreases: warlock hit (−1)
- Die at 0 hearts

### Death & Respawn

- Respawn at random map location
- Mana = max(100, previous mana − 100)
- Stamina = 10
- Hearts = 20
- Weapon resets to tier matching new mana level (random roll from appropriate tier pool)

### Heart Pickups

- 5–8 active on map at once
- Respawn at random locations 60 seconds after collection

---

## Weapon Progression

Random weapon unlocked at each 100-mana milestone. On death, weapon resets to a random roll from the tier matching current mana.

| Tier | Mana Range    | Weapons                                                                |
| ---- | ------------- | ---------------------------------------------------------------------- |
| 1    | 100–199       | Sword, Staff                                                           |
| 2    | 200–399       | War Axe, Spear                                                         |
| 3    | 400–699       | Flail, Lightning Wand                                                  |
| 4    | 700–999       | Void Blade, Frost Lance                                                |
| 5    | 1,000–4,999   | Soul Reaper, MetaKing's Crown Scepter                                  |
| 6    | 5,000–9,999   | Shadowfang, Arcane Devastator                                          |
| 7    | 10,000–49,999 | Worldbreaker, Eternal Flame Staff                                      |
| 8    | 50,000–99,999 | Oblivion Scythe, Titan's Wrath                                         |
| 9    | 100,000+      | The MetaKing Blade (unique design, massive AOE, unique particle trail) |

Each weapon has distinct attack range and swing speed — not purely cosmetic. Tier 9 AOE hits all warlocks in range.

---

## Portal System

### Portal lifecycle

- 3 portals always active on map simultaneously
- On session start: server assigns 3 portals from offline player/bot pool
- Portal shows floating nameplate: target nickname + current mana
- Player walks into portal → confirmation screen: "Visit [nickname]'s world?" + emoji picker
- On confirm (requires ≥ 50 stamina):
  - Check if player is still offline and do the below in a transaction. If they are online then revert everything and notify the player that the other player went online and can't be raided anymore.
  - Player: +10 mana, −40 stamina
  - Target: −10 mana (floor 100)
  - Message recorded (emoji)
  - Portal closes, new one assigned from pool
- Portal glows red + tooltip if player has < 50 stamina
- MetaKing's portal glows gold instead of purple

### Availability rules

- Player is **online** → no portal to their world exists; they cannot be raided
- Player goes **offline** (app closed/backgrounded) → server marks them offline, portal opens, they enter the pool
- While offline, bots and other players can visit their world

### Messages

- Emoji picker: 👑 ⚔️ 💀 🔥 👻 😈 🙏 ✨ 😂 🤝 💎 🌀 (12 emojis)
- One emoji per portal visit
- No response mechanic — one-way only

### Session open summary

Before gameplay loads, player sees:

- Total mana lost while offline
- List of players/bots who visited (nickname, emoji left)
- These messages are marked seen and cleared

---

## Bot System (10,000 fake players)

### Purpose

Populate the portal pool and leaderboard from day one, make the world feel alive even with zero real players.

### Bot profiles

- 10,000 unique fantasy-generated nicknames
- Mana distributed on a curve: majority 100–2,000; some 2,000–10,000; handful 10,000–50,000; 1–2 near 100,000
- Weapon tier derived from mana at any given time
- names must be unique always

### Cron simulation (every 1 hour)

1. **Availability flip:** Each bot independently flips `is_online` with ~30% probability — BUT after flipping, if fewer than 10% of total bots would be offline, force enough bots back offline to maintain the 10% floor. This guarantees the portal pool is never empty.
2. **Mana drift:** Each bot shifts mana by ±10–15% (respect floor 100).
3. **Bot visits (10% of bots, each visits 2 targets):**
   - Randomly select 10% of bots as "active visitors" this cycle
   - Each active bot picks 2 random targets from the offline pool (real players OR other bots — fully random)
   - For each visit: target loses −10 mana (floor 100), visitor gains +10 mana, random emoji message recorded for real player targets
   - If target is a bot, no message is recorded (bots don't read messages)
4. Bots in offline state remain available in the portal pool for real players to visit

### Leaderboard integration

- Bots appear on global leaderboard alongside real players
- Top 10 at any time may include bots
- Bots look identical to real players from a UX perspective

---

## Leaderboard

- Global top 10 (real players + bots combined)
- Refreshed every 5 minutes (server-side cache)
- Displays: rank, nickname, mana, weapon tier icon
- #1 player / bot is crowned **MetaKing** — crown icon appears everywhere their nickname appears (leaderboard, portal nameplates, messages)

---

## Combat

- **Style:** Auto-attack + dodge roll
- Player moves close to warlock → auto-attack fires
- Dodge roll: dedicated button, brief invincibility frames, short cooldown
- Warlock groups are dangerous: surround = multiple simultaneous hits
- Running viable (player faster than warlocks) but large groups can cut off escape

---

## Onboarding

1. **Sign in with Apple** (single tap, mandatory)
2. **Onboarding screens** (4–5 illustrated): what mana is, portals, warlocks, death/respawn. Beautiful.
3. **Nickname entry**: unique, validated server-side, 3–16 chars, alphanumeric + underscores
4. **Subscription screen**: Annual (3-day free trial) prominently featured. Monthly and weekly shown below as paid. Restore purchases option visible.
5. **Drop into world**: brief tutorial — arrow pointing at warlock group, then arrow pointing at portal

---

## Subscription Plans (RevenueCat)

| Plan    | Price | Trial            |
| ------- | ----- | ---------------- |
| Annual  | Paid  | 3-day free trial |
| Monthly | Paid  | None             |
| Weekly  | Paid  | None             |

- Entitlement checked on every session start
- Lapsed entitlement → paywall shown, cannot play
- Restore purchases restores account (same Apple ID = same player record)
- For revenue cat implementation you can checkout repos/habitlock which implements something a bit different but similar enough.

---

## HUD

- **Mana** — top center, prominent
- **Stamina** — below mana or top left
- **Hearts** — top right (heart icons, 20 max, grouped in sets of 5)
- **Weapon icon** — bottom left
- **Minimap** — bottom right (shows island, player position, portal locations, warlock group blips)
- **Leaderboard button** — top right corner
- **Dodge roll button** — right side

---

## API Endpoints

```
POST /auth/signin          — Sign in with Apple, upsert player, return JWT (30-day expiry, refreshed each session start)
GET  /player/me            — Load player state + unseen messages
POST /session/start        — Mark online, return 3 portal assignments
POST /session/end          — Mark offline
POST /portal/enter         — Execute portal traversal (mana exchange, message, new portal)
GET  /leaderboard          — Top 10 (5-min cache)
POST /player/nickname      — Set nickname (onboarding)
GET  /entitlement          — Check RevenueCat entitlement status
```

---

## Game Constants (`config/constants.ts`)

All tunable values live in a single file on the server, imported everywhere. Unity client receives relevant values on session start so gameplay matches server rules without redeployment.

```typescript
export const CONSTANTS = {
  // Player vitals
  MANA_MIN: 100,
  STAMINA_MIN: 10,
  STAMINA_START: 10,
  HEARTS_MAX: 20,
  HEARTS_START: 20,
  HEART_PICKUP_RESTORE: 5,
  HEART_PICKUP_RESPAWN_SECONDS: 60,
  HEART_PICKUPS_ON_MAP: 8,

  // Portal mechanics
  PORTAL_COUNT: 3,
  PORTAL_MANA_GAIN: 10,
  PORTAL_STAMINA_COST: 40,
  PORTAL_STAMINA_REQUIRED: 50,
  PORTAL_MANA_STEAL: 10,

  // Combat
  WARLOCK_HIT_HEARTS: 1,
  WARLOCK_HIT_STAMINA: 1,
  WARLOCK_KILL_STAMINA: 5,
  WARLOCK_GROUPS_MIN: 12,
  WARLOCK_GROUPS_MAX: 16,
  WARLOCK_GROUP_SIZE_MIN: 3,
  WARLOCK_GROUP_SIZE_MAX: 6,
  WARLOCK_CHASE_RADIUS: 8,

  // Death
  DEATH_MANA_PENALTY: 100,
  DEATH_STAMINA_RESET: 10,
  DEATH_HEARTS_RESET: 20,

  // Map
  MAP_SIZE: 500,

  // Bots
  BOT_POOL_SIZE: 10000,
  BOT_OFFLINE_FLOOR_PERCENT: 0.1, // at least 10% always offline
  BOT_ONLINE_FLIP_PROBABILITY: 0.3,
  BOT_MANA_DRIFT_PERCENT: 0.125, // ±12.5%
  BOT_VISITOR_PERCENT: 0.1, // 10% of bots visit each cycle
  BOT_VISITS_PER_ACTIVE_BOT: 2,
  BOT_CRON_INTERVAL_HOURS: 1,

  // Leaderboard
  LEADERBOARD_TOP_N: 10,
  LEADERBOARD_CACHE_SECONDS: 300, // 5 minutes

  // Auth
  JWT_EXPIRY_DAYS: 30,

  // Nickname
  NICKNAME_MIN_LENGTH: 3,
  NICKNAME_MAX_LENGTH: 16,
} as const;
```

## Db ORM:

For the node server, use typescript + either direct SQL queries or an ORM like MikroORM (https://mikro-orm.io/) whichever you prefer.

---

## Out of Scope (v1)

- Android (architecture ready, not built)
- Real-time multiplayer / seeing other players
- Chat beyond emoji
- Clans / guilds
- Push notifications
- In-app purchases beyond subscription
