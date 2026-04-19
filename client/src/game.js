import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'https://cdn.jsdelivr.net/npm/meshoptimizer@0.18.1/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { C, weaponAttackRange, weaponAttackCooldown, randomWeaponForMana, tierForMana } from './constants.js';
import { Vitals } from './vitals.js';
import { buildVoronoiSurface, createTerrainSampler } from './voronoi.js';
import { buildIslandGraph, makeIsOnIsland, BIOME_PALETTE } from './islands.js';

const HALF           = C.mapSize / 2;
const WARLOCK_SPEED  = 4;
const PLAYER_SPEED   = 10;
const DODGE_SPEED    = 24;
const DODGE_DURATION = 0.22;
const DODGE_COOLDOWN = 1.0;
const GRAVITY        = -22;
const PLAYER_VISUAL_OFFSET_Y = 0;
const JUMP_FORCE     = 13;
const WANDER_INTERVAL = 3;

// Camera — follows mouse always, no click needed
const CAM_DISTANCE    = 12;
const CAM_MIN_PITCH   = 0.18;
const CAM_MAX_PITCH   = 1.05;
const CAM_SENSITIVITY = 0.0022;

function rnd(a, b) { return Math.random() * (b - a) + a; }
function rndInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
function _islandSeed(cx, cz) { return (((cx * 73856093) ^ (cz * 19349663)) >>> 0); }
function clampMap(v) {
  v.x = Math.max(-HALF, Math.min(HALF, v.x));
  v.z = Math.max(-HALF, Math.min(HALF, v.z));
}
function randomMapPoint() { return new THREE.Vector3(rnd(-HALF, HALF), 0, rnd(-HALF, HALF)); }

const EMOJI_POOL = ['😈','💀','🔥','⚡','👻','🗡️','🤡','😤','💪','🫡'];
function randomEmoji() { return EMOJI_POOL[Math.floor(Math.random() * EMOJI_POOL.length)]; }

function _addVoronoi(parent, opts, mat) {
  parent.add(new THREE.Mesh(buildVoronoiSurface(opts), mat));
}

// ─── Platform system ──────────────────────────────────────────────────────────
// Each platform: { x, y, z, w, d }  — AABB for physics (w/d = half extents)

const PLATFORMS = [];

// ─── Obstacle system ──────────────────────────────────────────────────────────
// Each obstacle: { wx, wz, hw, hd } — world-space AABB half-extents
const OBSTACLES = [];

function _addObstacle(wx, wz, hw, hd) {
  OBSTACLES.push({ wx, wz, hw, hd });
}

function _resolveObstacles(pos) {
  for (const o of OBSTACLES) {
    const dx = pos.x - o.wx, dz = pos.z - o.wz;
    const ox = o.hw - Math.abs(dx), oz = o.hd - Math.abs(dz);
    if (ox <= 0 || oz <= 0) continue;
    // Push out along the axis of least penetration
    if (ox < oz) pos.x += dx > 0 ? ox : -ox;
    else         pos.z += dz > 0 ? oz : -oz;
  }
}

function platformTopAt(px, pz) {
  for (const p of PLATFORMS) {
    const onIt = p.isOn ? p.isOn(px, pz)
      : (px >= p.x - p.w && px <= p.x + p.w && pz >= p.z - p.d && pz <= p.z + p.d);
    if (onIt) return p.heightAt ? p.heightAt(px, pz) : p.y;
  }
  return null;
}

function planarDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function _randomPointOnPlatform(plat, margin = 1.4, attempts = 72) {
  for (let i = 0; i < attempts; i++) {
    const x = plat.x + rnd(-Math.max(1, plat.w - margin), Math.max(1, plat.w - margin));
    const z = plat.z + rnd(-Math.max(1, plat.d - margin), Math.max(1, plat.d - margin));
    if (!plat.isOn || plat.isOn(x, z)) return { x, z };
  }
  return { x: plat.x, z: plat.z };
}

// ─── Audio ────────────────────────────────────────────────────────────────────
class AudioMgr {
  constructor() { this._ctx = null; this._buffers = {}; }

  async load() {
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      const files = {
        footstep: '../audio/footstep.mp3', attack: '../audio/attack.mp3',
        hurt: '../audio/hurt.mp3',         heal: '../audio/heal.mp3',
        mana: '../audio/mana.mp3',         warlock_die: '../audio/warlock_die.mp3',
        dodge: '../audio/dodge.mp3',
      };
      await Promise.all(Object.entries(files).map(async ([k, url]) => {
        try {
          const buf = await (await fetch(url)).arrayBuffer();
          this._buffers[k] = await this._ctx.decodeAudioData(buf);
        } catch {}
      }));
    } catch {}
  }

  play(name, volume = 1) {
    if (!this._ctx || !this._buffers[name]) return;
    if (this._ctx.state === 'suspended') this._ctx.resume();
    const src  = this._ctx.createBufferSource();
    const gain = this._ctx.createGain();
    src.buffer = this._buffers[name];
    gain.gain.value = volume;
    src.connect(gain).connect(this._ctx.destination);
    src.start();
  }
}

const gltfLoader = new GLTFLoader();
function loadGLB(url) {
  return new Promise((res, rej) => gltfLoader.load(url, res, null, rej));
}

function setupKTX2(renderer) {
  const ktx2 = new KTX2Loader()
    .setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/libs/basis/')
    .detectSupport(renderer);
  gltfLoader.setKTX2Loader(ktx2);
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
}

// ─── Vertex-color helper for characters ───────────────────────────────────────
function _vcCharGeo(geo, topHex, midHex, botHex) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < minY) minY = y; if (y > maxY) maxY = y; }
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) / (maxY - minY || 1);
    if (t > 0.6) c.setHex(topHex);
    else if (t > 0.3) c.setHex(midHex);
    else c.setHex(botHex);
    const n = (Math.sin(pos.getX(i) * 9.1 + pos.getZ(i) * 7.3) * 0.5 + 0.5) * 0.12 - 0.06;
    col[i * 3] = Math.max(0, Math.min(1, c.r + n));
    col[i * 3+1] = Math.max(0, Math.min(1, c.g + n));
    col[i * 3+2] = Math.max(0, Math.min(1, c.b + n));
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}
const _vcStdMat = (emissive, emissiveInt = 0) => new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.7, metalness: 0.15,
  ...(emissive ? { emissive: new THREE.Color(emissive), emissiveIntensity: emissiveInt } : {}),
});

// ─── Procedural player mesh ───────────────────────────────────────────────────
function buildPlayerMesh() {
  const g = new THREE.Group();

  // Boots
  [-0.21, 0.21].forEach((x, i) => {
    const geo = _vcCharGeo(new THREE.BoxGeometry(0.22, 0.28, 0.32, 3, 2, 3), 0x1a0a00, 0x2a1500, 0x0d0700);
    const m = new THREE.Mesh(geo, _vcStdMat());
    m.position.set(x, 0.14, 0.04);
    g.add(m);
  });

  // Legs — CapsuleGeometry with dark robe-cloth color
  const legGeo = () => _vcCharGeo(new THREE.CapsuleGeometry(0.17, 0.55, 4, 8), 0x2c1e5e, 0x1a1240, 0x0f0b28);
  [-0.21, 0.21].forEach((x, i) => {
    const leg = new THREE.Mesh(legGeo(), _vcStdMat());
    leg.position.set(x, 0.52, 0);
    leg.name = i === 0 ? 'legL' : 'legR';
    g.add(leg);
  });

  // Torso — armored chest, brighter blue with gold trim suggestion
  const torsoGeo = _vcCharGeo(new THREE.CapsuleGeometry(0.33, 0.52, 5, 10), 0x4a5fcc, 0x3548a8, 0x2c3a8c);
  const torso = new THREE.Mesh(torsoGeo, _vcStdMat(null, 0));
  torso.position.y = 1.18;
  g.add(torso);

  // Shoulder pads
  [-0.44, 0.44].forEach(x => {
    const sg = _vcCharGeo(new THREE.SphereGeometry(0.2, 8, 6), 0xc8a020, 0xa07818, 0x806010);
    const sm = new THREE.Mesh(sg, _vcStdMat(null, 0));
    sm.position.set(x, 1.38, 0);
    sm.scale.set(1, 0.7, 0.85);
    g.add(sm);
  });

  // Cape — segmented plane with gradient red→dark
  const capeGeo = _vcCharGeo(new THREE.PlaneGeometry(0.6, 0.85, 2, 8), 0x990000, 0x660000, 0x330000);
  const cape = new THREE.Mesh(capeGeo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 }));
  cape.position.set(0, 1.05, 0.3);
  cape.name = 'cape';
  g.add(cape);

  // Arms
  [-0.5, 0.5].forEach((x, i) => {
    const ag = _vcCharGeo(new THREE.CapsuleGeometry(0.13, 0.42, 4, 6), 0x3548a8, 0x2c3a8c, 0x1e2860);
    const arm = new THREE.Mesh(ag, _vcStdMat());
    arm.position.set(x, 1.12, 0);
    arm.rotation.z = i === 0 ? 0.38 : -0.38;
    arm.name = i === 0 ? 'armL' : 'armR';
    g.add(arm);
    // Gauntlet
    const gg = _vcCharGeo(new THREE.BoxGeometry(0.2, 0.22, 0.2, 2, 2, 2), 0xc8a020, 0xa07818, 0x806010);
    const gm = new THREE.Mesh(gg, _vcStdMat());
    gm.position.set(x + (i === 0 ? -0.12 : 0.12), 0.78, 0);
    g.add(gm);
  });

  // Neck
  const neckGeo = _vcCharGeo(new THREE.CylinderGeometry(0.13, 0.16, 0.22, 8), 0xf0c8a0, 0xe0b890, 0xd0a880);
  const neck = new THREE.Mesh(neckGeo, _vcStdMat());
  neck.position.set(0, 1.6, 0);
  g.add(neck);

  // Head — face with skin tones top/sides, darker jaw
  const headGeo = _vcCharGeo(new THREE.SphereGeometry(0.28, 14, 12), 0xf5d0a8, 0xeac090, 0xd4a878);
  const head = new THREE.Mesh(headGeo, _vcStdMat());
  head.position.y = 1.78;
  head.name = 'head';
  g.add(head);

  // Beard / lower face accent
  const beardGeo = _vcCharGeo(new THREE.SphereGeometry(0.16, 8, 6), 0x3a2a1a, 0x2a1c10, 0x1a1008);
  const beard = new THREE.Mesh(beardGeo, _vcStdMat());
  beard.position.set(0, 1.63, -0.14);
  beard.scale.set(1.1, 0.7, 0.6);
  g.add(beard);

  // Hood — conical with inner dark
  const hoodGeo = _vcCharGeo(new THREE.ConeGeometry(0.32, 0.5, 9), 0xaa0000, 0x880000, 0x550000);
  const hood = new THREE.Mesh(hoodGeo, _vcStdMat());
  hood.position.set(0, 2.12, -0.04);
  g.add(hood);

  // Eyes — glowing cyan
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x00ffee });
  [-0.1, 0.1].forEach(x => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 6), eyeMat);
    eye.position.set(x, 1.83, -0.25);
    g.add(eye);
  });

  // Staff — wooden with metal bands
  const staffGeo = _vcCharGeo(new THREE.CylinderGeometry(0.045, 0.055, 1.7, 7), 0x6d4c1f, 0x5d3a10, 0x4a2e08);
  const staff = new THREE.Mesh(staffGeo, _vcStdMat());
  staff.position.set(0.62, 1.05, 0);
  staff.rotation.z = -0.18;
  g.add(staff);

  // Staff orb — glowing purple/blue
  const orbGeo = new THREE.IcosahedronGeometry(0.16, 1);
  _vcCharGeo(orbGeo, 0xaa55ff, 0x7722cc, 0x440099);
  const orb = new THREE.Mesh(orbGeo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.05, metalness: 0.4,
    emissive: new THREE.Color(0x4400cc), emissiveIntensity: 1.0,
  }));
  orb.position.set(0.62, 2.0, 0);
  orb.name = 'orb';
  g.add(orb);

  return g;
}

// ─── Procedural warlock mesh ───────────────────────────────────────────────────
function buildWarlockMesh() {
  const g = new THREE.Group();
  const hue = rnd(0.7, 0.9);
  const glowCol = new THREE.Color().setHSL(hue, 0.95, 0.62);
  const darkCol = new THREE.Color().setHSL(hue, 0.42, 0.1);
  const midCol  = new THREE.Color().setHSL(hue, 0.52, 0.2);
  const rimCol  = new THREE.Color().setHSL(hue, 0.75, 0.38);

  g.userData.glowColor = glowCol.clone();

  const aura = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.62, 22),
    new THREE.MeshBasicMaterial({
      color: glowCol,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  aura.name = 'groundAura';
  aura.rotation.x = -Math.PI / 2;
  aura.position.y = 0.04;
  g.add(aura);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.56, 20),
    new THREE.MeshBasicMaterial({
      color: 0x02050b,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    })
  );
  shadow.name = 'groundShadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  g.add(shadow);

  const robeOuter = new THREE.Mesh(
    _vcCharGeo(new THREE.CylinderGeometry(0.34, 0.6, 1.45, 7, 4), rimCol.getHex(), midCol.getHex(), darkCol.getHex()),
    _vcStdMat(glowCol.getHex(), 0.06)
  );
  robeOuter.position.y = 0.78;
  g.add(robeOuter);

  const robeInner = new THREE.Mesh(
    _vcCharGeo(new THREE.CylinderGeometry(0.18, 0.28, 1.05, 6, 3), 0x3d2756, 0x251632, 0x110b17),
    _vcStdMat(glowCol.getHex(), 0.04)
  );
  robeInner.position.y = 0.92;
  g.add(robeInner);

  const pauldronGeo = _vcCharGeo(new THREE.OctahedronGeometry(0.2, 0), rimCol.getHex(), midCol.getHex(), darkCol.getHex());
  [-0.32, 0.32].forEach((x, i) => {
    const p = new THREE.Mesh(pauldronGeo.clone(), _vcStdMat(glowCol.getHex(), 0.08));
    p.position.set(x, 1.34, 0.02);
    p.scale.set(1.5, 0.9, 1.1);
    p.rotation.z = i === 0 ? 0.55 : -0.55;
    g.add(p);
  });

  const head = new THREE.Mesh(
    _vcCharGeo(new THREE.BoxGeometry(0.42, 0.42, 0.42, 1, 1, 1), 0x1a1620, 0x100c14, 0x08070a),
    _vcStdMat(glowCol.getHex(), 0.05)
  );
  head.position.set(0, 1.56, 0.02);
  head.rotation.y = Math.PI * 0.25;
  g.add(head);

  const hood = new THREE.Mesh(
    _vcCharGeo(new THREE.ConeGeometry(0.34, 0.54, 6), rimCol.getHex(), darkCol.getHex(), 0x09070d),
    _vcStdMat(glowCol.getHex(), 0.08)
  );
  hood.position.set(0, 1.87, -0.04);
  hood.scale.set(1, 1.05, 0.9);
  g.add(hood);

  const mask = new THREE.Mesh(
    _vcCharGeo(new THREE.BoxGeometry(0.22, 0.26, 0.08, 1, 1, 1), 0xddd0ff, 0xb9a9ef, 0x6e6189),
    _vcStdMat(glowCol.getHex(), 0.12)
  );
  mask.position.set(0, 1.53, 0.2);
  mask.rotation.y = Math.PI * 0.25;
  g.add(mask);

  const eyeMat = new THREE.MeshBasicMaterial({ color: glowCol });
  [-0.06, 0.06].forEach((x) => {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.04), eyeMat);
    eye.position.set(x, 1.56, 0.245);
    g.add(eye);
  });

  const cape = new THREE.Mesh(
    _vcCharGeo(new THREE.ConeGeometry(0.46, 1.12, 5, 1, true), rimCol.getHex(), midCol.getHex(), darkCol.getHex()),
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
      emissive: glowCol,
      emissiveIntensity: 0.05,
    })
  );
  cape.position.set(0, 1.1, -0.16);
  cape.scale.set(1.05, 1, 0.72);
  g.add(cape);

  const staff = new THREE.Mesh(
    _vcCharGeo(new THREE.CylinderGeometry(0.035, 0.05, 1.7, 5), 0x5f4432, 0x3d2b20, 0x241811),
    _vcStdMat()
  );
  staff.position.set(0.36, 1.0, 0.02);
  staff.rotation.z = -0.16;
  g.add(staff);

  const orbMat = new THREE.MeshStandardMaterial({
    color: glowCol,
    emissive: glowCol,
    emissiveIntensity: 1.2,
    flatShading: true,
    roughness: 0.15,
    metalness: 0.25,
  });
  const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), orbMat);
  orb.position.set(0.36, 1.92, 0.02);
  orb.name = 'orbR';
  g.add(orb);

  const offhandRune = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), orbMat.clone());
  offhandRune.position.set(-0.24, 1.16, 0.12);
  offhandRune.scale.setScalar(0.7);
  offhandRune.name = 'orbL';
  g.add(offhandRune);

  [-0.26, 0.26].forEach((x, i) => {
    const hand = new THREE.Mesh(
      _vcCharGeo(new THREE.BoxGeometry(0.12, 0.22, 0.12, 1, 1, 1), 0xb8a9d6, 0x7f709d, 0x433955),
      _vcStdMat(glowCol.getHex(), 0.08)
    );
    hand.position.set(x, 1.05, 0.18);
    hand.rotation.z = i === 0 ? 0.25 : -0.2;
    g.add(hand);
  });

  return g;
}

function _setMaterialColor(material, color) {
  if (material.color) material.color.copy(color);
  if (material.emissive) material.emissive.copy(color).multiplyScalar(0.18);
  material.roughness = Math.min(1, material.roughness ?? 0.8);
  material.metalness = 0.05;
}

// ─── Floating platform builder ────────────────────────────────────────────────
// Physics: GRAVITY=-22, JUMP_FORCE=13 → ~3.8u height gain, ~1.18s air, ~11.8u horiz at speed 10
// All adjacent platforms have edge-to-edge gap ≤ 11u, height diff up ≤ 3u

function buildPlatforms(scene) {
  PLATFORMS.length = 0;
  OBSTACLES.length = 0;

  const nodes = buildIslandGraph(0x1234ABCD);
  for (const node of nodes) {
    const heightAt = _buildIslandMesh(scene, node);
    const isOn = makeIsOnIsland(node);
    PLATFORMS.push({ x: node.x, y: node.y, z: node.z, w: node.hw, d: node.hd, isOn, node, heightAt });
  }
  _addStarField(scene);
}

// Shared vertex-color painter — flat shading: non-indexed so each tri gets its own color
function _paintGeo(geo, palHex, noiseAmt, topThreshold) {
  const flat = geo.toNonIndexed();
  flat.deleteAttribute('color');
  const pos = flat.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  // Color per triangle (every 3 verts share one color)
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i+1) + pos.getX(i+2)) / 3;
    const cy = (pos.getY(i) + pos.getY(i+1) + pos.getY(i+2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i+1) + pos.getZ(i+2)) / 3;
    const idx = Math.abs(Math.floor(cx * 3.7 + cz * 5.3)) % palHex.length;
    c.setHex(palHex[idx]);
    if (cy < topThreshold) c.multiplyScalar(0.6);
    for (let v = 0; v < 3; v++) {
      colors[(i+v)*3]   = c.r;
      colors[(i+v)*3+1] = c.g;
      colors[(i+v)*3+2] = c.b;
    }
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  flat.computeVertexNormals();
  return flat;
}

function _vcMat(emissiveHex, emissiveInt = 0) {
  return new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.9, metalness: 0.0, flatShading: true, side: THREE.DoubleSide,
    ...(emissiveHex ? { emissive: new THREE.Color(emissiveHex), emissiveIntensity: emissiveInt } : {}),
  });
}

function _sampleLocalPoint(isOnLocal, hw, hd, margin = 1.4, attempts = 64) {
  for (let i = 0; i < attempts; i++) {
    const lx = rnd(-Math.max(1, hw - margin), Math.max(1, hw - margin));
    const lz = rnd(-Math.max(1, hd - margin), Math.max(1, hd - margin));
    if (isOnLocal(lx, lz)) return { x: lx, z: lz };
  }
  return { x: 0, z: 0 };
}

// Each shape sets g.userData.surfOff = distance from group origin to walkable top.
// buildPlatforms shifts the group down by surfOff so the top lands at world Y = cy.

function _buildIslandMesh(scene, node) {
  const { x, y, z, hw, hd, shape, biome } = node;
  const g = new THREE.Group();
  const seed = _islandSeed(Math.round(x), Math.round(z));
  const palette = BIOME_PALETTE[biome];
  const reliefByBiome = {
    grass: 0.36,
    volcanic: 0.42,
    crystal: 0.3,
    desert: 0.24,
    mushroom: 0.27,
    ruins: 0.26,
  };
  const isOnLocal = makeIsOnIsland({ ...node, x: 0, z: 0 });
  const sampleLocalHeight = createTerrainSampler({
    seed,
    rx: hw * 0.96,
    rz: hd * 0.96,
    cellCount: 78,
    palette,
    y: 0.82,
    relief: reliefByBiome[biome] ?? 0.18,
    contains: (lx, lz) => isOnLocal(lx, lz),
  });

  _addVoronoi(g, {
    seed,
    rx: hw * 0.96,
    rz: hd * 0.96,
    cellCount: 78,
    palette,
    y: 0.82,
    relief: reliefByBiome[biome] ?? 0.18,
    contains: (lx, lz) => isOnLocal(lx, lz),
  }, _vcMat());

  const bodyRadius = Math.max(hw, hd);
  const bodyGeo = _paintGeo(new THREE.CylinderGeometry(bodyRadius * 0.76, bodyRadius * 0.34, 5.8, 9), [0x584131, 0x3a2b1f, 0x6d5442], 0, 99);
  const body = new THREE.Mesh(bodyGeo, _vcMat());
  body.position.y = -3.45;
  g.add(body);

  // Biome decorations
  if (biome === 'grass') {
    _addTrees(g, node, isOnLocal, rndInt(3, 6), 0.82, x, z);
  } else if (biome === 'volcanic') {
    const crater = new THREE.Mesh(
      _paintGeo(new THREE.CylinderGeometry(bodyRadius * 0.18, bodyRadius * 0.25, 0.35, 7), [0x1d120d, 0x3d1f11, 0x5c2716], 0, 99),
      _vcMat(0xff5b1f, 0.3)
    );
    crater.position.set(0, 0.94, 0);
    g.add(crater);
    const lavaLight = new THREE.PointLight(0xff6600, 5, 28);
    lavaLight.position.y = 2.6;
    g.add(lavaLight);
  } else if (biome === 'crystal') {
    for (let i = 0; i < rndInt(4, 7); i++) {
      const h = rnd(1.5, 5);
      const sg = _paintGeo(new THREE.ConeGeometry(rnd(0.2, 0.6), h, 4), [palette[2] ?? palette[0], palette[0]], 0, 99);
      const sm = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.05, metalness: 0.6, emissive: new THREE.Color(0x004466), emissiveIntensity: 0.5 }));
      const local = _sampleLocalPoint(isOnLocal, hw, hd, 2.2);
      sm.position.set(local.x, sampleLocalHeight(local.x, local.z) + h * 0.5, local.z);
      g.add(sm);
    }
  } else if (biome === 'mushroom') {
    for (let i = 0; i < rndInt(3, 7); i++) {
      const sr = rnd(0.4, 1.0);
      const stem = new THREE.Mesh(
        new THREE.CylinderGeometry(sr * 0.18, sr * 0.24, sr * 1.5, 5),
        new THREE.MeshStandardMaterial({ color: 0xf7e9db, flatShading: true, roughness: 0.92 })
      );
      const cap = new THREE.Mesh(
        _paintGeo(new THREE.SphereGeometry(sr, 5, 4), [palette[0], palette[1] ?? palette[0], 0xfff4e8], 0, 99),
        _vcMat()
      );
      const cluster = new THREE.Group();
      const local = _sampleLocalPoint(isOnLocal, hw, hd, 1.6);
      const baseY = sampleLocalHeight(local.x, local.z);
      stem.position.y = baseY + sr * 0.75;
      cap.position.y = baseY + sr * 1.45;
      cap.scale.y = 0.58;
      cluster.position.set(local.x, 0, local.z);
      cluster.add(stem, cap);
      g.add(cluster);
    }
  } else if (biome === 'ruins') {
    for (let i = 0; i < rndInt(2, 5); i++) {
      const wh = rnd(1.5, 4.5), ww = rnd(1.0, 2.5);
      const wg = _paintGeo(new THREE.BoxGeometry(ww, wh, 1.0), [palette[0], palette[1] ?? palette[0]], 0, 99);
      const angle = rnd(0, Math.PI * 2);
      const local = _sampleLocalPoint(isOnLocal, hw, hd, 2.2);
      const wx = local.x, wz2 = local.z;
      const wm = new THREE.Mesh(wg, _vcMat());
      wm.position.set(wx, sampleLocalHeight(wx, wz2) + wh * 0.5, wz2);
      wm.rotation.y = angle + Math.PI * 0.5;
      g.add(wm);
      _addObstacle(x + wx, z + wz2, 0.6, 0.6);
    }
  } else if (biome === 'desert') {
    for (let i = 0; i < rndInt(2, 5); i++) {
      const ph = rnd(1.0, 3.5);
      const pg = _paintGeo(new THREE.CylinderGeometry(0.4, 0.55, ph, 5), [palette[0], palette[2] ?? palette[0]], 0, 99);
      const pm = new THREE.Mesh(pg, _vcMat());
      const local = _sampleLocalPoint(isOnLocal, hw, hd, 2.1);
      pm.position.set(local.x, sampleLocalHeight(local.x, local.z) + ph * 0.5, local.z);
      g.add(pm);
    }
  }

  g.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
  g.position.set(x, y - 0.8, z);
  scene.add(g);
  console.log('[island]', biome, shape, 'pos:', x.toFixed(1), (y-0.8).toFixed(1), z.toFixed(1), 'hw:', hw.toFixed(1), 'meshes:', g.children.length);
  return (wx, wz) => {
    const lx = wx - x;
    const lz = wz - z;
    const localY = sampleLocalHeight(lx, lz);
    return localY == null ? y : y - 0.8 + localY;
  };
}

function _addTrees(parent, node, isOnLocal, count, surfY, platX, platZ) {
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8b5e3c, flatShading: true, roughness: 0.9 });
  const foliageCols = [0x2ecc40, 0x27ae34, 0x3ddd50, 0x22aa30, 0x44ee55];
  for (let i = 0; i < count; i++) {
    const scale = rnd(0.5, 1.3);
    const tg = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * scale, 0.25 * scale, 1.8 * scale, 5), trunkMat);
    trunk.position.y = 0.9 * scale;
    tg.add(trunk);
    const fcol = foliageCols[Math.floor(Math.random() * foliageCols.length)];
    const fmat = new THREE.MeshStandardMaterial({ color: fcol, flatShading: true, roughness: 0.8 });
    [1.6, 1.0, 0.6].forEach((r, layer) => {
      const fm = new THREE.Mesh(new THREE.ConeGeometry(r * scale * 0.5, 1.3 * scale, 5), fmat);
      fm.position.y = (1.8 + layer * 0.85) * scale;
      tg.add(fm);
    });
    const local = _sampleLocalPoint(isOnLocal, node.hw, node.hd, 2);
    const tx = local.x, tz = local.z;
    // Place base flush with the walkable surface (surfY in group-local space)
    tg.position.set(tx, surfY, tz);
    tg.rotation.y = rnd(0, Math.PI * 2);
    parent.add(tg);
    // Register trunk as obstacle in world space
    const hw = 0.3 * scale, hd = 0.3 * scale;
    _addObstacle(platX + tx, platZ + tz, hw, hd);
  }
}

function _addStarField(scene) {
  const geo = new THREE.BufferGeometry();
  const count = 800;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3]     = rnd(-300, 300);
    pos[i * 3 + 1] = rnd(-40, 80);
    pos[i * 3 + 2] = rnd(-300, 300);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.3, sizeAttenuation: true });
  scene.add(new THREE.Points(geo, mat));
}

// ─── Game class ───────────────────────────────────────────────────────────────
export class Game {
  constructor({ onVitalsChanged, onDied, onPortalEntered, onPortalError, onPortalNearby }) {
    this.onVitalsChanged = onVitalsChanged;
    this.onDied          = onDied;
    this.onPortalEntered = onPortalEntered;
    this.onPortalError   = onPortalError;
    this.onPortalNearby  = onPortalNearby;

    this.vitals  = null;
    this.weapon  = { name: 'Stick', tier: 1 };
    this.running = false;
    this.keys    = {};

    this._dodgeTimer    = 0;
    this._dodgeCooldown = 0;
    this._dodgeDir      = new THREE.Vector3();
    this._attackTimer   = 0;
    this._velocityY     = 0;
    this._grounded      = true;
    this._warlocks      = [];
    this._portals       = [];
    this._heartPickups  = [];
    this._nearPortal    = null;
    this._hitCooldowns  = new Map();
    this._flashCallbacks = new Set();
    this._mixers        = [];
    this._footstepTimer = 0;

    // Camera — always follows mouse
    this._camYaw    = 0;
    this._camPitch  = 0.42;
    this._camZoom   = CAM_DISTANCE;
    this._camTarget = new THREE.Vector3();
    this._pointerLocked = false;

    this._audio = new AudioMgr();
    this._portalTex = null;

    this._setupRenderer();
    this._setupScene();
    this._setupInput();
  }

  // ─── Renderer ─────────────────────────────────────────────────────────────
  _setupRenderer() {
    const canvas = document.getElementById('canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.camera) { this.camera.aspect = window.innerWidth / window.innerHeight; this.camera.updateProjectionMatrix(); }
  }

  // ─── Scene ────────────────────────────────────────────────────────────────
  _setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1426);
    this.scene.fog = new THREE.FogExp2(0x0b1426, 0.0034);

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 350);

    this.scene.add(new THREE.HemisphereLight(0x8fb8ff, 0x130d1a, 1.4));
    this.scene.add(new THREE.AmbientLight(0x5c74aa, 0.75));

    const sun = new THREE.DirectionalLight(0xffe0b0, 3.5);
    sun.position.set(60, 120, -80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 400;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -250;
    sun.shadow.camera.right = sun.shadow.camera.top = 250;
    sun.shadow.bias = -0.001;
    this.scene.add(sun);

    // Rim light from below for dramatic space feel
    const rim = new THREE.DirectionalLight(0x3344aa, 1.2);
    rim.position.set(-30, -20, 40);
    this.scene.add(rim);

    // Build floating platforms
    buildPlatforms(this.scene);

    // Player — mesh built after GLBs load; placeholder until then
    this.playerMesh = new THREE.Group();
    this.playerPos  = new THREE.Vector3(0, 2, 0);
    this.scene.add(this.playerMesh);
  }

  // ─── Asset Loading ────────────────────────────────────────────────────────
  async loadAssets(onProgress) {
    onProgress?.('Loading audio…');
    await this._audio.load();

    onProgress?.('Loading portal texture…');
    try {
      const tex = await new Promise((res, rej) => new THREE.TextureLoader().load('../assets/portal.png', res, null, rej));
      tex.colorSpace = THREE.SRGBColorSpace;
      this._portalTex = tex;
    } catch {}

    onProgress?.('Loading characters…');
    setupKTX2(this.renderer);
    const loadGltf = (url) => new Promise((res, rej) => gltfLoader.load(url, res, null, rej));
    try { this._playerGltf  = await loadGltf('../assets/player.glb');  } catch(e) { console.warn('player.glb failed', e); }
    try { this._warlockGltf = await loadGltf('../assets/warlock.glb'); } catch(e) { console.warn('warlock.glb failed', e); }

    onProgress?.('Ready!');
  }

  // ─── Input ────────────────────────────────────────────────────────────────
  _setupInput() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Space' && this.running) {
        e.preventDefault();
        if (this._grounded) this._jump();
        else this._tryDodge();
      }
      if (e.code === 'KeyP' && this.running && this._grounded) this._tryDodge();
      if (e.code === 'KeyO' && this.running) this._attackTimer = 0;
      if (e.code === 'KeyE' && this._nearPortal) this._enterPortal(this._nearPortal);
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    const canvas = document.getElementById('canvas');

    // Pointer lock — click canvas to capture mouse, ESC to release
    canvas.addEventListener('click', () => {
      if (!this.running) return;
      canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this._pointerLocked = document.pointerLockElement === canvas;
    });

    // Mouse move rotates camera when pointer locked
    window.addEventListener('mousemove', (e) => {
      if (!this._pointerLocked || !this.running) return;
      this._camYaw   -= e.movementX * CAM_SENSITIVITY;
      this._camPitch -= e.movementY * CAM_SENSITIVITY;
      this._camPitch  = Math.max(CAM_MIN_PITCH, Math.min(CAM_MAX_PITCH, this._camPitch));
    });

    // Scroll zoom
    canvas.addEventListener('wheel', (e) => {
      this._camZoom = Math.max(5, Math.min(22, this._camZoom + e.deltaY * 0.018));
    }, { passive: true });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _jump() {
    this._velocityY = JUMP_FORCE;
    this._grounded  = false;
    this._audio.play('dodge', 0.4);
  }

  _tryDodge() {
    if (this._dodgeCooldown > 0 || this._dodgeTimer > 0) return;
    const dir = this._moveDir();
    if (dir.lengthSq() === 0) return;
    this._dodgeDir.copy(dir);
    this._dodgeTimer    = DODGE_DURATION;
    this._dodgeCooldown = DODGE_COOLDOWN;
    this._audio.play('dodge', 0.6);
  }

  _moveDir() {
    let fwd = 0, right = 0;
    if (this.keys['KeyW'] || this.keys['ArrowUp'])    fwd   =  1;
    if (this.keys['KeyS'] || this.keys['ArrowDown'])  fwd   = -1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) right =  1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft'])  right = -1;
    if (fwd === 0 && right === 0) return new THREE.Vector3();

    const camFwd   = new THREE.Vector3(-Math.sin(this._camYaw), 0, -Math.cos(this._camYaw));
    const camRight = new THREE.Vector3( Math.cos(this._camYaw), 0, -Math.sin(this._camYaw));
    const dir = new THREE.Vector3().addScaledVector(camFwd, fwd).addScaledVector(camRight, right);
    return dir.lengthSq() > 0 ? dir.normalize() : dir;
  }

  _safePlatPos(plat) {
    return _randomPointOnPlatform(plat);
  }

  _ensureRangeDisc() {
    if (!this._rangeDisc) {
      this._rangeDisc = new THREE.Mesh(
        new THREE.RingGeometry(0.82, 1, 48),
        new THREE.MeshBasicMaterial({
          color: 0x72ff96,
          transparent: true,
          opacity: 0.34,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      this._rangeDisc.rotation.x = -Math.PI / 2;
      this.scene.add(this._rangeDisc);
    }
    const range = weaponAttackRange(this.weapon.tier);
    this._rangeDisc.scale.setScalar(range);
  }

  _syncWeaponToMana(forceRoll = false) {
    const nextTier = tierForMana(this.vitals?.mana ?? C.manaMin);
    if (forceRoll || nextTier !== this.weapon.tier) {
      this.weapon = randomWeaponForMana(this.vitals?.mana ?? C.manaMin);
      this._ensureRangeDisc();
      return true;
    }
    this._ensureRangeDisc();
    return false;
  }

  // ─── Warlocks ─────────────────────────────────────────────────────────────
  _spawnWarlocks() {
    const groupCount = rndInt(C.warlockGroupsMin, C.warlockGroupsMax);
    for (let g = 0; g < groupCount; g++) {
      const size = rndInt(C.warlockGroupSizeMin, C.warlockGroupSizeMax);
      // Pick a platform (skip the central spawn pad index 0 for first spawn)
      const platIdx = rndInt(1, PLATFORMS.length - 1);
      const plat = PLATFORMS[platIdx];
      for (let i = 0; i < size; i++) {
        const mesh = this._buildWarlockFromGltf();
        const { x, z } = this._safePlatPos(plat);
        const pos = new THREE.Vector3(x, plat.heightAt ? plat.heightAt(x, z) : plat.y, z);
        mesh.position.copy(pos);
        mesh.frustumCulled = false;
        mesh.traverse(n => { n.frustumCulled = false; if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
        this.scene.add(mesh);
        console.log('[warlock] spawned at', pos.x.toFixed(1), pos.y.toFixed(1), pos.z.toFixed(1), 'children:', mesh.children.length);
        this._warlocks.push({
          mesh, pos: pos.clone(), alive: true, plat,
          wanderTimer: rnd(0, WANDER_INTERVAL), bobPhase: rnd(0, Math.PI * 2),
        });
      }
    }
  }

  _updateWarlocks(dt) {
    const t = performance.now() * 0.001;
    for (const w of this._warlocks) {
      if (!w.alive) continue;
      const dist = planarDistance(w.pos, this.playerPos);

      if (dist <= C.warlockChaseRadius) {
        const dir = this.playerPos.clone().sub(w.pos).setY(0).normalize();
        w.pos.addScaledVector(dir, WARLOCK_SPEED * dt);
      } else {
        w.wanderTimer -= dt;
        const plat = w.plat;
        if (w.wanderTimer <= 0 || !w.wanderTarget ||
            Math.abs(w.pos.x - w.wanderTarget.x) < 0.8 && Math.abs(w.pos.z - w.wanderTarget.z) < 0.8) {
          const { x: wx, z: wz } = this._safePlatPos(plat);
          const wSurfY = platformTopAt(wx, wz) ?? plat.y;
          w.wanderTarget = new THREE.Vector3(wx, wSurfY, wz);
          w.wanderTimer = WANDER_INTERVAL;
        }
        const dir = w.wanderTarget.clone().sub(w.pos).setY(0);
        if (dir.lengthSq() > 0.01) w.pos.addScaledVector(dir.normalize(), WARLOCK_SPEED * 0.5 * dt);
      }

      // Clamp warlock to its platform
      const p = w.plat;
      w.pos.x = Math.max(p.x - p.w + 0.5, Math.min(p.x + p.w - 0.5, w.pos.x));
      w.pos.z = Math.max(p.z - p.d + 0.5, Math.min(p.z + p.d - 0.5, w.pos.z));
      if (p.isOn && !p.isOn(w.pos.x, w.pos.z)) {
        const safe = this._safePlatPos(p);
        w.pos.x = safe.x;
        w.pos.z = safe.z;
        w.wanderTarget = null;
      }

      // Compute surface Y (slopes on volcano)
      const surfY = p.heightAt ? p.heightAt(w.pos.x, w.pos.z) : p.y;

      // Sit on platform surface with tiny float for hover feel
      w.pos.y = surfY + Math.sin(t * 1.8 + w.bobPhase) * 0.04;
      w.mesh.position.copy(w.pos);

      // Face player when close, else face movement
      if (dist < C.warlockChaseRadius * 1.5) {
        const toPlayer = this.playerPos.clone().sub(w.pos);
        w.mesh.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
      }

      // Animate warlock (GLB walk/run/idle)
      const ud = w.mesh.userData;
      if (ud.mixer) {
        const chasing = dist <= C.warlockChaseRadius;
        const moving  = chasing || (w.wanderTarget &&
          (Math.abs(w.pos.x - w.wanderTarget.x) > 0.8 || Math.abs(w.pos.z - w.wanderTarget.z) > 0.8));
        const wState = chasing ? 'run' : moving ? 'walk' : 'idle';
        if (ud.animState !== wState) {
          const prev = { idle: ud.actIdle, walk: ud.actWalk, run: ud.actRun }[ud.animState];
          const next = { idle: ud.actIdle, walk: ud.actWalk, run: ud.actRun }[wState];
          if (prev) prev.fadeOut(0.2);
          if (next) next.reset().fadeIn(0.2).play();
          ud.animState = wState;
        }
      }

      // Animate shoulder orbs (procedural fallback only)
      const orbL = w.mesh.getObjectByName('orbL');
      const orbR = w.mesh.getObjectByName('orbR');
      const aura = w.mesh.getObjectByName('groundAura');
      const shadow = w.mesh.getObjectByName('groundShadow');
      if (orbL) orbL.position.y = 1.35 + Math.sin(t * 2.5 + w.bobPhase) * 0.12;
      if (orbR) orbR.position.y = 1.35 + Math.sin(t * 2.5 + w.bobPhase + Math.PI) * 0.12;
      if (aura) {
        const pulse = 1 + Math.sin(t * 4 + w.bobPhase) * 0.08;
        aura.scale.setScalar((dist <= C.warlockChaseRadius ? 1.2 : 1) * pulse);
        aura.material.opacity = dist <= C.warlockChaseRadius ? 0.88 : 0.6;
      }
      if (shadow) shadow.scale.setScalar(1 + Math.sin(t * 2 + w.bobPhase) * 0.04);

      // Hit player
      if (dist < 1.35) {
        const cd = this._hitCooldowns.get(w) || 0;
        if (cd <= 0 && this.vitals?.isAlive) {
          this.vitals.takeWarlockHit();
          this._audio.play('hurt', 0.8);
          this._hitCooldowns.set(w, 1.0);
          this._screenShake(0.4);
        }
      }
    }
    for (const [w, t] of this._hitCooldowns) {
      const n = t - dt; if (n <= 0) this._hitCooldowns.delete(w); else this._hitCooldowns.set(w, n);
    }
  }

  _killWarlock(w) {
    w.alive = false;
    this.vitals.killWarlock();
    this._audio.play('warlock_die', 0.7);
    this._spawnDeathParticles(w.pos.clone());

    const ud = w.mesh.userData;
    if (ud.mixer && ud.actDeath) {
      if (ud.actIdle) ud.actIdle.fadeOut(0.1);
      if (ud.actWalk) ud.actWalk.fadeOut(0.1);
      if (ud.actRun)  ud.actRun.fadeOut(0.1);
      ud.actDeath.reset().fadeIn(0.1).play();
      ud.animState = 'death';
      const clipDuration = (ud.actDeath.getClip?.()?.duration ?? 1.5) * 1000 + 500;
      setTimeout(() => { this.scene.remove(w.mesh); this._scheduleRespawn(w); }, clipDuration);
    } else {
      this.scene.remove(w.mesh);
      this._scheduleRespawn(w);
    }
  }

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
      const pos = new THREE.Vector3(rx, plat.heightAt ? plat.heightAt(rx, rz) : plat.y, rz);
      w.plat = plat;
      w.pos.copy(pos);
      w.mesh.position.copy(pos);
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

  _spawnDeathParticles(pos) {
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.SphereGeometry(rnd(0.05, 0.15), 4, 4);
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(rnd(0.7, 0.9), 1, 0.6) });
      const p = new THREE.Mesh(geo, mat);
      p.position.copy(pos).setY(pos.y + 1);
      const vel = new THREE.Vector3(rnd(-3,3), rnd(2,6), rnd(-3,3));
      this.scene.add(p);
      let age = 0;
      const tick = (dt) => {
        age += dt; vel.y -= 12 * dt;
        p.position.addScaledVector(vel, dt);
        mat.opacity = Math.max(0, 1 - age * 2);
        mat.transparent = true;
        if (age > 0.6) { this.scene.remove(p); this._flashCallbacks.delete(tick); }
      };
      this._flashCallbacks.add(tick);
    }
  }

  // ─── Screen shake ─────────────────────────────────────────────────────────
  _screenShake(intensity) {
    this._shakeIntensity = intensity;
    this._shakeTimer = 0.25;
  }

  // ─── Combat ───────────────────────────────────────────────────────────────
  _updateCombat(dt) {
    this._attackTimer -= dt;
    if (this._attackTimer > 0) return;
    const range = weaponAttackRange(this.weapon.tier);
    let nearest = null, nearDist = Infinity;
    for (const w of this._warlocks) {
      if (!w.alive) continue;
      const d = planarDistance(w.pos, this.playerPos);
      if (d <= range && d < nearDist) { nearest = w; nearDist = d; }
    }
    if (!nearest) return;
    this._attackTimer = weaponAttackCooldown(this.weapon.tier);
    this._killWarlock(nearest);
    this._audio.play('attack', 0.6);
    this._spawnHitFlash(nearest.pos.clone());
  }

  _spawnHitFlash(pos) {
    const geo = new THREE.SphereGeometry(0.6, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos).setY(pos.y + 1.2);
    this.scene.add(mesh);
    let t = 0;
    const tick = (dt) => {
      t += dt; mesh.scale.setScalar(1 + t * 6); mat.opacity = Math.max(0, 1 - t * 6);
      if (t > 0.16) { this.scene.remove(mesh); this._flashCallbacks.delete(tick); }
    };
    this._flashCallbacks.add(tick);
  }

  // ─── Portals ──────────────────────────────────────────────────────────────
  _spawnPortals(list) {
    // Place portals on outer platforms (indices 4,5,6)
    const platIndices = [4, 5, 6, 7, 8];
    for (let i = 0; i < Math.min(list.length, platIndices.length); i++) {
      const plat = PLATFORMS[platIndices[i]] || PLATFORMS[rndInt(2, PLATFORMS.length - 1)];
      const point = this._safePlatPos(plat);
      const pos = new THREE.Vector3(point.x, plat.heightAt ? plat.heightAt(point.x, point.z) : plat.y, point.z);
      this._addPortal(list[i], pos, i);
    }
  }

  _addPortal(data, pos, idx) {
    if (this._portals[idx]) this.scene.remove(this._portals[idx].mesh);
    const col   = data.isMetaKing ? 0xffd700 : 0x4466ff;
    const group = new THREE.Group();

    // Standing ring portal (vertical)
    const ringGeo = new THREE.TorusGeometry(2.0, 0.18, 12, 40);
    const ringMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.8, roughness: 0.2 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 2.5;
    group.add(ring); group._ring = ring;

    // Inner disc (swirling texture)
    if (this._portalTex) {
      const discMat = new THREE.MeshBasicMaterial({
        map: this._portalTex, transparent: true, opacity: 0.75,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1.82, 32), discMat);
      disc.position.y = 2.5;
      group.add(disc); group._disc = disc;
    }

    // Stone pillar base
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 0.9 });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, 2.6, 8), pillarMat);
    pillar.position.y = 1.3;
    group.add(pillar);

    const light = new THREE.PointLight(col, 2.5, 14);
    light.position.y = 2.5;
    group.add(light); group._light = light;

    group.position.copy(pos);
    this.scene.add(group);
    this._portals[idx] = { mesh: group, data, pos: pos.clone(), idx };
  }

  _spawnOfflinePortals() {
    this._spawnPortals([
      { portalId: 'offline-1', ownerNickname: 'BotAlpha', ownerMana: 500, isMetaKing: false },
      { portalId: 'offline-2', ownerNickname: 'BotBeta',  ownerMana: 300, isMetaKing: false },
      { portalId: 'offline-3', ownerNickname: 'BotGamma', ownerMana: 200, isMetaKing: true  },
    ]);
  }

  _updatePortals(dt) {
    const t = performance.now() * 0.001;
    let anyNear = false;
    for (const p of this._portals) {
      if (!p) continue;
      if (p.mesh._ring)  p.mesh._ring.rotation.z += dt * 0.9;
      if (p.mesh._disc)  p.mesh._disc.rotation.z -= dt * 1.4;
      if (p.mesh._light) p.mesh._light.intensity  = 2.0 + Math.sin(t * 3) * 0.8;

      const near = p.pos.distanceTo(this.playerPos) < 3.5;
      if (near) { anyNear = true; this._nearPortal = p; }
    }
    if (!anyNear && this._nearPortal) { this._nearPortal = null; this.onPortalNearby?.(false); }
    if (anyNear) this.onPortalNearby?.(true);
  }

  async _enterPortal(portal) {
    if (!this.running || !this.vitals?.isAlive) return;
    if (!this.vitals.tryEnterPortal()) { this.onPortalError?.('Not enough stamina'); return; }
    this._audio.play('mana', 0.8);
    if (portal.data.portalId.startsWith('offline-')) {
      this.vitals.gainMana(C.portalManaGain);
      if (this._syncWeaponToMana()) this._audio.play('mana', 0.45);
      this.onPortalEntered?.({ weaponName: this.weapon.name, weaponTier: this.weapon.tier });
      return;
    }
    try {
      const { api } = await import('./api.js');
      const res = await api.enterPortal(portal.data.portalId, randomEmoji());
      if (res.success) {
        this.vitals.syncFromServer(res.playerMana, res.playerStamina, this.vitals.hearts);
        this.weapon = { name: res.weaponName, tier: res.weaponTier };
        this._ensureRangeDisc();
        if (res.newPortal) this._addPortal(res.newPortal, portal.pos, portal.idx);
        this.onPortalEntered?.({ weaponName: res.weaponName, weaponTier: res.weaponTier });
      } else { this.onPortalError?.(res.error || 'Portal failed'); }
    } catch { this.onPortalError?.('Server unreachable'); }
  }

  // ─── Heart pickups ────────────────────────────────────────────────────────
  _spawnHeartPickups() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xff2244, emissive: 0xaa0022, emissiveIntensity: 0.7, roughness: 0.3 });
    for (let i = 0; i < C.heartPickupsOnMap; i++) {
      const p = PLATFORMS[rndInt(0, PLATFORMS.length - 1)];
      const point = this._safePlatPos(p);
      const pos = new THREE.Vector3(point.x, (p.heightAt ? p.heightAt(point.x, point.z) : p.y) + 0.8, point.z);
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.4, 0), mat.clone());
      mesh.position.copy(pos);
      this.scene.add(mesh);
      this._heartPickups.push({ mesh, pos: pos.clone(), active: true, respawnTimer: 0 });
    }
  }

  _updateHeartPickups(dt) {
    const t = performance.now() * 0.001;
    for (const h of this._heartPickups) {
      if (!h.active) {
        h.respawnTimer -= dt;
        if (h.respawnTimer <= 0) { h.active = true; h.mesh.visible = true; }
        continue;
      }
      h.mesh.rotation.y += dt * 2.5;
      h.mesh.rotation.x += dt * 1.2;
      h.mesh.position.y  = h.pos.y + Math.sin(t * 2 + h.pos.x) * 0.18;

      if (h.pos.distanceTo(this.playerPos) < 1.5 && this.vitals.hearts < C.heartsMax) {
        h.active = false; h.mesh.visible = false;
        h.respawnTimer = C.heartPickupRespawnSeconds;
        this.vitals.restoreHeartPickup();
        this._audio.play('heal', 0.7);
      }
    }
  }

  // ─── Player animation ─────────────────────────────────────────────────────
  // ─── GLB character builders ───────────────────────────────────────────────
  _buildPlayerFromGltf() {
    if (!this._playerGltf) return buildPlayerMesh(); // fallback to procedural

    const clone = SkeletonUtils.clone(this._playerGltf.scene);
    clone.scale.setScalar(0.012); // Fox model is in cm; scale to ~2u game height

    clone.traverse(n => {
      if (n.isMesh && n.material) {
        const mats = Array.isArray(n.material) ? n.material : [n.material];
        mats.forEach(m => { if (m.map) m.map.colorSpace = THREE.SRGBColorSpace; });
        n.castShadow = true;
        n.receiveShadow = true;
      }
    });

    if (this._playerGltf.animations?.length) {
      const mixer = new THREE.AnimationMixer(clone);
      this._mixers.push(mixer);
      const clips = this._playerGltf.animations;
      const find = (...kws) => {
        for (const kw of kws) {
          const c = clips.find(a => a.name.toLowerCase().includes(kw.toLowerCase()));
          if (c) return c;
        }
        return clips[0];
      };
      clone.userData.mixer    = mixer;
      clone.userData.actIdle  = mixer.clipAction(find('idle', 'stand', 'survey', 'tpose'));
      clone.userData.actWalk  = mixer.clipAction(find('walk', 'move'));
      clone.userData.actJump  = mixer.clipAction(find('jump', 'fall', 'air', 'run', 'survey'));
      clone.userData.animState = null;
      clone.userData.actIdle.play();
    }

    return clone;
  }

  _buildWarlockFromGltf() {
    return buildWarlockMesh();
  }

  _animatePlayer(dt, moving, inAir) {
    const ud = this.playerMesh.userData;
    if (ud.mixer) {
      const state = inAir ? 'jump' : moving ? 'walk' : 'idle';
      if (ud.animState !== state) {
        const prev = { idle: ud.actIdle, walk: ud.actWalk, jump: ud.actJump }[ud.animState];
        const next = { idle: ud.actIdle, walk: ud.actWalk, jump: ud.actJump }[state];
        if (prev) prev.fadeOut(0.2);
        if (next) next.reset().fadeIn(0.2).play();
        ud.animState = state;
      }
      return;
    }

    // Procedural fallback mesh animation
    const t = performance.now() * 0.001;
    const legL = this.playerMesh.getObjectByName('legL');
    const legR = this.playerMesh.getObjectByName('legR');
    const armL = this.playerMesh.getObjectByName('armL');
    const armR = this.playerMesh.getObjectByName('armR');
    const cape = this.playerMesh.getObjectByName('cape');
    const orb  = this.playerMesh.getObjectByName('orb');

    if (moving && !inAir) {
      const swing = Math.sin(t * 8) * 0.45;
      if (legL) legL.rotation.x =  swing;
      if (legR) legR.rotation.x = -swing;
      if (armL) armL.rotation.x = -swing * 0.5;
      if (armR) armR.rotation.x =  swing * 0.5;
      if (cape) cape.rotation.x = Math.sin(t * 8 + 0.5) * 0.12;
    } else if (inAir) {
      if (legL) { legL.rotation.x = -0.6; }
      if (legR) { legR.rotation.x = -0.6; }
      if (armL) { armL.rotation.z =  0.8; }
      if (armR) { armR.rotation.z = -0.8; }
    } else {
      const breath = Math.sin(t * 1.5) * 0.04;
      if (legL) legL.rotation.x *= 0.85;
      if (legR) legR.rotation.x *= 0.85;
      if (armL) { armL.rotation.x *= 0.85; armL.rotation.z = 0.35 + breath; }
      if (armR) { armR.rotation.x *= 0.85; armR.rotation.z = -0.35 - breath; }
    }

    if (orb) {
      orb.scale.setScalar(1 + Math.sin(t * 4) * 0.12);
      orb.material.emissiveIntensity = 0.6 + Math.sin(t * 4) * 0.4;
    }
  }

  // ─── Camera ───────────────────────────────────────────────────────────────
  _updateCamera(dt) {
    const dist = this._camZoom;
    const x = dist * Math.sin(this._camYaw) * Math.cos(this._camPitch);
    const y = dist * Math.sin(this._camPitch);
    const z = dist * Math.cos(this._camYaw) * Math.cos(this._camPitch);

    const targetY = this.playerPos.y + 1.4;
    this._camTarget.lerp(new THREE.Vector3(this.playerPos.x, targetY, this.playerPos.z), 0.14);

    // Screen shake
    let shakeX = 0, shakeY = 0;
    if (this._shakeTimer > 0) {
      this._shakeTimer -= dt;
      const s = this._shakeIntensity * (this._shakeTimer / 0.25);
      shakeX = rnd(-s, s); shakeY = rnd(-s, s);
    }

    const dest = this._camTarget.clone().add(new THREE.Vector3(x + shakeX, y + shakeY, z));
    this.camera.position.lerp(dest, 0.1);
    this.camera.lookAt(this._camTarget);
  }

  // ─── Footsteps ────────────────────────────────────────────────────────────
  _updateFootsteps(dt, moving) {
    if (!moving || !this._grounded) { this._footstepTimer = 0; return; }
    this._footstepTimer += dt;
    if (this._footstepTimer > 0.38) { this._footstepTimer = 0; this._audio.play('footstep', 0.25); }
  }

  // ─── Session ──────────────────────────────────────────────────────────────
  start({ mana, stamina, hearts, weaponName, weaponTier, portals, offline }) {
    this.vitals = new Vitals(mana, stamina, hearts);
    this.vitals.onChange = (m, s, h) => this.onVitalsChanged?.(m, s, h);
    this.vitals.onDied   = () => this._handleDeath();
    this.weapon  = { name: weaponName || 'Stick', tier: weaponTier || 1 };
    this._offline = offline;

    // Rebuild player mesh from GLB (or procedural fallback) each session
    this.scene.remove(this.playerMesh);
    this._mixers = this._mixers.filter(m => m !== this.playerMesh.userData?.mixer);
    this.playerMesh = this._buildPlayerFromGltf();
    this.scene.add(this.playerMesh);

    const spawnPlat = PLATFORMS[0];
    this.playerPos.set(0, spawnPlat?.heightAt ? spawnPlat.heightAt(0, 0) : (spawnPlat?.y ?? 0), 0);
    this.playerMesh.position.set(this.playerPos.x, this.playerPos.y + PLAYER_VISUAL_OFFSET_Y, this.playerPos.z);
    this._velocityY = 0; this._grounded = true;
    this._dodgeTimer = this._dodgeCooldown = this._attackTimer = 0;
    this._hitCooldowns.clear(); this._flashCallbacks.clear();
    this._nearPortal = null; this._shakeTimer = 0;

    this._warlocks.forEach(w => this.scene.remove(w.mesh)); this._warlocks = [];
    this._portals.forEach(p => p && this.scene.remove(p.mesh)); this._portals = [];
    this._heartPickups.forEach(h => this.scene.remove(h.mesh)); this._heartPickups = [];

    this._spawnWarlocks();
    if (portals?.length) this._spawnPortals(portals);
    else this._spawnOfflinePortals();
    this._spawnHeartPickups();
    this._ensureRangeDisc();

    this.vitals.onChange(mana, stamina, hearts);
    this.running = true;
    this._startLoop();
  }

  _handleDeath() {
    this.running = false;
    const manaAtEnd = this.vitals.mana;
    this.vitals.applyDeath();
    // Reset weapon to tier matching new mana
    this.weapon = randomWeaponForMana(this.vitals.mana);
    this.onDied?.({ manaAtStart: this._manaAtStart || manaAtEnd, manaAtEnd, weapon: this.weapon });
  }

  setManaAtStart(m) { this._manaAtStart = m; }
  stop() { this.running = false; }

  // ─── Loop ─────────────────────────────────────────────────────────────────
  _startLoop() {
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      this._update(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  _update(dt) {
    if (!this.vitals?.isAlive) return;

    // Gravity & platform collision — continuous: check swept segment to prevent tunneling
    const prevY = this.playerPos.y;
    this._velocityY += GRAVITY * dt;
    const moveY = this._velocityY * dt;
    this.playerPos.y += moveY;

    const platTop = platformTopAt(this.playerPos.x, this.playerPos.z);
    if (platTop !== null) {
      // Swept check: did we cross the surface this frame while moving down?
      const crossedDown = this._velocityY <= 0 && prevY >= platTop && this.playerPos.y <= platTop;
      // Also catch case where player is already sitting on platform (prevent sinking)
      const onSurface = this.playerPos.y <= platTop + 0.02 && prevY <= platTop + 0.5;
      if (crossedDown || (this._grounded && onSurface)) {
        this.playerPos.y = platTop;
        this._velocityY  = 0;
        this._grounded   = true;
      } else if (this.playerPos.y > platTop) {
        this._grounded = false;
      }
    } else {
      this._grounded = false;
    }

    // Fall death
    if (this.playerPos.y < -12 && this.vitals?.isAlive) {
      this._handleDeath();
      return;
    }

    this._dodgeCooldown = Math.max(0, this._dodgeCooldown - dt);
    let moving = false;

    if (this._dodgeTimer > 0) {
      this._dodgeTimer -= dt;
      this.playerPos.addScaledVector(this._dodgeDir, DODGE_SPEED * dt);
      moving = true;
    } else {
      const dir = this._moveDir();
      if (dir.lengthSq() > 0) {
        this.playerPos.addScaledVector(dir, PLAYER_SPEED * dt);
        const targetYaw = Math.atan2(dir.x, dir.z);
        let diff = targetYaw - this.playerMesh.rotation.y;
        while (diff >  Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.playerMesh.rotation.y += diff * Math.min(1, 14 * dt);
        moving = true;
      }
    }

    clampMap(this.playerPos);
    _resolveObstacles(this.playerPos);
    const movedPlatTop = platformTopAt(this.playerPos.x, this.playerPos.z);
    if (movedPlatTop !== null && this.playerPos.y <= movedPlatTop + 0.45) {
      this.playerPos.y = movedPlatTop;
      if (this._velocityY <= 0) {
        this._velocityY = 0;
        this._grounded = true;
      }
    }
    this.playerMesh.position.set(this.playerPos.x, this.playerPos.y + PLAYER_VISUAL_OFFSET_Y, this.playerPos.z);
    if (this._rangeDisc) this._rangeDisc.position.set(this.playerPos.x, this.playerPos.y + 0.05, this.playerPos.z);

    this._updateWarlocks(dt);
    this._updateCombat(dt);
    this._updatePortals(dt);
    this._updateHeartPickups(dt);
    this._updateCamera(dt);
    this._updateFootsteps(dt, moving);
    for (const fn of this._flashCallbacks) fn(dt);
    for (const m of this._mixers) m.update(dt);
    this._animatePlayer(dt, moving, !this._grounded);
  }
}
