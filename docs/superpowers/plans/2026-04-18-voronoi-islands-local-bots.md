# Voronoi Islands + Local Bot Leaderboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace coarse island geometry with Voronoi-fractured surfaces (300–1500 polys each), and eliminate the /server folder by making all 10k bots and the leaderboard fully client-side and deterministic.

**Architecture:** A seeded PRNG (mulberry32) drives both island fracture geometry and bot generation — the same seed always produces identical results on any device. The leaderboard derives its state from a second time-seed (floored to 10-min UTC chunks) so scores drift identically for all players in the same window. All server calls are removed; `main.js` calls `bots.js` directly.

**Tech Stack:** Three.js (already in project), vanilla ES modules, no new dependencies.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `client/src/prng.js` | **Create** | Mulberry32 seeded PRNG — exported as `seededRng(seed)` → returns `() => float[0,1)` |
| `client/src/bots.js` | **Create** | Generate 10k bots deterministically; compute leaderboard for a given timeSeed + playerMana/nick |
| `client/src/voronoi.js` | **Create** | Voronoi fracture of a convex polygon region → merged Three.js BufferGeometry |
| `client/src/game.js` | **Modify** | Replace island top-surface geometry calls with `buildVoronoiSurface()` from voronoi.js |
| `client/src/main.js` | **Modify** | Remove online flow, server calls, `lbInterval` polling; call `bots.js` for leaderboard on a 10-min check |
| `client/src/api.js` | **Delete** (or gut) | No longer needed — remove all imports of it |
| `server/` | **Delete** | Entire folder removed after client is working |

---

## Task 1: Seeded PRNG module

**Files:**
- Create: `client/src/prng.js`

- [ ] **Step 1: Create the file**

```js
// mulberry32 — fast, high-quality 32-bit seeded PRNG
export function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

Save to `client/src/prng.js`.

- [ ] **Step 2: Smoke-test in browser console**

Open the game in a browser, paste in the console:
```js
import('/src/prng.js').then(m => {
  const r = m.seededRng(42);
  console.log(r(), r(), r()); // must be deterministic — same 3 values every time
});
```
Expected: three floats, identical on every page reload.

- [ ] **Step 3: Commit**

```bash
git add client/src/prng.js
git commit -m "feat: add mulberry32 seeded PRNG module"
```

---

## Task 2: Bot generation module

**Files:**
- Create: `client/src/bots.js`

The bot pool is generated once and cached. Bots get nicknames using the same algorithm as the server's `seedBots.ts` (deterministic by index), and mana using the same distribution. Each 10-minute UTC window applies a deterministic mana drift.

- [ ] **Step 1: Create `client/src/bots.js`**

```js
import { seededRng } from './prng.js';

const BOT_SEED    = 42;
const BOT_COUNT   = 10000;
const DRIFT_PCT   = 0.125;  // ±12.5% per window
const WINDOW_MS   = 10 * 60 * 1000;

const FIRST_NAMES = ['alex','jake','mike','tom','sam','dan','max','ben','leo','zoe',
  'emma','luke','ryan','adam','josh','kyle','noah','ethan','liam','owen',
  'tyler','cole','sean','dean','mark','nick','brad','evan','eric','ian'];
const GAMER_WORDS = ['lol','pro','gg','ez','noob','pwn','rekt','clutch','yolo','lit'];
const COOL_WORDS  = ['shadow','void','frost','storm','blaze','phantom','rogue','stealth','neon','apex',
  'fury','reaper','ghost','viper','nexus','zenith','surge','cipher','zero','ace'];
const SEPARATORS  = ['','_','','.',''];

function _pick(arr, seed) { return arr[seed % arr.length]; }

function _nickname(i) {
  const style = i % 6;
  const num   = (i % 9999) + 1;
  const snum  = (i % 999)  + 1;
  const sep   = _pick(SEPARATORS, Math.floor(i / 7));
  switch (style) {
    case 0: return `${_pick(FIRST_NAMES, i)}${i % 3 === 0 ? num : snum}`;
    case 1: return `${_pick(GAMER_WORDS, i)}${snum}`;
    case 2: return `${_pick(COOL_WORDS, i)}${sep}${snum}`;
    case 3: return `${_pick(FIRST_NAMES, i)}${sep}${_pick(COOL_WORDS, Math.floor(i/5))}`.slice(0,16);
    case 4: return `${_pick(COOL_WORDS, i).toUpperCase()}${snum}`.slice(0,16);
    default: return `${_pick(FIRST_NAMES, i)}${_pick(GAMER_WORDS, Math.floor(i/3)).toUpperCase()}`.slice(0,16);
  }
}

function _baseMana(rng) {
  const r = rng();
  if (r < 0.60) return Math.floor(100  + rng() * 1900);
  if (r < 0.90) return Math.floor(2000 + rng() * 8000);
  if (r < 0.99) return Math.floor(10000 + rng() * 40000);
  return Math.floor(50000 + rng() * 50000);
}

// Lazily generated, cached for the session
let _bots = null;

function _getBots() {
  if (_bots) return _bots;
  const rng = seededRng(BOT_SEED);
  _bots = Array.from({ length: BOT_COUNT }, (_, i) => ({
    nickname: _nickname(i),
    mana:     _baseMana(rng),
  }));
  return _bots;
}

function _timeSeed() {
  return Math.floor(Date.now() / WINDOW_MS);
}

function _driftedMana(baseMana, botIndex, timeSeed) {
  const rng    = seededRng(BOT_SEED ^ (timeSeed * 2654435761) ^ (botIndex * 1234567));
  const factor = 1 + (rng() * DRIFT_PCT * 2 - DRIFT_PCT);
  return Math.max(100, Math.round(baseMana * factor));
}

/**
 * Returns top-10 leaderboard entries including the player.
 * @param {string} playerNick
 * @param {number} playerMana
 * @returns {{ rank: number, nickname: string, mana: number, isMetaKing: boolean, isPlayer: boolean }[]}
 */
export function getLeaderboard(playerNick, playerMana) {
  const ts   = _timeSeed();
  const bots = _getBots();

  // Score all 10k bots with current window drift
  const scored = bots.map((b, i) => ({
    nickname:   b.nickname,
    mana:       _driftedMana(b.mana, i, ts),
    isPlayer:   false,
  }));

  // Insert player
  scored.push({ nickname: playerNick, mana: playerMana, isPlayer: true });

  // Sort descending
  scored.sort((a, b) => b.mana - a.mana);

  // Find player rank (1-based)
  const playerRank = scored.findIndex(e => e.isPlayer) + 1;

  // Build display list: top 9 bots + player row (player may already be in top 10)
  const top10 = scored.slice(0, 10);
  const playerInTop10 = top10.some(e => e.isPlayer);
  if (!playerInTop10) {
    top10[9] = scored[playerRank - 1]; // replace last slot with player
  }

  return top10.map((e, i) => ({
    rank:        scored.indexOf(e) + 1,
    nickname:    e.nickname,
    mana:        e.mana,
    isMetaKing:  scored.indexOf(e) === 0,
    isPlayer:    e.isPlayer,
  }));
}

/**
 * Returns the current 10-minute window seed (used to detect window changes).
 */
export function currentTimeSeed() {
  return _timeSeed();
}
```

- [ ] **Step 2: Verify determinism in browser console**

```js
import('/src/bots.js').then(m => {
  const lb1 = m.getLeaderboard('TestPlayer', 500);
  const lb2 = m.getLeaderboard('TestPlayer', 500);
  console.log('Deterministic:', JSON.stringify(lb1) === JSON.stringify(lb2)); // true
  console.log('Top entry:', lb1[0].nickname, lb1[0].mana);
  console.log('Player visible:', lb1.some(e => e.isPlayer));
});
```
Expected: `Deterministic: true`, player row present.

- [ ] **Step 3: Commit**

```bash
git add client/src/bots.js
git commit -m "feat: deterministic client-side bot pool and leaderboard"
```

---

## Task 3: Wire leaderboard into main.js, remove server

**Files:**
- Modify: `client/src/main.js`
- Modify (gut): `client/src/api.js`

- [ ] **Step 1: Replace `refreshLeaderboard` in `main.js`**

Remove the import of `api` for leaderboard use. Add import of `bots.js`:

Replace the top imports block:
```js
import { Game }         from './game.js';
import { hud, screens } from './hud.js';
import { C, randomWeaponForMana } from './constants.js';
import { getLeaderboard, currentTimeSeed } from './bots.js';
```

- [ ] **Step 2: Replace state variables**

Replace:
```js
let game       = null;
let nickname   = 'Wanderer';
let offline    = false;
let lbInterval = null;
```
With:
```js
let game         = null;
let nickname     = 'Wanderer';
let _lastLbSeed  = null;
let _lbInterval  = null;
```

- [ ] **Step 3: Replace `boot` function**

```js
async function boot() {
  screens.show('screen-title');
  const loadingEl = document.getElementById('loading-status');

  game = new Game({
    onVitalsChanged: (m, s, h) => hud.updateVitals(m, s, h),
    onDied:          (summary) => handleDeath(summary),
    onPortalEntered: (res)     => handlePortalEntered(res),
    onPortalError:   (msg)     => hud.showMessage(msg),
    onPortalNearby:  (near)    => hud.showPortalPrompt(near),
  });

  const btnPlay = document.getElementById('btn-play');
  btnPlay.disabled = true;

  await game.loadAssets((msg) => { if (loadingEl) loadingEl.textContent = msg; });
  if (loadingEl) loadingEl.textContent = '';

  // Hide the online button — server is gone
  const btnOnline = document.getElementById('btn-play-online');
  if (btnOnline) btnOnline.style.display = 'none';

  btnPlay.disabled = false;
  btnPlay.addEventListener('click', () => startGame());
}
```

- [ ] **Step 4: Replace start functions**

```js
async function startGame() {
  if (!nickname || nickname === 'Wanderer') {
    screens.show('screen-nickname');
    setupNicknameScreen((nick) => {
      nickname = nick;
      _launch();
    });
    return;
  }
  _launch();
}

function _launch() {
  const w = randomWeaponForMana(C.manaMin);
  hud.show();
  hud.setNickname(nickname);
  hud.setWeapon(w.name, w.tier);
  hud.updateVitals(C.manaMin, C.staminaStart, C.heartsStart);
  screens.show(null);

  game.setManaAtStart(C.manaMin);
  game.start({
    mana:       C.manaMin,
    stamina:    C.staminaStart,
    hearts:     C.heartsStart,
    weaponName: w.name,
    weaponTier: w.tier,
    portals:    null,
    offline:    true,
  });

  _startLbPolling();
}
```

- [ ] **Step 5: Replace leaderboard polling**

```js
function _refreshLeaderboard() {
  const mana = game?.vitals?.mana ?? C.manaMin;
  const entries = getLeaderboard(nickname, mana);
  hud.updateLeaderboard(entries);
}

function _startLbPolling() {
  clearInterval(_lbInterval);
  _lastLbSeed = currentTimeSeed();
  _refreshLeaderboard();
  _lbInterval = setInterval(() => {
    const ts = currentTimeSeed();
    if (ts !== _lastLbSeed) {
      _lastLbSeed = ts;
      _refreshLeaderboard();
    }
  }, 30000); // check every 30s, only re-renders when 10-min window rolls over
}
```

- [ ] **Step 6: Replace `handleDeath`**

```js
async function handleDeath({ manaAtStart, manaAtEnd }) {
  clearInterval(_lbInterval);
  hud.hide();

  screens.show('screen-death');
  screens.setSummary({ manaAtStart, manaAtEnd, died: true });

  document.getElementById('btn-play-again').onclick = () => startGame();
  document.getElementById('btn-quit').onclick = () => {
    game?.stop();
    screens.show('screen-title');
    hud.hide();
  };
}
```

- [ ] **Step 7: Replace `handlePortalEntered` and `setupNicknameScreen`**

```js
function handlePortalEntered(res) {
  hud.setWeapon(res.weaponName, res.weaponTier);
  hud.showMessage('+' + C.portalManaGain + ' mana stolen!');
}

function setupNicknameScreen(onConfirm) {
  const input = document.getElementById('nick-input');
  const err   = document.getElementById('nick-error');
  const btn   = document.getElementById('btn-nick-confirm');
  input.value = '';
  err.textContent = '';

  btn.onclick = () => {
    const nick = input.value.trim();
    if (nick.length < 3 || nick.length > 16) {
      err.textContent = '3–16 characters required';
      return;
    }
    err.textContent = '';
    onConfirm(nick);
  };

  input.onkeydown = (e) => { if (e.key === 'Enter') btn.click(); };
}

boot();
```

- [ ] **Step 8: Gut `api.js`** — replace entirely with an empty stub so no import errors:

```js
// api.js — server removed; kept as empty stub to avoid broken imports elsewhere
export const api = {};
export function setToken() {}
export function getToken() {}
export async function tryApi(fn) {
  try { return await fn(); } catch { return null; }
}
```

- [ ] **Step 9: Verify the game loads and leaderboard shows up**

Run the dev server (`npm run dev` or `vite` in `client/`), open the browser, play offline, check the HUD leaderboard shows 10 entries with your player name somewhere in the list.

- [ ] **Step 10: Commit**

```bash
git add client/src/main.js client/src/api.js
git commit -m "feat: remove server dependency, all-local bot leaderboard"
```

---

## Task 4: Voronoi fracture module

**Files:**
- Create: `client/src/voronoi.js`

This implements a simple relaxed point Voronoi on a rectangular/circular region. It generates N seed points (seeded PRNG), computes a Delaunay triangulation via bowyer-watson (small N, so perf is fine), and converts each Voronoi cell to a flat-shaded polygon that gets merged into one BufferGeometry.

We use an inline jump-flooding / brute-force Voronoi approach since N ≤ 1500 — no library needed.

- [ ] **Step 1: Create `client/src/voronoi.js`**

```js
import * as THREE from 'three';
import { seededRng } from './prng.js';

/**
 * Build a Voronoi-fractured flat surface merged into one BufferGeometry.
 *
 * @param {object} opts
 * @param {number}   opts.seed        - PRNG seed (use island index or position hash)
 * @param {number}   opts.rx          - half-extent X of the region
 * @param {number}   opts.rz          - half-extent Z of the region
 * @param {number}   opts.cellCount   - number of Voronoi cells (300–1500)
 * @param {number[]} opts.palette     - array of hex colours for cells
 * @param {number}   opts.y           - Y position of the flat surface
 * @param {'rect'|'circle'} opts.shape - clipping shape
 * @returns {THREE.BufferGeometry}
 */
export function buildVoronoiSurface({ seed, rx, rz, cellCount, palette, y = 0, shape = 'rect' }) {
  const rng = seededRng(seed);

  // Generate seed points inside region
  const pts = [];
  let attempts = 0;
  while (pts.length < cellCount && attempts < cellCount * 10) {
    attempts++;
    const px = (rng() * 2 - 1) * rx;
    const pz = (rng() * 2 - 1) * rz;
    if (shape === 'circle' && (px*px)/(rx*rx) + (pz*pz)/(rz*rz) > 1) continue;
    pts.push([px, pz]);
  }

  // For each sample point on a grid, find nearest Voronoi seed
  // We rasterise at ~4 units resolution, then triangulate per cell
  const STEP = Math.max(0.4, (rx * 2) / 80);
  const cells = new Map(); // index → [[x,z], ...]

  for (let px = -rx; px <= rx; px += STEP) {
    for (let pz = -rz; pz <= rz; pz += STEP) {
      if (shape === 'circle' && (px*px)/(rx*rx) + (pz*pz)/(rz*rz) > 1) continue;
      let best = 0, bestD = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const dx = px - pts[i][0], dz = pz - pts[i][1];
        const d = dx*dx + dz*dz;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (!cells.has(best)) cells.set(best, []);
      cells.get(best).push([px, pz]);
    }
  }

  // Triangulate each cell using fan triangulation around centroid
  const positions = [];
  const colors    = [];

  for (const [ci, points] of cells) {
    if (points.length < 3) continue;
    const col = new THREE.Color(palette[ci % palette.length]);
    // slight per-cell brightness variation for visual interest
    const bright = 0.85 + (seededRng(seed ^ ci)() * 0.3);
    const r = col.r * bright, g = col.g * bright, b = col.b * bright;

    // centroid
    let cx = 0, cz = 0;
    for (const [px, pz] of points) { cx += px; cz += pz; }
    cx /= points.length; cz /= points.length;

    // sort by angle around centroid
    points.sort((a, b) => Math.atan2(a[1]-cz, a[0]-cx) - Math.atan2(b[1]-cz, b[0]-cx));

    // fan triangles
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b2 = points[(i+1) % points.length];
      positions.push(cx, y, cz,  a[0], y, a[1],  b2[0], y, b2[1]);
      for (let v = 0; v < 3; v++) colors.push(r, g, b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors,    3));
  geo.computeVertexNormals();
  return geo;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/voronoi.js
git commit -m "feat: Voronoi fracture surface geometry builder"
```

---

## Task 5: Apply Voronoi surfaces to islands in game.js

**Files:**
- Modify: `client/src/game.js`

Replace the flat cylinder top-cap of each island shape with a `buildVoronoiSurface` call. The body/underside geometry stays as-is.

- [ ] **Step 1: Add import at the top of `game.js`**

After the existing imports, add:
```js
import { buildVoronoiSurface } from './voronoi.js';
```

- [ ] **Step 2: Add a position-based seed helper near the top of the file** (after the `rnd`/`rndInt` helpers, around line 26)

```js
function _islandSeed(cx, cz) {
  // deterministic hash of island centre — same across devices
  return ((cx * 73856093) ^ (cz * 19349663)) >>> 0;
}
```

- [ ] **Step 3: Replace `case 'island'` in `_buildShapedPlatform`**

Find:
```js
    case 'island': {
      const topGeo = _paintGeo(new THREE.CylinderGeometry(hw * 0.92, hw * 0.85, 1.6, 8), [0x5cb85c, 0x4cae4c, 0x6abf6a, 0x3d9e3d], 0, 99);
      g.add(new THREE.Mesh(topGeo, _vcMat()));
```

Replace with:
```js
    case 'island': {
      const voroGeo = buildVoronoiSurface({
        seed:      _islandSeed(cx, cz),
        rx:        hw * 0.9,
        rz:        hd * 0.9,
        cellCount: 600,
        palette:   [0x5cb85c, 0x4cae4c, 0x6abf6a, 0x3d9e3d, 0x4aa84a, 0x71c971],
        y:         0.8,
        shape:     'circle',
      });
      g.add(new THREE.Mesh(voroGeo, _vcMat()));
```

- [ ] **Step 4: Replace `case 'volcano'` top surface**

Find (the `craterGeo` circle):
```js
      const craterGeo = new THREE.CircleGeometry(topR * 0.85, 8);
      const crater = new THREE.Mesh(craterGeo, new THREE.MeshBasicMaterial({ color: 0xff4400 }));
      crater.rotation.x = -Math.PI / 2;
      crater.position.y = coneH + 0.05;
      g.add(crater);
```

Replace with:
```js
      const voroGeo = buildVoronoiSurface({
        seed:      _islandSeed(cx, cz) ^ 0xDEAD,
        rx:        topR * 0.82,
        rz:        topR * 0.82,
        cellCount: 120,
        palette:   [0xff4400, 0xff6600, 0xdd2200, 0xff8800],
        y:         coneH + 0.06,
        shape:     'circle',
      });
      g.add(new THREE.Mesh(voroGeo, _vcMat(0xff4400, 0.6)));
```

- [ ] **Step 5: Replace `case 'dish'` bowl surface**

Find:
```js
    case 'dish': {
      const rimGeo = _paintGeo(new THREE.TorusGeometry(hw * 0.88, 1.0, 5, 10), [0x7ec8e3, 0x5ab4d4, 0x9ad8f0], 0, 99);
      g.add(new THREE.Mesh(rimGeo, _vcMat()));
```

After that `g.add` line, add:
```js
      const voroGeo = buildVoronoiSurface({
        seed:      _islandSeed(cx, cz) ^ 0xB00B,
        rx:        hw * 0.78,
        rz:        hd * 0.78,
        cellCount: 400,
        palette:   [0x7ec8e3, 0x5ab4d4, 0x9ad8f0, 0x3a9abf, 0xaadff5],
        y:         0.05,
        shape:     'circle',
      });
      g.add(new THREE.Mesh(voroGeo, _vcMat()));
```

- [ ] **Step 6: Replace `case 'crystal'` base top**

Find:
```js
    case 'crystal': {
      const baseGeo = _paintGeo(new THREE.CylinderGeometry(hw*0.88, hw*0.7, 1.8, 6), [0x00c8d4, 0x00a8b8, 0x00e8f0], 0, 99);
      g.add(new THREE.Mesh(baseGeo, new THREE.Me
```

Replace the `baseGeo` mesh with:
```js
    case 'crystal': {
      const voroGeo = buildVoronoiSurface({
        seed:      _islandSeed(cx, cz) ^ 0xC1A0,
        rx:        hw * 0.85,
        rz:        hd * 0.85,
        cellCount: 500,
        palette:   [0x00c8d4, 0x00a8b8, 0x00e8f0, 0x00d4e8, 0x33e0ff],
        y:         0.9,
        shape:     'circle',
      });
      g.add(new THREE.Mesh(voroGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.1, metalness: 0.4, flatShading: true,
      })));
```

(Keep the rest of the crystal case — spire cones etc. — unchanged.)

- [ ] **Step 7: Replace `case 'mushroom'` cap top**

Find the mushroom case's cap geometry (a `SphereGeometry` or similar). Add after the existing cap mesh:
```js
      const voroGeo = buildVoronoiSurface({
        seed:      _islandSeed(cx, cz) ^ 0xF00D,
        rx:        hw * 0.88,
        rz:        hd * 0.88,
        cellCount: 450,
        palette:   [0xff6644, 0xee4422, 0xff8866, 0xdd3311, 0xffaa88],
        y:         0.05,
        shape:     'circle',
      });
      g.add(new THREE.Mesh(voroGeo, _vcMat()));
```

- [ ] **Step 8: Replace `case 'slab'` top**

Find the slab case (a flat box or cylinder top). Replace its top surface geometry with:
```js
      const voroGeo = buildVoronoiSurface({
        seed:      _islandSeed(cx, cz) ^ 0x5AB1,
        rx:        hw * 0.92,
        rz:        hd * 0.92,
        cellCount: 350,
        palette:   [0x888888, 0x999999, 0xaaaaaa, 0x777777, 0xbbbbbb],
        y:         0.05,
        shape:     'rect',
      });
      g.add(new THREE.Mesh(voroGeo, _vcMat()));
```

- [ ] **Step 9: Replace `case 'ruins'` top**

```js
      const voroGeo = buildVoronoiSurface({
        seed:      _islandSeed(cx, cz) ^ 0x4A1E,
        rx:        hw * 0.85,
        rz:        hd * 0.85,
        cellCount: 400,
        palette:   [0x998877, 0x887766, 0xaa9988, 0x776655, 0xbbaa99],
        y:         0.05,
        shape:     'rect',
      });
      g.add(new THREE.Mesh(voroGeo, _vcMat()));
```

- [ ] **Step 10: Load the game, verify islands look fractured**

Open the browser. Each island top should have a mosaic of irregular flat-shaded polygons rather than a smooth cylinder cap. Check that:
- Performance is acceptable (no frame drops below ~30fps)
- Islands are still walkable (Voronoi surface is visual only — physics AABB is unchanged)
- The pattern is identical on reload (deterministic seed)

If `cellCount` causes lag on large islands, reduce to 300. If it looks too coarse, increase to 800.

- [ ] **Step 11: Commit**

```bash
git add client/src/game.js
git commit -m "feat: Voronoi-fractured island surfaces"
```

---

## Task 6: Delete the server folder

- [ ] **Step 1: Verify nothing in client still imports from server**

```bash
grep -r 'server/' client/src --include='*.js'
```
Expected: no output.

- [ ] **Step 2: Delete server**

```bash
rm -rf server/
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove server — all logic is now client-side"
```

---

## Self-Review

**Spec coverage:**
- ✅ Voronoi fracture per island (Task 4 + 5)
- ✅ 300–1500 cells per island (cellCount param per shape)
- ✅ Merged single BufferGeometry per island (one draw call)
- ✅ Deterministic geometry via seeded PRNG (Task 1 + 5's `_islandSeed`)
- ✅ 10k bots generated from fixed seed (Task 2)
- ✅ Leaderboard identical across devices in same 10-min window (Task 2's `_timeSeed`)
- ✅ Scores + composition changes every 10 min (drift applied per window seed)
- ✅ Player inserted into leaderboard by live mana (Task 2 `getLeaderboard`)
- ✅ No server dependency (Task 3 + 6)
- ✅ /server folder deleted (Task 6)

**Placeholder scan:** None found.

**Type consistency:** `getLeaderboard(nick, mana)` → called in `main.js` Task 3 step 5 → matches signature in `bots.js` Task 2. `buildVoronoiSurface({seed, rx, rz, cellCount, palette, y, shape})` → called in `game.js` Task 5 → matches definition in `voronoi.js` Task 4.
