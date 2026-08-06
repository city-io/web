import { Assets, Sprite, Texture, type Spritesheet } from 'pixi.js';
import { HW, HH, TH } from './iso';
import { tileHash } from './colors';

/**
 * Isometric tile + building sprites, Civ2 pixel-art style.
 *
 * The renderer is procedural (Canvas2D) so the map ALWAYS renders with no
 * external art dependency. `initSprites()` will transparently prefer a CC0
 * spritesheet atlas if one is dropped at `/sprites/tiles.json`, otherwise it
 * falls back to the procedural diamonds below.
 */

export type TileKind = 'grass' | 'fog' | 'city' | 'house' | 'farm' | 'mine' | 'barracks' | 'city_center' | 'town_center';

// ── geometry ─────────────────────────────────────────
const PAD = 2;
const DEPTH = 6; // south-face extrusion for the raised-tile look
const W = 2 * HW + PAD * 2; // 68
const FLAT_H = TH + DEPTH + PAD * 2; // 42

// Per-kind headroom above the base diamond for tall structures.
const HEADROOM: Record<TileKind, number> = {
  grass: 0,
  fog: 0,
  city: 0,
  farm: 0,
  mine: 12,
  house: 22,
  barracks: 26,
  town_center: 30,
  city_center: 40
};

// Base terrain color under each kind (buildings sit on claimed dirt).
const BASE: Record<TileKind, number> = {
  grass: 0x5f8a3c,
  fog: 0x24241d,
  city: 0x7c7a44,
  farm: 0x8a6a2e,
  mine: 0x6b5a48,
  house: 0x7c7a44,
  barracks: 0x7c7a44,
  town_center: 0x7c7a44,
  city_center: 0x7c7a44
};

const VARIANTS: Partial<Record<TileKind, number>> = { grass: 4, city: 2 };

// Per-kind sprite anchor + variant count. anchorY places the base-diamond
// center on the tile; tall sprites anchor near the bottom, terrain mid-diamond.
export interface SpriteMeta {
  anchorX: number;
  anchorY: number;
  variants: number;
}
export const SPRITE_META: Record<TileKind, SpriteMeta> = Object.fromEntries(
  (Object.keys(BASE) as TileKind[]).map((k) => {
    const head = HEADROOM[k];
    const h = FLAT_H + head;
    const cy = PAD + head + HH; // base diamond center Y
    return [k, { anchorX: 0.5, anchorY: cy / h, variants: VARIANTS[k] ?? 1 }];
  })
) as Record<TileKind, SpriteMeta>;

// ── canvas helpers ───────────────────────────────────
const rgb = (hex: number): [number, number, number] => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
const css = (c: number, a = 1) => {
  const [r, g, b] = rgb(c);
  return `rgba(${r},${g},${b},${a})`;
};

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function diamondPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, hw = HW, hh = HH) {
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
}

// Raised ground diamond: south extrusion faces + top fill + bevel edges.
function drawGround(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: number, fog: boolean) {
  const [r, g, b] = rgb(color);
  // South-east + south-west extrusion (darker earthy cliff).
  const cliff = fog ? 0x1a1a14 : 0x5a4a30;
  ctx.fillStyle = css(cliff, 1);
  ctx.beginPath();
  ctx.moveTo(cx - HW, cy);
  ctx.lineTo(cx, cy + HH);
  ctx.lineTo(cx + HW, cy);
  ctx.lineTo(cx + HW, cy + DEPTH);
  ctx.lineTo(cx, cy + HH + DEPTH);
  ctx.lineTo(cx - HW, cy + DEPTH);
  ctx.closePath();
  ctx.fill();

  // Top face with a soft NW-lit radial gradient.
  diamondPath(ctx, cx, cy);
  const grad = ctx.createRadialGradient(cx - 8, cy - 5, 0, cx, cy, HW);
  grad.addColorStop(0, `rgb(${Math.min(255, r + 22)},${Math.min(255, g + 22)},${Math.min(255, b + 18)})`);
  grad.addColorStop(1, `rgb(${r},${g},${b})`);
  ctx.fillStyle = grad;
  ctx.fill();

  // Bevel: bright NW edges, dark SE edges.
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,241,214,0.28)';
  ctx.beginPath();
  ctx.moveTo(cx - HW, cy);
  ctx.lineTo(cx, cy - HH);
  ctx.lineTo(cx + HW, cy);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.moveTo(cx + HW, cy);
  ctx.lineTo(cx, cy + HH);
  ctx.lineTo(cx - HW, cy);
  ctx.stroke();
}

function clipDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, scale = 0.96) {
  diamondPath(ctx, cx, cy, HW * scale, HH * scale);
  ctx.clip();
}

// ── terrain detail ───────────────────────────────────
function drawGrass(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number) {
  ctx.save();
  clipDiamond(ctx, cx, cy);
  const rng = mulberry32(seed + 1);
  for (let i = 0; i < 34; i++) {
    const x = cx + (rng() - 0.5) * TH * 1.7;
    const y = cy + (rng() - 0.5) * TH * 0.85;
    const len = 2 + rng() * 4;
    const green = 70 + Math.floor(rng() * 60);
    ctx.strokeStyle = `rgba(34,${green},26,${0.2 + rng() * 0.3})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 1.5, y - len);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFarm(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save();
  clipDiamond(ctx, cx, cy, 0.92);
  // Tilled furrows following one diagonal of the diamond.
  for (let i = -3; i <= 3; i++) {
    const ox = i * 7;
    ctx.strokeStyle = 'rgba(60,42,18,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + ox - HW * 0.5, cy - HH * 0.5 + (ox > 0 ? 2 : 0));
    ctx.lineTo(cx + ox + HW * 0.5, cy + HH * 0.5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(200,170,60,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + ox - HW * 0.5, cy - HH * 0.5 - 1);
    ctx.lineTo(cx + ox + HW * 0.5, cy + HH * 0.5 - 1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRocks(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save();
  clipDiamond(ctx, cx, cy);
  for (const [dx, dy, r, c] of [
    [-7, 2, 6, 0x8a7c66],
    [5, 4, 5, 0x746452],
    [0, -3, 6, 0x968672]
  ] as const) {
    ctx.fillStyle = css(c);
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Ore glints.
  ctx.fillStyle = 'rgba(230,195,110,0.7)';
  for (const [dx, dy] of [
    [-3, -4],
    [4, 1],
    [-1, 3]
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── building detail (drawn rising from the tile center) ──
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
  const by = cy - 2;
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 3, 12, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c2a074';
  ctx.fillRect(cx - 9, by - 11, 18, 13);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(cx + 1, by - 11, 8, 13);
  pitchedRoof(ctx, cx, by - 11, 12, 9, 0x8b4a28);
  ctx.fillStyle = '#5a3520';
  ctx.fillRect(cx - 2, by - 4, 4, 6);
  ctx.fillStyle = 'rgba(200,225,255,0.6)';
  ctx.fillRect(cx - 7, by - 8, 3, 3);
}

function drawBarracks(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const by = cy - 2;
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 3, 14, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7a5540';
  ctx.fillRect(cx - 12, by - 13, 24, 15);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(cx + 2, by - 13, 10, 15);
  pitchedRoof(ctx, cx, by - 13, 14, 8, 0x4a2a1a);
  // Banner pole + red pennant.
  ctx.strokeStyle = '#8a7a60';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx + 9, by - 13);
  ctx.lineTo(cx + 9, by - 26);
  ctx.stroke();
  ctx.fillStyle = '#c03030';
  ctx.beginPath();
  ctx.moveTo(cx + 9, by - 26);
  ctx.lineTo(cx + 18, by - 23);
  ctx.lineTo(cx + 9, by - 20);
  ctx.closePath();
  ctx.fill();
  // Door.
  ctx.fillStyle = '#3a2518';
  ctx.fillRect(cx - 2, by - 5, 4, 7);
}

function drawTownCenter(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const by = cy - 2;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 3, 16, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#b8a883';
  ctx.fillRect(cx - 13, by - 12, 26, 14);
  ctx.fillStyle = '#8a7a5a';
  ctx.fillRect(cx - 15, by - 15, 30, 4);
  // Bell tower.
  ctx.fillStyle = '#c2b28c';
  ctx.fillRect(cx - 4, by - 28, 9, 13);
  pitchedRoof(ctx, cx, by - 28, 6, 7, 0x6a4a30);
  ctx.fillStyle = '#3a2818';
  ctx.beginPath();
  ctx.arc(cx, by - 22, 2, 0, Math.PI * 2);
  ctx.fill();
  // Columns.
  ctx.fillStyle = '#d8c8a0';
  for (const dx of [-9, -4, 4, 9]) ctx.fillRect(cx + dx - 1, by - 12, 2, 14);
  ctx.fillStyle = '#4a3020';
  ctx.fillRect(cx - 3, by - 5, 6, 7);
}

function drawCityCenter(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const by = cy - 2;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + 4, 18, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Curtain wall.
  ctx.fillStyle = '#a89e88';
  ctx.fillRect(cx - 17, by - 12, 34, 14);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(cx + 1, by - 12, 16, 14);
  // Crenellations.
  ctx.fillStyle = '#b8ae96';
  for (let x = cx - 17; x < cx + 16; x += 6) ctx.fillRect(x, by - 15, 4, 4);
  // Flanking towers.
  for (const dx of [-17, 9]) {
    ctx.fillStyle = '#b0a688';
    ctx.fillRect(cx + dx, by - 18, 8, 20);
    pitchedRoof(ctx, cx + dx + 4, by - 18, 6, 7, 0x6a4030);
  }
  // Central keep.
  ctx.fillStyle = '#c0b696';
  ctx.fillRect(cx - 8, by - 26, 16, 18);
  pitchedRoof(ctx, cx, by - 26, 11, 9, 0x6a4030);
  // Flag.
  ctx.strokeStyle = '#8a7a60';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, by - 35);
  ctx.lineTo(cx, by - 44);
  ctx.stroke();
  ctx.fillStyle = '#c03030';
  ctx.beginPath();
  ctx.moveTo(cx, by - 44);
  ctx.lineTo(cx + 9, by - 41);
  ctx.lineTo(cx, by - 38);
  ctx.closePath();
  ctx.fill();
  // Gate.
  ctx.fillStyle = '#3a2518';
  ctx.beginPath();
  ctx.arc(cx, by - 4, 4, Math.PI, 0);
  ctx.lineTo(cx + 4, by + 2);
  ctx.lineTo(cx - 4, by + 2);
  ctx.closePath();
  ctx.fill();
}

// ── texture generation ───────────────────────────────
function render(kind: TileKind, variantSeed: number): HTMLCanvasElement {
  const head = HEADROOM[kind];
  const h = FLAT_H + head;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const cx = W / 2;
  const cy = PAD + head + HH;
  const fog = kind === 'fog';

  drawGround(ctx, cx, cy, BASE[kind], fog);
  if (fog) return canvas;

  switch (kind) {
    case 'grass':
    case 'city':
      drawGrass(ctx, cx, cy, variantSeed);
      break;
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

// ── public API ───────────────────────────────────────
let sheet: Spritesheet | null = null;
const cache = new Map<string, Texture>();

/**
 * Prepare sprite assets. Prefers a CC0 atlas at `/sprites/tiles.json` if
 * present (nearest-neighbour), otherwise uses the procedural fallback. Safe to
 * call once before the first render.
 */
export async function initSprites(): Promise<void> {
  try {
    const res = await fetch('/sprites/tiles.json', { method: 'HEAD' });
    if (res.ok) {
      sheet = (await Assets.load('/sprites/tiles.json')) as Spritesheet;
      sheet.textureSource.scaleMode = 'nearest';
    }
  } catch {
    /* procedural fallback — no atlas shipped */
  }
}

function textureFor(kind: TileKind, variant: number): Texture {
  const key = `${kind}:${variant}`;
  let tex = cache.get(key);
  if (tex) return tex;
  // Prefer an atlas frame when available (named `kind` or `kind_variant`).
  const frame = sheet?.textures[`${kind}_${variant}`] ?? sheet?.textures[kind];
  tex = frame ?? Texture.from(render(kind, variant * 7919 + 42));
  cache.set(key, tex);
  return tex;
}

/** Build a positioned Sprite for a tile, with the right variant + anchor. */
export function getTileSprite(kind: TileKind, col: number, row: number): Sprite {
  const meta = SPRITE_META[kind];
  const variant = meta.variants > 1 ? (tileHash(col, row) >>> 0) % meta.variants : 0;
  const spr = new Sprite(textureFor(kind, variant));
  spr.anchor.set(meta.anchorX, meta.anchorY);
  return spr;
}
