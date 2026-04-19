# Combat + Island Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix combat (auto-attack range, death animation, keybindings), fix Voronoi rendering, and replace hardcoded platform list with a procedural graph-based island generator with diverse shapes and biomes.

**Architecture:** Combat fixes are isolated changes to `game.js` and `constants.js`. Island generation moves to a new `islands.js` module that exports `buildIslandGraph()` returning platform descriptors consumed by `game.js`. Voronoi fix is in `voronoi.js` — remove fillGeo, handle degenerate cells inline.

**Tech Stack:** Three.js, vanilla JS ES modules

---

### Task 1: Fix Voronoi gaps — handle degenerate cells instead of skipping them

**Files:**
- Modify: `client/src/voronoi.js`

- [ ] Remove the `fillGeo` return — revert to returning just a `BufferGeometry`. Remove the base disc entirely (the island body cylinder covers edge gaps from outside). Instead fix the root cause: cells with 1 or 2 points get skipped, leaving holes. Handle them:
  - 1-point cell: skip (single point can't form a triangle — these are vanishingly rare with finer STEP)
  - 2-point cell: emit two triangles as a thin quad (centroid + 2 points + midpoint)
  - Remove the `if (points.length < 3) continue` guard and replace with the logic below

Replace in `voronoi.js`:

```js
  for (const [ci, points] of cells) {
    if (points.length < 2) continue;   // 1-point: truly degenerate, skip

    const cellRng = seededRng((seed ^ (ci * 2654435761)) >>> 0);
    const baseCol = new THREE.Color(palette[ci % palette.length]);
    const bright  = 0.80 + cellRng() * 0.35;
    const tr = Math.min(1, baseCol.r * bright);
    const tg = Math.min(1, baseCol.g * bright);
    const tb = Math.min(1, baseCol.b * bright);
    const sr = tr * 0.55, sg2 = tg * 0.55, sb = tb * 0.55;
    const cellY = cellHeights[ci];

    let cx = 0, cz2 = 0;
    for (const [px, pz] of points) { cx += px; cz2 += pz; }
    cx /= points.length; cz2 /= points.length;

    if (points.length === 2) {
      // Emit a thin quad: centroid + 2 pts + midpoint offset
      const [ax, az] = points[0];
      const [bx, bz] = points[1];
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const px2 = -(bz - az) * 0.05, pz2 = (bx - ax) * 0.05;
      pushTri(cx, cellY, cz2, ax, cellY, az, bx, cellY, bz, tr, tg, tb);
      pushTri(mx + px2, cellY, mz + pz2, ax, cellY, az, bx, cellY, bz, tr, tg, tb);
      continue;
    }

    points.sort((a, b2) => Math.atan2(a[1] - cz2, a[0] - cx) - Math.atan2(b2[1] - cz2, b2[0] - cx));

    for (let i = 0; i < points.length; i++) {
      const a  = points[i];
      const b2 = points[(i + 1) % points.length];
      pushTri(cx, cellY, cz2, a[0], cellY, a[1], b2[0], cellY, b2[1], tr, tg, tb);
    }

    for (let i = 0; i < points.length; i++) {
      const a  = points[i];
      const b2 = points[(i + 1) % points.length];
      pushTri(a[0], cellY, a[1],   b2[0], cellY, b2[1],   b2[0], y, b2[1],  sr, sg2, sb);
      pushTri(a[0], cellY, a[1],   b2[0], y,     b2[1],   a[0],  y, a[1],   sr, sg2, sb);
    }
  }
```

Also revert the return to just `BufferGeometry`:
```js
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors,    3));
  geo.computeVertexNormals();
  return geo;
```

- [ ] Update `_addVoronoi` in `game.js` to accept plain geo again:
```js
function _addVoronoi(parent, opts, mat) {
  const geo = buildVoronoiSurface(opts);
  parent.add(new THREE.Mesh(geo, mat));
}
```

- [ ] Commit: `fix: voronoi degenerate cells filled, no z-fighting fill disc`

---

### Task 2: Fix keybindings — F→P (dodge), O (manual attack)

**Files:**
- Modify: `client/src/game.js` — `_setupInput`, `_update`

- [ ] In `_setupInput`, change `KeyF` to `KeyP` for dodge:
```js
if (e.code === 'KeyP' && this.running && this._grounded) this._tryDodge();
```

- [ ] Add `KeyO` for manual attack trigger:
```js
if (e.code === 'KeyO' && this.running) this._manualAttack();
```

- [ ] Add `_manualAttack()` method (forces attack timer to 0 so next `_updateCombat` fires immediately):
```js
_manualAttack() {
  this._attackTimer = 0;
}
```

- [ ] Commit: `feat: remap dodge to P, add O manual attack key`

---

### Task 3: Fix auto-attack range

**Files:**
- Modify: `client/src/constants.js`

- [ ] Change `weaponAttackRange`:
```js
export function weaponAttackRange(tier) { return 2.5 + tier * 0.4; }
```
Tier 1 = 2.9u, tier 9 = 6.1u. Warlocks need to be within ~1.2u to hit player, so 2.9u attack range means player can attack first.

- [ ] Commit: `fix: increase weapon attack range floor to 2.5`

---

### Task 4: Warlock death animation

**Files:**
- Modify: `client/src/game.js` — `_killWarlock`, `_buildWarlockFromGltf`

- [ ] In `_buildWarlockFromGltf`, store the death clip action:
```js
clone.userData.actDeath = mixer.clipAction(find('Death'));
clone.userData.actDeath.setLoop(THREE.LoopOnce, 1);
clone.userData.actDeath.clampWhenFinished = true;
```

- [ ] Rewrite `_killWarlock` to play death animation then remove:
```js
_killWarlock(w) {
  w.alive = false;
  this.vitals.killWarlock();
  this._audio.play('warlock_die', 0.7);
  this._spawnDeathParticles(w.pos.clone());

  const ud = w.mesh.userData;
  if (ud.mixer && ud.actDeath) {
    // Stop locomotion, play death once
    if (ud.actIdle) ud.actIdle.fadeOut(0.1);
    if (ud.actWalk) ud.actWalk.fadeOut(0.1);
    if (ud.actRun)  ud.actRun.fadeOut(0.1);
    ud.actDeath.reset().fadeIn(0.1).play();
    ud.animState = 'death';
    // Remove after clip duration (default ~1.5s, use 2s to be safe)
    const clipDuration = (ud.actDeath.getClip?.()?.duration ?? 1.5) * 1000 + 500;
    setTimeout(() => {
      this.scene.remove(w.mesh);
      this._scheduleRespawn(w);
    }, clipDuration);
  } else {
    this.scene.remove(w.mesh);
    this._scheduleRespawn(w);
  }
}
```

- [ ] Extract respawn logic into `_scheduleRespawn(w)`:
```js
_scheduleRespawn(w) {
  setTimeout(() => {
    if (!this.running) return;
    let plat = PLATFORMS[rndInt(1, PLATFORMS.length - 1)];
    for (let i = 0; i < 10; i++) {
      const candidate = PLATFORMS[rndInt(1, PLATFORMS.length - 1)];
      const d = Math.hypot(candidate.x - this.playerPos.x, candidate.z - this.playerPos.z);
      if (d > 25) { plat = candidate; break; }
    }
    const { x: rx, z: rz } = this._safePlatPos(plat);
    const pos = new THREE.Vector3(rx, plat.y, rz);
    w.plat = plat;
    w.pos.copy(pos);
    w.mesh.position.copy(pos);
    // Reset animations
    const ud = w.mesh.userData;
    if (ud.mixer && ud.actIdle) {
      if (ud.actDeath) ud.actDeath.fadeOut(0.1);
      ud.actIdle.reset().fadeIn(0.2).play();
      ud.animState = null;
    }
    this.scene.add(w.mesh);
    w.alive = true;
    w.wanderTarget = null;
  }, 8000);
}
```

- [ ] Commit: `feat: warlock death animation before respawn`

---

### Task 5: Build `islands.js` — graph generator with diverse shapes

**Files:**
- Create: `client/src/islands.js`

- [ ] Create the file with Poisson-disk sampling, MST connectivity, shape types, and biomes:

```js
import { seededRng } from './prng.js';

const MAP_R = 110; // radius of map to place islands within
const MIN_DIST = 28; // min distance between island centers
const MAX_DIST = 55; // max center-to-center for jump connectivity
const JUMP_EDGE_GAP = 11; // max edge-to-edge gap for a valid jump

// Shape clip functions — return true if (lx,lz) is on the island (local coords)
function clipBlob(lx, lz, rx, rz) {
  return (lx*lx)/(rx*rx) + (lz*lz)/(rz*rz) <= 1;
}
function clipRect(lx, lz, rx, rz) {
  return Math.abs(lx) <= rx && Math.abs(lz) <= rz;
}
function clipCrescent(lx, lz, rx, rz) {
  const onOuter = clipBlob(lx, lz, rx, rz);
  const onInner = clipBlob(lx - rx * 0.35, lz, rx * 0.65, rz * 0.65);
  return onOuter && !onInner;
}
function clipElongated(lx, lz, rx, rz) {
  return clipBlob(lx, lz, rx * 1.8, rz * 0.6);
}
function clipRing(lx, lz, rx, rz) {
  const onOuter = clipBlob(lx, lz, rx, rz);
  const onInner = clipBlob(lx, lz, rx * 0.45, rz * 0.45);
  return onOuter && !onInner;
}
function clipLShape(lx, lz, rx, rz) {
  const armA = Math.abs(lx) <= rx && lz >= -rz && lz <= rz * 0.3;
  const armB = lx >= -rx && lx <= rx * 0.3 && Math.abs(lz) <= rz;
  return armA || armB;
}
function clipArchipelago(lx, lz, rx, rz, subBlobs) {
  return subBlobs.some(([ox, oz, r]) => {
    const dx = lx - ox, dz = lz - oz;
    return dx*dx + dz*dz <= r*r;
  });
}

const SHAPES = ['blob', 'elongated', 'crescent', 'ring', 'lshape', 'archipelago'];
const BIOMES = ['grass', 'volcanic', 'crystal', 'desert', 'mushroom', 'ruins'];

const BIOME_PALETTE = {
  grass:    [0x5cb85c, 0x4cae4c, 0x6abf6a, 0x3d9e3d, 0x4aa84a],
  volcanic: [0x8b4513, 0xa0522d, 0x6b3410, 0xcd853f, 0x7a3010],
  crystal:  [0x00c8d4, 0x00a8b8, 0x00e8f0, 0x00d4e8, 0x33e0ff],
  desert:   [0xd4c484, 0xc4b474, 0xe4d494, 0xb4a464, 0xddd494],
  mushroom: [0xff6644, 0xee4422, 0xff8866, 0xdd3311, 0xffaa88],
  ruins:    [0x998877, 0x887766, 0xaa9988, 0x776655, 0xbbaa99],
};

// Poisson-disk sampling in a circle
function poissonDisk(rng, mapR, minDist, count) {
  const pts = [];
  let tries = 0;
  while (pts.length < count && tries < count * 30) {
    tries++;
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * mapR;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (pts.every(([px, pz]) => Math.hypot(x - px, z - pz) >= minDist)) {
      pts.push([x, z]);
    }
  }
  return pts;
}

// Kruskal MST to guarantee connectivity
function buildMST(nodes) {
  const edges = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      edges.push([Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z), i, j]);
  edges.sort((a, b) => a[0] - b[0]);
  const parent = nodes.map((_, i) => i);
  function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
  const mstEdges = [];
  for (const [, i, j] of edges) {
    const pi = find(i), pj = find(j);
    if (pi !== pj) { parent[pi] = pj; mstEdges.push([i, j]); }
  }
  return mstEdges;
}

export function buildIslandGraph(seed = 0x1234ABCD) {
  const rng = seededRng(seed);
  const r = (a, b) => a + rng() * (b - a);
  const ri = (a, b) => Math.floor(r(a, b + 1));

  // Spawn hub always at origin
  const positions = [[0, 0]];
  const extra = poissonDisk(rng, MAP_R, MIN_DIST, 20);
  positions.push(...extra);

  const nodes = positions.map(([x, z], idx) => {
    const hw = r(12, 22);
    const hd = r(12, 22);
    const shape = idx === 0 ? 'blob' : SHAPES[ri(0, SHAPES.length - 1)];
    const biome = idx === 0 ? 'grass' : BIOMES[ri(0, BIOMES.length - 1)];
    // Archipelago sub-blobs
    const subBlobs = shape === 'archipelago'
      ? Array.from({ length: ri(3, 5) }, () => [r(-hw*0.5, hw*0.5), r(-hd*0.5, hd*0.5), r(hw*0.25, hw*0.55)])
      : null;
    return { x, y: 0, z, hw, hd, shape, biome, subBlobs, neighbors: [] };
  });

  // Assign heights: BFS from spawn, each hop +0 to +2
  const visited = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const cur = queue.shift();
    const cn = nodes[cur];
    for (let j = 0; j < nodes.length; j++) {
      if (visited.has(j)) continue;
      const dist = Math.hypot(cn.x - nodes[j].x, cn.z - nodes[j].z);
      if (dist < MAX_DIST) {
        nodes[j].y = Math.min(8, cn.y + r(0, 2));
        visited.add(j);
        queue.push(j);
      }
    }
  }

  // MST edges + extra jump edges
  const mst = buildMST(nodes);
  for (const [i, j] of mst) {
    nodes[i].neighbors.push(j);
    nodes[j].neighbors.push(i);
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const ni = nodes[i], nj = nodes[j];
      const edgeGap = Math.hypot(ni.x - nj.x, ni.z - nj.z) - ni.hw - nj.hw;
      const heightOk = Math.abs(ni.y - nj.y) <= 3;
      if (edgeGap <= JUMP_EDGE_GAP && heightOk && !ni.neighbors.includes(j)) {
        ni.neighbors.push(j);
        nj.neighbors.push(i);
      }
    }
  }

  return nodes;
}

// Build isOnIsland function for a node
export function makeIsOnIsland(node) {
  const { x, z, hw, hd, shape, subBlobs } = node;
  return (px, pz) => {
    const lx = px - x, lz = pz - z;
    // AABB pre-filter
    if (Math.abs(lx) > hw * 2 || Math.abs(lz) > hd * 2) return false;
    switch (shape) {
      case 'blob':        return clipBlob(lx, lz, hw, hd);
      case 'elongated':   return clipElongated(lx, lz, hw, hd);
      case 'crescent':    return clipCrescent(lx, lz, hw, hd);
      case 'ring':        return clipRing(lx, lz, hw, hd);
      case 'lshape':      return clipLShape(lx, lz, hw, hd);
      case 'archipelago': return clipArchipelago(lx, lz, hw, hd, subBlobs);
      default:            return clipBlob(lx, lz, hw, hd);
    }
  };
}

export { BIOME_PALETTE };
```

- [ ] Commit: `feat: islands.js graph generator with 6 shapes and 6 biomes`

---

### Task 6: Replace hardcoded platform defs with island graph in `game.js`

**Files:**
- Modify: `client/src/game.js`

- [ ] Add import at top:
```js
import { buildIslandGraph, makeIsOnIsland, BIOME_PALETTE } from './islands.js';
```

- [ ] Replace `buildPlatforms` function — swap hardcoded `defs` array with graph nodes, and update `platformTopAt` to use `isOnIsland`:

```js
function buildPlatforms(scene) {
  PLATFORMS.length = 0;
  OBSTACLES.length = 0;

  const nodes = buildIslandGraph(0x1234ABCD);

  for (const node of nodes) {
    const { x, y, z, hw, hd, shape, biome, subBlobs } = node;
    const grp = _buildIslandMesh(scene, node);
    const isOn = makeIsOnIsland(node);
    PLATFORMS.push({ x, y, z, w: hw, d: hd, shape, isOn, cone: null });
  }
  _addStarField(scene);
}
```

- [ ] Replace `platformTopAt` to use `isOn`:
```js
function platformTopAt(px, pz) {
  for (const p of PLATFORMS) {
    if (p.isOn ? p.isOn(px, pz) : (
      px >= p.x - p.w && px <= p.x + p.w &&
      pz >= p.z - p.d && pz <= p.z + p.d
    )) {
      return p.y;
    }
  }
  return null;
}
```

- [ ] Add `_buildIslandMesh(scene, node)` that replaces `_buildShapedPlatform` — uses biome palette for Voronoi, biome-appropriate decorations, correct clip shape passed to `buildVoronoiSurface`:

```js
function _buildIslandMesh(scene, node) {
  const { x, y, z, hw, hd, shape, biome, subBlobs } = node;
  const g = new THREE.Group();
  const seed = _islandSeed(Math.round(x), Math.round(z));
  const palette = BIOME_PALETTE[biome];

  // Determine voronoi clip shape
  const voroClip = (shape === 'lshape' || shape === 'archipelago') ? 'rect' : 'circle';
  const relief = biome === 'volcanic' ? 0.15 : 0.1;

  _addVoronoi(g, {
    seed, rx: hw * 0.88, rz: hd * 0.88,
    cellCount: 160, palette, y: 0.8, relief, shape: voroClip,
  }, _vcMat(biome === 'volcanic' ? 0xff4400 : null, biome === 'volcanic' ? 0.3 : 0));

  // Body under island
  const bodyGeo = _paintGeo(
    new THREE.CylinderGeometry(hw * 0.75, hw * 0.4, 5, 7),
    [palette[0], palette[1] ?? palette[0]].map(c => Math.round(c * 0.6)),
    0, 99
  );
  const body = new THREE.Mesh(bodyGeo, _vcMat());
  body.position.y = -3.2;
  g.add(body);

  // Biome decorations
  if (biome === 'grass') _addTrees(g, hw * 0.7, hd * 0.7, rndInt(2, 5), 0.8, x, z);
  if (biome === 'volcanic') {
    const lavaLight = new THREE.PointLight(0xff6600, 5, 28);
    lavaLight.position.y = hw * 0.4 + 1;
    g.add(lavaLight);
  }
  if (biome === 'crystal') {
    for (let i = 0; i < rndInt(4, 7); i++) {
      const h = rnd(1.5, 5);
      const sg = _paintGeo(new THREE.ConeGeometry(rnd(0.2, 0.6), h, 4), [palette[2] ?? palette[0], palette[0]], 0, 99);
      const sm = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.05, metalness: 0.6 }));
      sm.position.set(Math.cos(rnd(0, Math.PI*2)) * rnd(hw*0.2, hw*0.7), 0.8 + h*0.5, Math.sin(rnd(0, Math.PI*2)) * rnd(hd*0.2, hd*0.7));
      g.add(sm);
    }
  }
  if (biome === 'mushroom') {
    for (let i = 0; i < rndInt(3, 7); i++) {
      const sr = rnd(0.4, 1.0);
      const sm = new THREE.Mesh(new THREE.SphereGeometry(sr, 4, 4), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.9 }));
      sm.position.set(Math.cos(rnd(0, Math.PI*2)) * rnd(0, hw*0.7), 0.8 + sr * 0.5, Math.sin(rnd(0, Math.PI*2)) * rnd(0, hd*0.7));
      g.add(sm);
    }
  }
  if (biome === 'ruins') {
    for (let i = 0; i < rndInt(2, 5); i++) {
      const wh = rnd(1.5, 4.5), ww = rnd(1.0, 2.5);
      const wg = _paintGeo(new THREE.BoxGeometry(ww, wh, 1.0), [palette[0], palette[1] ?? palette[0]], 0, 99);
      const angle = rnd(0, Math.PI * 2);
      const wx = Math.cos(angle) * hw * 0.6, wz2 = Math.sin(angle) * hd * 0.6;
      const wm = new THREE.Mesh(wg, _vcMat());
      wm.position.set(wx, 0.5 + wh * 0.5, wz2);
      wm.rotation.y = angle + Math.PI * 0.5;
      g.add(wm);
      _addObstacle(x + wx, z + wz2, 0.6, 0.6);
    }
  }

  g.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
  g.position.set(x, y - 0.8, z);
  scene.add(g);
  return g;
}
```

- [ ] Remove the old `_buildShapedPlatform` function and the old `defs` array entirely.

- [ ] Commit: `feat: procedural island graph replaces hardcoded platform defs`

---

### Task 7: Attack range indicator disc under player

**Files:**
- Modify: `client/src/game.js` — `start()`, `_update()`

- [ ] In `start()`, create the range disc after building player mesh:
```js
// Attack range indicator
if (this._rangeDisc) this.scene.remove(this._rangeDisc);
const discGeo = new THREE.RingGeometry(0, weaponAttackRange(this.weapon.tier), 32);
discGeo.rotateX(-Math.PI / 2);
const discMat = new THREE.MeshBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
this._rangeDisc = new THREE.Mesh(discGeo, discMat);
this.scene.add(this._rangeDisc);
```

- [ ] In `_update()`, after updating `playerMesh.position`, sync disc:
```js
if (this._rangeDisc) {
  this._rangeDisc.position.set(this.playerPos.x, this.playerPos.y + 0.05, this.playerPos.z);
}
```

- [ ] Commit: `feat: attack range indicator disc under player`
