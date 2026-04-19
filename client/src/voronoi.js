import * as THREE from 'three';
import { seededRng } from './prng.js';

function defaultContains(x, z, rx, rz) {
  return (x * x) / (rx * rx) + (z * z) / (rz * rz) <= 1;
}

function mixColor(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function triArea(ax, az, bx, bz, cx, cz) {
  return Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
}

function fbm(x, z, seed) {
  const a = Math.sin((x + seed * 0.0013) * 0.18) * 0.55 + Math.cos((z - seed * 0.0017) * 0.16) * 0.45;
  const b = Math.sin((x - z + seed * 0.0009) * 0.34) * 0.28;
  const c = Math.cos((x * 0.47 + z * 0.29 + seed * 0.0007)) * 0.17;
  return (a + b + c) / 1.45;
}

function generateSeedPoints(seed, rx, rz, cellCount, mask) {
  const rng = seededRng(seed);
  const points = [];
  let attempts = 0;
  while (points.length < cellCount && attempts < cellCount * 18) {
    attempts++;
    const px = (rng() * 2 - 1) * rx;
    const pz = (rng() * 2 - 1) * rz;
    if (!mask(px, pz)) continue;
    points.push([px, pz]);
  }
  return points;
}

function generateCellInfo(seed, palette, points, y, relief) {
  return points.map((_, index) => {
    const cellRng = seededRng((seed ^ ((index + 1) * 2654435761)) >>> 0);
    const base = new THREE.Color(palette[index % palette.length]);
    const dark = base.clone().multiplyScalar(0.56 + cellRng() * 0.12);
    const mid = base.clone().multiplyScalar(0.82 + cellRng() * 0.18);
    const bright = base.clone().lerp(new THREE.Color(0xffffff), 0.08 + cellRng() * 0.1);
    return {
      height: y + cellRng() * relief,
      dark: [dark.r, dark.g, dark.b],
      mid: [mid.r, mid.g, mid.b],
      bright: [bright.r, bright.g, bright.b],
    };
  });
}

function sampleNearest(points, x, z) {
  let nearest = 0;
  let nearestD = Infinity;
  let secondD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dx = x - points[i][0];
    const dz = z - points[i][1];
    const d = dx * dx + dz * dz;
    if (d < nearestD) {
      secondD = nearestD;
      nearestD = d;
      nearest = i;
    } else if (d < secondD) {
      secondD = d;
    }
  }
  return { nearest, nearestD, secondD };
}

export function createTerrainSampler({
  seed,
  rx,
  rz,
  cellCount,
  palette,
  y = 0,
  relief = 0.18,
  contains,
}) {
  const mask = contains ?? ((x, z) => defaultContains(x, z, rx, rz));
  const points = generateSeedPoints(seed, rx, rz, cellCount, mask);
  const cellInfo = generateCellInfo(seed, palette, points, y, relief);

  return (x, z) => {
    if (!mask(x, z)) return null;
    const { nearest, nearestD, secondD } = sampleNearest(points, x, z);
    const dist = Math.sqrt(nearestD);
    const cell = cellInfo[nearest];
    const ridge = Math.max(0, 1 - Math.abs(Math.sqrt(secondD) - dist) / Math.max((rx * 2) / 48, (rz * 2) / 48, 0.0001));
    const edgeFade = Math.min(1, Math.max(0, 1 - Math.hypot(x / (rx || 1), z / (rz || 1))));
    const macro = fbm(x, z, seed);
    const basin = fbm(x * 0.55 + 6.1, z * 0.55 - 5.7, seed ^ 0x9e3779b9);
    const terrace = Math.round((cell.height - y) / Math.max(relief * 0.22, 0.04));
    const macroHeight = macro * relief * 0.92;
    const lowland = Math.min(0, basin) * relief * 0.55;
    return y + macroHeight + lowland + terrace * Math.max(relief * 0.16, 0.045) + ridge * relief * 0.28 + edgeFade * relief * 0.18;
  };
}

export function buildVoronoiSurface({
  seed,
  rx,
  rz,
  cellCount,
  palette,
  y = 0,
  relief = 0.18,
  contains,
}) {
  const mask = contains ?? ((x, z) => defaultContains(x, z, rx, rz));
  const points = generateSeedPoints(seed, rx, rz, cellCount, mask);
  const cellInfo = generateCellInfo(seed, palette, points, y, relief);

  const resolution = Math.max(28, Math.round(Math.max(rx, rz) * 2.2));
  const stepX = (rx * 2) / resolution;
  const stepZ = (rz * 2) / resolution;
  const columns = resolution + 1;

  const samples = new Array(columns * columns);
  for (let xi = 0; xi <= resolution; xi++) {
    const x = -rx + xi * stepX;
    for (let zi = 0; zi <= resolution; zi++) {
      const z = -rz + zi * stepZ;
      const inside = mask(x, z);
      if (!inside) {
        samples[xi * columns + zi] = null;
        continue;
      }

      const { nearest, nearestD, secondD } = sampleNearest(points, x, z);

      const dist = Math.sqrt(nearestD);
      const cell = cellInfo[nearest];
      const ridge = Math.max(0, 1 - Math.abs(Math.sqrt(secondD) - dist) / Math.max(stepX, stepZ, 0.0001));
      const edgeFade = Math.min(1, Math.max(0, 1 - Math.hypot(x / (rx || 1), z / (rz || 1))));
      const macro = fbm(x, z, seed);
      const basin = fbm(x * 0.55 + 6.1, z * 0.55 - 5.7, seed ^ 0x9e3779b9);
      const terrace = Math.round((cell.height - y) / Math.max(relief * 0.22, 0.04));
      const macroHeight = macro * relief * 0.92;
      const lowland = Math.min(0, basin) * relief * 0.55;
      const height = y + macroHeight + lowland + terrace * Math.max(relief * 0.16, 0.045) + ridge * relief * 0.28 + edgeFade * relief * 0.18;

      const colorA = mixColor(cell.dark, cell.mid, Math.min(1, dist / Math.max(rx, rz, 1) * 1.4));
      const raised = Math.max(0, macro) * 0.3;
      const color = mixColor(colorA, cell.bright, ridge * 0.55 + edgeFade * 0.16 + raised);
      samples[xi * columns + zi] = { x, y: height, z, color };
    }
  }

  const positions = [];
  const colors = [];

  function pushTriangle(a, b, c) {
    if (!a || !b || !c) return;
    if (triArea(a.x, a.z, b.x, b.z, c.x, c.z) < 1e-4) return;
    const avg = [
      (a.color[0] + b.color[0] + c.color[0]) / 3,
      (a.color[1] + b.color[1] + c.color[1]) / 3,
      (a.color[2] + b.color[2] + c.color[2]) / 3,
    ];
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    colors.push(avg[0], avg[1], avg[2], avg[0], avg[1], avg[2], avg[0], avg[1], avg[2]);
  }

  for (let xi = 0; xi < resolution; xi++) {
    for (let zi = 0; zi < resolution; zi++) {
      const a = samples[xi * columns + zi];
      const b = samples[(xi + 1) * columns + zi];
      const c = samples[xi * columns + zi + 1];
      const d = samples[(xi + 1) * columns + zi + 1];
      if (!(a || b || c || d)) continue;
      pushTriangle(a, b, d);
      pushTriangle(a, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo.toNonIndexed();
}
