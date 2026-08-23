import { Sprite, Texture } from 'pixi.js';
import { HW, HH, TH } from './iso';
import { tileHash, varyColor } from './colors';

export type TerrainKind = 'grassland' | 'plains' | 'forest' | 'hills' | 'mountains' | 'desert' | 'marsh' | 'water' | 'fog';
export type TerrainNeighbors = readonly [TerrainKind | null, TerrainKind | null, TerrainKind | null, TerrainKind | null];
export type StructureKind = 'house' | 'farm' | 'mine' | 'barracks' | 'city_center' | 'town_center';

const PAD = 2;
const W = 2 * HW + PAD * 2;
const GROUND_HEIGHT = TH + PAD * 2;
const GROUND_CENTER_Y = PAD + HH;

const TERRAIN_HEADROOM: Record<TerrainKind, number> = {
  grassland: 0,
  plains: 0,
  forest: 18,
  hills: 8,
  mountains: 30,
  desert: 0,
  marsh: 4,
  water: 0,
  fog: 0
};

const TERRAIN_BASE: Record<TerrainKind, number> = {
  grassland: 0x5f963e,
  plains: 0x9c9a4b,
  forest: 0x477b35,
  hills: 0x7c8451,
  mountains: 0x737667,
  desert: 0xc29a4b,
  marsh: 0x526f50,
  water: 0x315fa3,
  fog: 0x1d241f
};

const TERRAIN_VARIANTS: Record<TerrainKind, number> = {
  grassland: 12,
  plains: 12,
  forest: 10,
  hills: 8,
  mountains: 8,
  desert: 10,
  marsh: 10,
  water: 12,
  fog: 1
};

const STRUCTURE_HEADROOM: Record<StructureKind, number> = {
  farm: 0,
  mine: 14,
  house: 24,
  barracks: 28,
  town_center: 32,
  city_center: 42
};

const rgb = (hex: number): [number, number, number] => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
const css = (color: number, alpha = 1) => {
  const [r, g, b] = rgb(color);
  return `rgba(${r},${g},${b},${alpha})`;
};

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function diamondPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale = 1) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - HH * scale);
  ctx.lineTo(cx + HW * scale, cy);
  ctx.lineTo(cx, cy + HH * scale);
  ctx.lineTo(cx - HW * scale, cy);
  ctx.closePath();
}

function clipDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale = 0.98) {
  diamondPath(ctx, cx, cy, scale);
  ctx.clip();
}

function drawFlatGround(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: number) {
  diamondPath(ctx, cx, cy);
  ctx.fillStyle = css(color);
  ctx.fill();
}

function drawGrass(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number, sparse = false) {
  ctx.save();
  clipDiamond(ctx, cx, cy);
  const rng = mulberry32(seed + 11);
  const count = sparse ? 8 : 11;
  for (let i = 0; i < count; i++) {
    const x = Math.round(cx + (rng() - 0.5) * 52);
    const y = Math.round(cy + (rng() - 0.5) * 19);
    ctx.fillStyle = sparse ? 'rgba(103,86,39,0.48)' : rng() > 0.45 ? 'rgba(38,104,36,0.46)' : 'rgba(118,151,67,0.42)';
    ctx.fillRect(x, y, 1, 2);
    if (!sparse && rng() > 0.72) ctx.fillRect(x - 1, y + 1, 3, 1);
  }
  ctx.restore();
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: number) {
  const trunkWidth = size > 1 ? 2 : 1;
  ctx.fillStyle = '#3b2d1b';
  ctx.fillRect(x - Math.floor(trunkWidth / 2), y - 2, trunkWidth, 5);
  ctx.fillStyle = css(color);
  ctx.fillRect(x - size, y - 8, size * 2 + 1, 3);
  ctx.fillRect(x - size - 1, y - 5, size * 2 + 3, 3);
  ctx.fillRect(x - size, y - 2, size * 2 + 1, 2);
  ctx.fillStyle = 'rgba(157,184,88,0.45)';
  ctx.fillRect(x - size, y - 8, size, 1);
  ctx.fillRect(x - size - 1, y - 5, size + 1, 1);
}

function drawForest(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number) {
  const rng = mulberry32(seed + 101);
  const trees = Array.from({ length: 7 }, () => ({
    x: Math.round(cx + (rng() - 0.5) * 42),
    y: Math.round(cy - 1 + (rng() - 0.5) * 13),
    size: rng() > 0.68 ? 3 : 2,
    color: rng() > 0.35 ? 0x285f2d : 0x376f34
  })).sort((a, b) => a.y - b.y);
  for (const tree of trees) drawTree(ctx, tree.x, tree.y, tree.size, tree.color);
}

function drawHills(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number) {
  const rng = mulberry32(seed + 211);
  for (const [dx, dy, halfWidth, height] of [
    [-13, 4, 9, 7],
    [5, 4, 12, 9]
  ] as const) {
    const base = rng() > 0.5 ? 0x737348 : 0x687449;
    for (let line = 0; line < height; line++) {
      const width = Math.max(2, Math.round((line / height) * halfWidth));
      const y = Math.round(cy + dy - height + line);
      ctx.fillStyle = css(line < height / 2 ? mixColor(base, 0xb5a968, 0.22) : base);
      ctx.fillRect(Math.round(cx + dx - width), y, width * 2 + 1, 1);
    }
    ctx.fillStyle = 'rgba(211,199,130,0.5)';
    ctx.fillRect(Math.round(cx + dx - 2), Math.round(cy + dy - height + 2), 2, 2);
  }
}

function drawMountains(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number) {
  const rng = mulberry32(seed + 307);
  for (const [dx, halfWidth, height] of [
    [-12, 11, 23],
    [9, 14, 29]
  ] as const) {
    const base = rng() > 0.5 ? 0x878777 : 0x797d70;
    for (let line = 0; line < height; line++) {
      const width = Math.max(1, Math.round((line / height) * halfWidth));
      const y = Math.round(cy + 7 - height + line);
      ctx.fillStyle = css(base);
      ctx.fillRect(Math.round(cx + dx - width), y, width + 1, 1);
      ctx.fillStyle = '#55594f';
      ctx.fillRect(Math.round(cx + dx + 1), y, width, 1);
      if (line < 7) {
        ctx.fillStyle = line % 3 === 0 ? '#f0eee0' : '#d7d7c9';
        ctx.fillRect(Math.round(cx + dx - Math.min(width, 3)), y, Math.min(width * 2 + 1, 6), 1);
      }
    }
  }
}

function drawDesert(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number) {
  ctx.save();
  clipDiamond(ctx, cx, cy);
  const rng = mulberry32(seed + 401);
  ctx.fillStyle = 'rgba(120,76,31,0.48)';
  for (let i = 0; i < 6; i++) {
    const x = Math.round(cx - 25 + rng() * 45);
    const y = Math.round(cy - 7 + rng() * 14);
    const length = 3 + Math.floor(rng() * 6);
    ctx.fillRect(x, y, length, 1);
    if (rng() > 0.55) ctx.fillRect(x + 2, y - 1, Math.max(2, length - 3), 1);
  }
  ctx.restore();
}

function drawMarsh(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number) {
  ctx.save();
  clipDiamond(ctx, cx, cy);
  const rng = mulberry32(seed + 503);
  ctx.fillStyle = 'rgba(34,79,81,0.58)';
  for (let i = 0; i < 5; i++) {
    const x = Math.round(cx + (rng() - 0.5) * 42);
    const y = Math.round(cy + (rng() - 0.5) * 14);
    const width = 4 + Math.floor(rng() * 6);
    ctx.fillRect(x, y, width, 2);
    ctx.fillRect(x + 2, y - 1, Math.max(2, width - 4), 1);
  }
  ctx.fillStyle = 'rgba(35,66,29,0.85)';
  for (let i = 0; i < 11; i++) {
    const x = Math.round(cx + (rng() - 0.5) * 48);
    const y = Math.round(cy + (rng() - 0.5) * 18);
    ctx.fillRect(x, y - 3 - Math.floor(rng() * 3), 1, 4 + Math.floor(rng() * 3));
  }
  ctx.restore();
}

function drawWater(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number) {
  ctx.save();
  clipDiamond(ctx, cx, cy);
  const rng = mulberry32(seed + 601);
  ctx.fillStyle = 'rgba(142,193,219,0.48)';
  for (let i = 0; i < 6; i++) {
    const x = Math.round(cx - 24 + rng() * 42);
    const y = Math.round(cy - 8 + rng() * 16);
    ctx.fillRect(x, y, 5 + Math.floor(rng() * 4), 1);
    if (rng() > 0.72) ctx.fillRect(x + 2, y + 1, 3, 1);
  }
  ctx.restore();
}

function drawFarm(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save();
  clipDiamond(ctx, cx, cy, 0.9);
  for (let i = -3; i <= 3; i++) {
    const offset = i * 7;
    ctx.strokeStyle = 'rgba(77,48,18,0.72)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + offset - 18, cy - 9);
    ctx.lineTo(cx + offset + 18, cy + 9);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(224,188,65,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + offset - 18, cy - 10);
    ctx.lineTo(cx + offset + 18, cy + 8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRocks(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  for (const [dx, dy, radius, color] of [
    [-8, 2, 7, 0x847762],
    [6, 4, 6, 0x6f6251],
    [0, -4, 7, 0x978773]
  ] as const) {
    ctx.fillStyle = css(color);
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#dfbf6c';
  for (const [dx, dy] of [
    [-3, -5],
    [5, 1],
    [-1, 4]
  ] as const)
    ctx.fillRect(cx + dx, cy + dy, 2, 2);
}

function pitchedRoof(ctx: CanvasRenderingContext2D, cx: number, topY: number, halfW: number, peakH: number, color: number) {
  ctx.fillStyle = css(color);
  ctx.beginPath();
  ctx.moveTo(cx - halfW, topY);
  ctx.lineTo(cx, topY - peakH);
  ctx.lineTo(cx + halfW, topY);
  ctx.closePath();
  ctx.fill();
}

function drawHouse(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const baseY = cy - 2;
  ctx.fillStyle = 'rgba(0,0,0,0.24)';
  ctx.fillRect(cx - 11, cy + 2, 23, 4);
  ctx.fillStyle = '#c2a074';
  ctx.fillRect(cx - 9, baseY - 11, 18, 13);
  ctx.fillStyle = '#9b7656';
  ctx.fillRect(cx + 1, baseY - 11, 8, 13);
  pitchedRoof(ctx, cx, baseY - 11, 12, 9, 0x8b4a28);
  ctx.fillStyle = '#4b2d1c';
  ctx.fillRect(cx - 2, baseY - 4, 4, 6);
  ctx.fillStyle = '#abc4ca';
  ctx.fillRect(cx - 7, baseY - 8, 3, 3);
}

function drawBarracks(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const baseY = cy - 2;
  ctx.fillStyle = 'rgba(0,0,0,0.24)';
  ctx.fillRect(cx - 14, cy + 2, 28, 4);
  ctx.fillStyle = '#7a5540';
  ctx.fillRect(cx - 12, baseY - 13, 24, 15);
  ctx.fillStyle = '#614333';
  ctx.fillRect(cx + 2, baseY - 13, 10, 15);
  pitchedRoof(ctx, cx, baseY - 13, 14, 8, 0x4a2a1a);
  ctx.strokeStyle = '#8a7a60';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + 9, baseY - 13);
  ctx.lineTo(cx + 9, baseY - 26);
  ctx.stroke();
  ctx.fillStyle = '#c03030';
  ctx.beginPath();
  ctx.moveTo(cx + 9, baseY - 26);
  ctx.lineTo(cx + 18, baseY - 23);
  ctx.lineTo(cx + 9, baseY - 20);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#382317';
  ctx.fillRect(cx - 2, baseY - 5, 4, 7);
}

function drawTownCenter(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const baseY = cy - 2;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(cx - 16, cy + 2, 32, 5);
  ctx.fillStyle = '#b8a883';
  ctx.fillRect(cx - 13, baseY - 12, 26, 14);
  ctx.fillStyle = '#8a7a5a';
  ctx.fillRect(cx - 15, baseY - 15, 30, 4);
  ctx.fillStyle = '#c2b28c';
  ctx.fillRect(cx - 4, baseY - 28, 9, 13);
  pitchedRoof(ctx, cx, baseY - 28, 6, 7, 0x6a4a30);
  ctx.fillStyle = '#3a2818';
  ctx.fillRect(cx - 2, baseY - 23, 4, 4);
  ctx.fillStyle = '#d8c8a0';
  for (const dx of [-9, -4, 4, 9]) ctx.fillRect(cx + dx - 1, baseY - 12, 2, 14);
  ctx.fillStyle = '#4a3020';
  ctx.fillRect(cx - 3, baseY - 5, 6, 7);
}

function drawCityCenter(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const baseY = cy - 2;
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(cx - 19, cy + 2, 38, 5);
  ctx.fillStyle = '#a89e88';
  ctx.fillRect(cx - 17, baseY - 12, 34, 14);
  ctx.fillStyle = '#8e8675';
  ctx.fillRect(cx + 1, baseY - 12, 16, 14);
  ctx.fillStyle = '#b8ae96';
  for (let x = cx - 17; x < cx + 16; x += 6) ctx.fillRect(x, baseY - 15, 4, 4);
  for (const dx of [-17, 9]) {
    ctx.fillStyle = '#b0a688';
    ctx.fillRect(cx + dx, baseY - 18, 8, 20);
    pitchedRoof(ctx, cx + dx + 4, baseY - 18, 6, 7, 0x6a4030);
  }
  ctx.fillStyle = '#c0b696';
  ctx.fillRect(cx - 8, baseY - 26, 16, 18);
  pitchedRoof(ctx, cx, baseY - 26, 11, 9, 0x6a4030);
  ctx.strokeStyle = '#8a7a60';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, baseY - 35);
  ctx.lineTo(cx, baseY - 44);
  ctx.stroke();
  ctx.fillStyle = '#c03030';
  ctx.beginPath();
  ctx.moveTo(cx, baseY - 44);
  ctx.lineTo(cx + 9, baseY - 41);
  ctx.lineTo(cx, baseY - 38);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3a2518';
  ctx.fillRect(cx - 4, baseY - 5, 8, 7);
}

function renderTerrain(kind: TerrainKind, variant: number): HTMLCanvasElement {
  const headroom = TERRAIN_HEADROOM[kind];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = TH + headroom + PAD * 2;
  const ctx = canvas.getContext('2d')!;
  const cx = W / 2;
  const cy = PAD + headroom + HH;
  const seed = variant * 7919 + 42;

  if (kind === 'fog') {
    drawFlatGround(ctx, cx, cy, TERRAIN_BASE.fog);
    return canvas;
  }

  drawFlatGround(ctx, cx, cy, varyColor(TERRAIN_BASE[kind], variant, variant * 3, 5));
  switch (kind) {
    case 'grassland':
      drawGrass(ctx, cx, cy, seed);
      break;
    case 'plains':
      drawGrass(ctx, cx, cy, seed, true);
      break;
    case 'forest':
      drawForest(ctx, cx, cy, seed);
      break;
    case 'hills':
      drawHills(ctx, cx, cy, seed);
      break;
    case 'mountains':
      drawMountains(ctx, cx, cy, seed);
      break;
    case 'desert':
      drawDesert(ctx, cx, cy, seed);
      break;
    case 'marsh':
      drawMarsh(ctx, cx, cy, seed);
      break;
    case 'water':
      drawWater(ctx, cx, cy, seed);
      break;
  }
  return canvas;
}

function renderStructure(kind: StructureKind): HTMLCanvasElement {
  const headroom = STRUCTURE_HEADROOM[kind];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = TH + headroom + PAD * 2;
  const ctx = canvas.getContext('2d')!;
  const cx = W / 2;
  const cy = PAD + headroom + HH;
  switch (kind) {
    case 'farm':
      drawFarm(ctx, cx, cy);
      break;
    case 'mine':
      drawRocks(ctx, cx, cy);
      break;
    case 'house':
      drawHouse(ctx, cx, cy);
      break;
    case 'barracks':
      drawBarracks(ctx, cx, cy);
      break;
    case 'town_center':
      drawTownCenter(ctx, cx, cy);
      break;
    case 'city_center':
      drawCityCenter(ctx, cx, cy);
      break;
  }
  return canvas;
}

const terrainCache = new Map<string, Texture>();
const transitionCache = new Map<string, Texture>();
const structureCache = new Map<string, Texture>();

export function initSprites(): Promise<void> {
  return Promise.resolve();
}

function terrainTexture(kind: TerrainKind, variant: number): Texture {
  const key = `${kind}:${variant}`;
  const cached = terrainCache.get(key);
  if (cached) return cached;
  const texture = Texture.from(renderTerrain(kind, variant));
  texture.source.scaleMode = 'nearest';
  terrainCache.set(key, texture);
  return texture;
}

function structureTexture(kind: StructureKind): Texture {
  const cached = structureCache.get(kind);
  if (cached) return cached;
  const texture = Texture.from(renderStructure(kind));
  texture.source.scaleMode = 'nearest';
  structureCache.set(kind, texture);
  return texture;
}

export function getTerrainSprite(kind: TerrainKind, col: number, row: number): Sprite {
  const variant = (tileHash(col, row) >>> 0) % TERRAIN_VARIANTS[kind];
  const texture = terrainTexture(kind, variant);
  const sprite = new Sprite(texture);
  const headroom = TERRAIN_HEADROOM[kind];
  sprite.anchor.set(0.5, (PAD + headroom + HH) / (TH + headroom + PAD * 2));
  return sprite;
}

const EDGE_VERTICES: readonly [readonly [number, number], readonly [number, number]][] = [
  [
    [0, -HH],
    [HW, 0]
  ],
  [
    [HW, 0],
    [0, HH]
  ],
  [
    [0, HH],
    [-HW, 0]
  ],
  [
    [-HW, 0],
    [0, -HH]
  ]
];

function mixColor(a: number, b: number, amount: number): number {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return (Math.round(ar + (br - ar) * amount) << 16) | (Math.round(ag + (bg - ag) * amount) << 8) | Math.round(ab + (bb - ab) * amount);
}

function drawTerrainEdge(ctx: CanvasRenderingContext2D, edge: number, kind: TerrainKind, neighbor: TerrainKind, variant: number) {
  const [[x1, y1], [x2, y2]] = EDGE_VERTICES[edge];
  const midpointX = (x1 + x2) / 2;
  const midpointY = (y1 + y2) / 2;
  const inwardX = -Math.sign(midpointX);
  const inwardY = -Math.sign(midpointY);
  const isCoast = kind === 'water' || neighbor === 'water';
  const depth = isCoast ? 5 : 3;

  for (let step = 2; step < 31; step++) {
    const t = step / 32;
    const edgeX = W / 2 + x1 + (x2 - x1) * t;
    const edgeY = GROUND_CENTER_Y + y1 + (y2 - y1) * t;
    for (let offset = 0; offset < depth; offset++) {
      if (offset > 1 && (step + offset + variant + edge) % 3 === 0) continue;

      let color: number;
      let alpha = 0.78;
      if (kind === 'water') {
        color = offset === 0 && step % 4 < 2 ? 0xa8d3d2 : mixColor(TERRAIN_BASE.water, 0x6da3bc, 0.55);
        alpha = offset === 0 ? 0.9 : 0.72;
      } else if (neighbor === 'water') {
        color = offset < 2 ? 0xc9ad68 : mixColor(TERRAIN_BASE[kind], 0xc9ad68, 0.55);
        alpha = offset < 2 ? 0.92 : 0.68;
      } else {
        color = mixColor(TERRAIN_BASE[kind], TERRAIN_BASE[neighbor], offset < 2 ? 0.52 : 0.34);
        alpha = offset < 2 ? 0.82 : 0.58;
      }

      ctx.fillStyle = css(color, alpha);
      ctx.fillRect(Math.round(edgeX + inwardX * offset), Math.round(edgeY + inwardY * Math.ceil(offset / 2)), 2, 2);
    }
  }
}

function transitionTexture(kind: TerrainKind, neighbors: TerrainNeighbors, variant: number): Texture | null {
  if (kind === 'fog' || neighbors.every((neighbor) => neighbor === null || neighbor === 'fog' || neighbor === kind)) return null;
  const key = `${kind}:${variant}:${neighbors.map((neighbor) => neighbor ?? '-').join(',')}`;
  const cached = transitionCache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = GROUND_HEIGHT;
  const ctx = canvas.getContext('2d')!;
  for (let edge = 0; edge < neighbors.length; edge++) {
    const neighbor = neighbors[edge];
    if (neighbor && neighbor !== 'fog' && neighbor !== kind) drawTerrainEdge(ctx, edge, kind, neighbor, variant);
  }
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'nearest';
  transitionCache.set(key, texture);
  return texture;
}

export function getTerrainTransitionSprite(kind: TerrainKind, neighbors: TerrainNeighbors, col: number, row: number): Sprite | null {
  const variant = (tileHash(col, row) >>> 0) % TERRAIN_VARIANTS[kind];
  const texture = transitionTexture(kind, neighbors, variant);
  if (!texture) return null;
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  return sprite;
}

export function getStructureSprite(kind: StructureKind): Sprite {
  const sprite = new Sprite(structureTexture(kind));
  const headroom = STRUCTURE_HEADROOM[kind];
  sprite.anchor.set(0.5, (PAD + headroom + HH) / (TH + headroom + PAD * 2));
  return sprite;
}
