import { seededRng } from './prng.js';

const MAP_R = 108;
const TARGET_MIN = 17;
const TARGET_MAX = 21;
const EDGE_GAP_MIN = 1.8;
const EDGE_GAP_MAX = 5.2;
const EXTRA_EDGE_GAP = 6.4;
const MIN_CENTER_SPACING = 2.5;
const MAX_HEIGHT = 8;

function clipBlob(lx, lz, rx, rz) {
  return (lx * lx) / (rx * rx) + (lz * lz) / (rz * rz) <= 1;
}

function clipRect(lx, lz, rx, rz) {
  return Math.abs(lx) <= rx && Math.abs(lz) <= rz;
}

function clipCrescent(lx, lz, rx, rz) {
  return clipBlob(lx, lz, rx, rz) && !clipBlob(lx - rx * 0.34, lz + rz * 0.06, rx * 0.62, rz * 0.68);
}

function clipElongated(lx, lz, rx, rz) {
  return clipBlob(lx, lz, rx, rz * 0.56);
}

function clipRing(lx, lz, rx, rz) {
  return clipBlob(lx, lz, rx, rz) && !clipBlob(lx, lz, rx * 0.42, rz * 0.42);
}

function clipLShape(lx, lz, rx, rz) {
  const armA = Math.abs(lx) <= rx && lz >= -rz && lz <= rz * 0.28;
  const armB = lx >= -rx && lx <= rx * 0.28 && Math.abs(lz) <= rz;
  return armA || armB;
}

function clipArchipelago(lx, lz, _rx, _rz, subBlobs) {
  return subBlobs.some(([ox, oz, r]) => {
    const dx = lx - ox;
    const dz = lz - oz;
    return dx * dx + dz * dz <= r * r;
  });
}

const SHAPES = ['blob', 'blob', 'elongated', 'lshape', 'archipelago', 'blob', 'crescent'];
const BIOMES = ['grass', 'volcanic', 'crystal', 'desert', 'mushroom', 'ruins'];

export const BIOME_PALETTE = {
  grass:    [0x5cb85c, 0x7bc96f, 0x4f9f59, 0x3b6f43, 0x9acb6b],
  volcanic: [0x6b2f1a, 0x8a3c23, 0xb44b2a, 0x402016, 0xd88332],
  crystal:  [0x46d8ff, 0x73e8ff, 0x2eaac9, 0x17708a, 0xa6f5ff],
  desert:   [0xe2ca83, 0xc9a45d, 0xb98748, 0x8c6738, 0xf0dfab],
  mushroom: [0xff725e, 0xffb27f, 0xd9474e, 0xffe6cf, 0x913247],
  ruins:    [0xb0a189, 0x8f7d68, 0xd0c1a8, 0x695b4b, 0x8f8e86],
};

function ri(rng, a, b) {
  return a + Math.floor(rng() * (b - a + 1));
}

function rf(rng, a, b) {
  return a + rng() * (b - a);
}

function baseRadius(node) {
  return Math.min(node.hw, node.hd);
}

function reachRadius(node) {
  return Math.max(node.hw, node.hd);
}

function jumpRadius(node) {
  return Math.max(4, reachRadius(node) * 0.97);
}

function makeSubBlobs(rng, hw, hd) {
  return Array.from({ length: ri(rng, 3, 5) }, () => {
    const r = rf(rng, Math.min(hw, hd) * 0.28, Math.min(hw, hd) * 0.52);
    return [
      rf(rng, -hw * 0.45, hw * 0.45),
      rf(rng, -hd * 0.45, hd * 0.45),
      r,
    ];
  });
}

function makeNode(rng, index, x, z) {
  const shape = index === 0 ? 'blob' : SHAPES[ri(rng, 0, SHAPES.length - 1)];
  const biome = index === 0 ? 'grass' : BIOMES[ri(rng, 0, BIOMES.length - 1)];
  const elongated = shape === 'elongated';
  const hw = elongated ? rf(rng, 22, 32) : rf(rng, 16, 24);
  const hd = elongated ? rf(rng, 10.5, 15) : rf(rng, 15, 22);
  return {
    x,
    y: 0,
    z,
    hw,
    hd,
    shape,
    biome,
    subBlobs: shape === 'archipelago' ? makeSubBlobs(rng, hw, hd) : null,
    neighbors: [],
    parent: -1,
    ring: 0,
  };
}

function canPlace(candidate, nodes) {
  const radial = Math.hypot(candidate.x, candidate.z) + reachRadius(candidate);
  if (radial > MAP_R) return false;
  return nodes.every((node) => {
    const centerDist = Math.hypot(candidate.x - node.x, candidate.z - node.z);
    const minDist = reachRadius(candidate) + reachRadius(node) + MIN_CENTER_SPACING;
    return centerDist >= minDist;
  });
}

function connect(nodes, a, b) {
  if (!nodes[a].neighbors.includes(b)) nodes[a].neighbors.push(b);
  if (!nodes[b].neighbors.includes(a)) nodes[b].neighbors.push(a);
}

function assignHeights(nodes, rng) {
  const seen = new Set([0]);
  const queue = [0];
  nodes[0].y = 0;

  while (queue.length) {
    const current = queue.shift();
    for (const neighbor of nodes[current].neighbors) {
      if (seen.has(neighbor)) continue;
      const rise = rng() < 0.28 ? 0 : rf(rng, 0.45, 1.55);
      nodes[neighbor].y = Math.min(MAX_HEIGHT, nodes[current].y + rise);
      seen.add(neighbor);
      queue.push(neighbor);
    }
  }
}

function edgeGap(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z) - jumpRadius(a) - jumpRadius(b);
}

function ensureConnected(nodes) {
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const current = queue.shift();
    for (const neighbor of nodes[current].neighbors) {
      if (seen.has(neighbor)) continue;
      seen.add(neighbor);
      queue.push(neighbor);
    }
  }

  if (seen.size === nodes.length) return;

  const reachable = [...seen];
  for (let i = 0; i < nodes.length; i++) {
    if (seen.has(i)) continue;
    let best = reachable[0];
    let bestGap = Infinity;
    for (const j of reachable) {
      const gap = edgeGap(nodes[i], nodes[j]);
      if (gap < bestGap) {
        bestGap = gap;
        best = j;
      }
    }
    connect(nodes, i, best);
    seen.add(i);
    reachable.push(i);
  }
}

export function buildIslandGraph(seed = 0x1234ABCD) {
  const rng = seededRng(seed);
  const targetCount = ri(rng, TARGET_MIN, TARGET_MAX);
  const nodes = [makeNode(rng, 0, 0, 0)];

  let attempts = 0;
  while (nodes.length < targetCount && attempts < 1800) {
    attempts++;
    const parentIndex = ri(rng, 0, nodes.length - 1);
    const parent = nodes[parentIndex];
    if (parent.neighbors.length >= 4 && rng() < 0.75) continue;

    const node = makeNode(rng, nodes.length, 0, 0);
    const parentRadius = reachRadius(parent);
    const childRadius = reachRadius(node);
    const angle = rng() * Math.PI * 2;
    const gap = rf(rng, EDGE_GAP_MIN, EDGE_GAP_MAX);
    const distance = parentRadius + childRadius + gap;

    node.x = parent.x + Math.cos(angle) * distance;
    node.z = parent.z + Math.sin(angle) * distance;
    node.parent = parentIndex;
    node.ring = parent.ring + 1;

    if (!canPlace(node, nodes)) continue;

    nodes.push(node);
    connect(nodes, parentIndex, nodes.length - 1);
  }

  assignHeights(nodes, rng);

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].neighbors.includes(j)) continue;
      const gap = edgeGap(nodes[i], nodes[j]);
      const heightDelta = Math.abs(nodes[i].y - nodes[j].y);
      if (gap <= EXTRA_EDGE_GAP && heightDelta <= 2.35) connect(nodes, i, j);
    }
  }

  ensureConnected(nodes);
  return nodes;
}

export function makeIsOnIsland(node) {
  const { x, z, hw, hd, shape, subBlobs } = node;
  return (px, pz) => {
    const lx = px - x;
    const lz = pz - z;
    if (Math.abs(lx) > hw + 1.5 || Math.abs(lz) > hd + 1.5) return false;
    switch (shape) {
      case 'blob': return clipBlob(lx, lz, hw, hd);
      case 'elongated': return clipElongated(lx, lz, hw, hd);
      case 'crescent': return clipCrescent(lx, lz, hw, hd);
      case 'ring': return clipRing(lx, lz, hw, hd);
      case 'lshape': return clipLShape(lx, lz, hw, hd);
      case 'archipelago': return clipArchipelago(lx, lz, hw, hd, subBlobs);
      default: return clipRect(lx, lz, hw, hd);
    }
  };
}
