# Combat + Island Generation Design
_2026-04-18_

## 1. Combat System

### Keybinding
- `F` → `P` (dodge)
- `O` = attack (manual, triggers attack animation flash on player)

### Auto-attack fix
- `weaponAttackRange(tier)` currently returns too small a value for tier-1 weapons
- Set floor of 2.5 units so starter players can reliably hit adjacent warlocks
- `_updateCombat` already polls every frame when `_attackTimer <= 0` — no structural change needed

### Death animation
- When `_killWarlock(w)` is called:
  1. Set `w.alive = false` so warlock stops moving/attacking
  2. Look up `Death` clip on the zombie GLB mixer (`CharacterArmature|Death` or `Death`)
  3. Play it once (clampWhenFinished = true, loop = LoopOnce)
  4. After clip duration (~1.5s), remove mesh from scene and start 8s respawn timer
- Warlock mesh stays visible during death animation but collision/hit detection is disabled

### Attack range indicator
- Flat `RingGeometry` disc under player, radius = weapon attack range
- Semi-transparent green, `depthWrite: false`, rendered slightly above ground
- Scales with weapon tier upgrade

---

## 2. Voronoi Fix

### Current problems
- `fillGeo` base disc sits at `y + 0.001` → z-fights with cell bottoms that land exactly at `y`
- Fill disc uses a single flat color that looks wrong against the faceted cells
- `toNonIndexed()` on warlock geometry every spawn is expensive and mutates shared geometry

### Fix
- Remove the fillGeo approach entirely
- Instead: ensure no cell is skipped by assigning orphaned grid points to their nearest seed regardless of count (remove the `points.length < 3` early-exit guard, handle degenerate cells with a single triangle fan from centroid)
- For 1-point cells: render as a single quad. For 2-point cells: render as a thin sliver triangle. This ensures 100% coverage with no gaps.
- The solid body cylinder beneath each island already covers any edge micro-gaps from outside the circle — so interior holes are the only real problem.

---

## 3. Procedural Island Graph

### Graph generation (`islands.js` — new file)
1. Place N=18–24 seed nodes using Poisson-disk sampling within map bounds (±120 units)
2. Assign each node: position (x, y, z), biome, shape-type, half-extents
3. Build minimum spanning tree → guarantee full connectivity
4. Add extra edges for nodes within jump range (edge-to-edge gap ≤ 11u, height diff ≤ 3u)
5. Assign Y heights: spawn node = 0, BFS outward incrementing by 0–2u per hop, cap at 8u

### Shape types (replaces old hardcoded defs)
| Type | Description | Clip function |
|------|-------------|---------------|
| `blob` | Circle Voronoi | `dx²/rx² + dz²/rz² ≤ 1` |
| `elongated` | Stretched ellipse (aspect 2:1–3:1) | same as blob, different rx/rz |
| `crescent` | Circle minus offset circle | blob AND NOT inner circle |
| `L-shape` | Two overlapping rectangles | rect A OR rect B |
| `ring` | Walkable torus rim (hole in center) | blob AND NOT center circle |
| `archipelago` | 3–4 sub-blobs sharing one platform entry | union of small blobs |

### Biomes
| Biome | Palette | Relief | Decorations |
|-------|---------|--------|-------------|
| `grass` | greens | 0.12 | trees |
| `volcanic` | browns/reds | 0.10 | lava light, crater |
| `crystal` | cyan/blue | 0.10 | crystal spires |
| `desert` | tans/yellows | 0.10 | stone pillars |
| `mushroom` | reds/whites | 0.10 | white spots |
| `ruins` | greys/tans | 0.10 | wall fragments |

### Physics integration
- Each island stores `isOnIsland(x, z) → bool` closure
- `platformTopAt(px, pz)` iterates islands, calls `isOnIsland` first, then returns `p.y`
- AABB pre-filter (existing) before calling the shape function

### Connectivity guarantee
- After graph built, verify all nodes reachable from spawn via BFS
- If any node unreachable, add a bridge edge to nearest reachable node

---

## 4. Implementation Order
1. Fix Voronoi gaps (voronoi.js)
2. Keybinding F→P, add O attack key (game.js)  
3. Auto-attack range floor fix (game.js)
4. Warlock death animation (game.js)
5. Build islands.js with graph generator + shape clip functions
6. Replace hardcoded defs in buildPlatforms with graph output
7. Attack range indicator disc
