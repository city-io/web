import { Assets, Sprite, Texture, type Spritesheet } from 'pixi.js';
import { HW, HH, TH } from './iso';
import { tileHash, varyColor } from './colors';

export type TerrainKind = 'grassland' | 'plains' | 'forest' | 'hills' | 'mountains' | 'desert' | 'marsh' | 'water' | 'fog';
export type StructureKind = 'house' | 'farm' | 'mine' | 'barracks' | 'city_center' | 'town_center';

const PAD = 2;
const W = 2 * HW + PAD * 2;

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
  grassland: 5,
  plains: 5,
  forest: 5,
  hills: 4,
  mountains: 4,
  desert: 5,
  marsh: 5,
  water: 5,
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

function drawFlatGround(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: number, gridColor = 'rgba(20,25,17,0.58)') {
  diamondPath(ctx, cx, cy);
  ctx.fillStyle = css(color);
  ctx.fill();
  diamondPath(ctx, cx, cy);
  ctx.lineWidth = 1;
  ctx.strokeStyle = gridColor;
  ctx.stroke();
}

function drawGrass(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number, sparse = false) {
  ctx.save();
  clipDiamond(ctx, cx, cy);
  const rng = mulberry32(seed + 11);
  const count = sparse ? 13 : 26;
  for (let i = 0; i < count; i++) {
    const x = cx + (rng() - 0.5) * 52;
    const y = cy + (rng() - 0.5) * 20;
    ctx.strokeStyle = sparse ? `rgba(91,82,31,${0.25 + rng() * 0.25})` : `rgba(30,91,29,${0.25 + rng() * 0.35})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x), Math.round(y));
    ctx.lineTo(Math.round(x + (rng() > 0.5 ? 1 : -1)), Math.round(y - 2 - rng() * 2));
    ctx.stroke();
  }
  ctx.restore();
}

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, color: number) {
  ctx.fillStyle = 'rgba(35,31,18,0.85)';
  ctx.fillRect(Math.round(x - scale), Math.round(y), Math.max(1, Math.round(scale * 2)), Math.max(2, Math.round(scale * 4)));
  ctx.fillStyle = css(color);
  ctx.beginPath();
  ctx.moveTo(x, y - scale * 10);
  ctx.lineTo(x + scale * 5, y + scale);
  ctx.lineTo(x - scale * 5, y + scale);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(180,205,105,0.28)';
  ctx.beginPath();
  ctx.moveTo(x - scale, y - scale * 9);
  ctx.lineTo(x + scale * 2, y - scale * 2);
  ctx.lineTo(x - scale * 3, y - scale * 2);
  ctx.closePath();
  ctx.fill();
}

function drawForest(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number) {
  const rng = mulberry32(seed + 101);
  const trees = Array.from({ length: 8 }, () => ({
    x: cx + (rng() - 0.5) * 40,
    y: cy - 1 + (rng() - 0.5) * 14,
    scale: 0.65 + rng() * 0.35,
    color: rng() > 0.35 ? 0x285f2d : 0x376f34
  })).sort((a, b) => a.y - b.y);
  for (const tree of trees) drawTree(ctx, tree.x, tree.y, tree.scale, tree.color);
}

function drawHills(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number) {
  const rng = mulberry32(seed + 211);
  for (const [dx, dy, width, height] of [
    [-13, 3, 18, 8],
    [5, 3, 22, 10]
  ] as const) {
    ctx.fillStyle = rng() > 0.5 ? '#77734a' : '#6d7650';
    ctx.beginPath();
    ctx.moveTo(cx + dx - width / 2, cy + dy + 4);
    ctx.lineTo(cx + dx, cy + dy - height);
    ctx.lineTo(cx + dx + width / 2, cy + dy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(224,213,155,0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + dx - width / 2, cy + dy + 4);
    ctx.lineTo(cx + dx, cy + dy - height);
    ctx.stroke();
  }
}

function drawMountains(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number) {
  const rng = mulberry32(seed + 307);
  for (const [dx, width, height] of [
    [-12, 24, 25],
    [9, 29, 31]
  ] as const) {
    const peakY = cy + 7 - height;
    ctx.fillStyle = rng() > 0.5 ? '#8d8d7c' : '#7d806f';
    ctx.beginPath();
    ctx.moveTo(cx + dx - width / 2, cy + 8);
    ctx.lineTo(cx + dx, peakY);
    ctx.lineTo(cx + dx + width / 2, cy + 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(48,50,43,0.32)';
    ctx.beginPath();
    ctx.moveTo(cx + dx, peakY);
    ctx.lineTo(cx + dx + width / 2, cy + 8);
    ctx.lineTo(cx + dx + 3, cy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#dedbc9';
    ctx.beginPath();
    ctx.moveTo(cx + dx, peakY);
    ctx.lineTo(cx + dx + 5, peakY + 8);
    ctx.lineTo(cx + dx + 1, peakY + 6);
    ctx.lineTo(cx + dx - 4, peakY + 10);
    ctx.lineTo(cx + dx - 6, peakY + 7);
    ctx.closePath();
    ctx.fill();
  }
}

function drawDesert(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number) {
  ctx.save();
  clipDiamond(ctx, cx, cy);
  const rng = mulberry32(seed + 401);
  for (let i = 0; i < 4; i++) {
    const x = cx - 22 + i * 14 + rng() * 4;
    const y = cy - 5 + rng() * 12;
    ctx.strokeStyle = 'rgba(105,67,28,0.42)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 8, Math.PI * 1.1, Math.PI * 1.8);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMarsh(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number) {
  ctx.save();
  clipDiamond(ctx, cx, cy);
  const rng = mulberry32(seed + 503);
  ctx.fillStyle = 'rgba(37,78,78,0.55)';
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.ellipse(cx + (rng() - 0.5) * 42, cy + (rng() - 0.5) * 15, 4 + rng() * 5, 1.5 + rng() * 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(36,64,29,0.8)';
  for (let i = 0; i < 11; i++) {
    const x = cx + (rng() - 0.5) * 48;
    const y = cy + (rng() - 0.5) * 18;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 2, y - 4 - rng() * 4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWater(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number) {
  ctx.save();
  clipDiamond(ctx, cx, cy);
  const rng = mulberry32(seed + 601);
  ctx.strokeStyle = 'rgba(142,193,219,0.48)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const x = cx - 24 + rng() * 42;
    const y = cy - 8 + rng() * 16;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 7, y + 1);
    ctx.stroke();
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
    drawFlatGround(ctx, cx, cy, TERRAIN_BASE.fog, 'rgba(0,0,0,0)');
    return canvas;
  }

  drawFlatGround(ctx, cx, cy, varyColor(TERRAIN_BASE[kind], variant, variant * 3, 5), kind === 'water' ? 'rgba(13,37,74,0.72)' : 'rgba(20,25,17,0.58)');
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

let sheet: Spritesheet | null = null;
const terrainCache = new Map<string, Texture>();
const structureCache = new Map<string, Texture>();

export async function initSprites(): Promise<void> {
  try {
    const response = await fetch('/sprites/tiles.json', { method: 'HEAD' });
    if (response.ok) {
      sheet = (await Assets.load('/sprites/tiles.json')) as Spritesheet;
      sheet.textureSource.scaleMode = 'nearest';
    }
  } catch {
    // The procedural atlas is the built-in fallback.
  }
}

function terrainTexture(kind: TerrainKind, variant: number): Texture {
  const key = `${kind}:${variant}`;
  const cached = terrainCache.get(key);
  if (cached) return cached;
  const frame = sheet?.textures[`terrain_${kind}_${variant}`] ?? sheet?.textures[`terrain_${kind}`];
  const texture = frame ?? Texture.from(renderTerrain(kind, variant));
  texture.source.scaleMode = 'nearest';
  terrainCache.set(key, texture);
  return texture;
}

function structureTexture(kind: StructureKind): Texture {
  const cached = structureCache.get(kind);
  if (cached) return cached;
  const frame = sheet?.textures[`structure_${kind}`] ?? sheet?.textures[kind];
  const texture = frame ?? Texture.from(renderStructure(kind));
  texture.source.scaleMode = 'nearest';
  structureCache.set(kind, texture);
  return texture;
}

export function getTerrainSprite(kind: TerrainKind, col: number, row: number): Sprite {
  const variant = (tileHash(col, row) >>> 0) % TERRAIN_VARIANTS[kind];
  const sprite = new Sprite(terrainTexture(kind, variant));
  const headroom = TERRAIN_HEADROOM[kind];
  sprite.anchor.set(0.5, (PAD + headroom + HH) / (TH + headroom + PAD * 2));
  return sprite;
}

export function getStructureSprite(kind: StructureKind): Sprite {
  const sprite = new Sprite(structureTexture(kind));
  const headroom = STRUCTURE_HEADROOM[kind];
  sprite.anchor.set(0.5, (PAD + headroom + HH) / (TH + headroom + PAD * 2));
  return sprite;
}
