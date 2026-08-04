import { Texture } from 'pixi.js';
import { S } from '../hex';
import { mulberry32, hash2 } from '../world/rng';
import { Feature, Relief, Special, Terrain } from '../world';
import { CX, CY, DEPTH, TEX_W, clipTop, css, drawBevel, drawOutline, drawSides, drawTop, edgeMid, hexPath, newCanvas, vert, type RGB } from './geometry';

interface GroundStyle {
  top: number;
  cliff: readonly [RGB, RGB, RGB];
  variants: number;
  water?: boolean;
  detail?: (ctx: CanvasRenderingContext2D, rng: () => number) => void;
}

// Hand-picked cliff palettes, ordered [lit, center, shadow] for a NW light.
const EARTH: readonly [RGB, RGB, RGB] = [
  [145, 120, 80],
  [110, 90, 62],
  [82, 68, 48]
];
const SEA_CLIFF: readonly [RGB, RGB, RGB] = [
  [40, 70, 100],
  [30, 55, 80],
  [22, 42, 62]
];
const SAND_CLIFF: readonly [RGB, RGB, RGB] = [
  [186, 158, 104],
  [148, 124, 80],
  [112, 92, 60]
];
const COLD_CLIFF: readonly [RGB, RGB, RGB] = [
  [110, 108, 92],
  [86, 84, 72],
  [64, 62, 54]
];
const ICE_CLIFF: readonly [RGB, RGB, RGB] = [
  [176, 190, 204],
  [140, 154, 168],
  [106, 118, 132]
];

function grassDetail(ctx: CanvasRenderingContext2D, rng: () => number, count = 40, hueLo = 65, hueHi = 120) {
  ctx.save();
  clipTop(ctx, S * 0.93);
  for (let i = 0; i < count; i++) {
    const x = CX + (rng() - 0.5) * S * 1.6;
    const y = CY + (rng() - 0.5) * 22;
    const len = 3 + rng() * 5;
    const angle = -Math.PI / 2 + (rng() - 0.5) * 0.7;
    const green = hueLo + Math.floor(rng() * (hueHi - hueLo));
    ctx.strokeStyle = `rgba(28,${green},22,${0.25 + rng() * 0.3})`;
    ctx.lineWidth = 0.7 + rng() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }
  ctx.restore();
}

function speckle(ctx: CanvasRenderingContext2D, rng: () => number, count: number, color: string, rMin = 0.6, rMax = 1.6) {
  ctx.save();
  clipTop(ctx, S * 0.92);
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const x = CX + (rng() - 0.5) * S * 1.65;
    const y = CY + (rng() - 0.5) * 23;
    ctx.beginPath();
    ctx.arc(x, y, rMin + rng() * (rMax - rMin), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function duneDetail(ctx: CanvasRenderingContext2D, rng: () => number) {
  ctx.save();
  clipTop(ctx, S * 0.92);
  for (let i = 0; i < 7; i++) {
    const x = CX + (rng() - 0.5) * S * 1.4;
    const y = CY + (rng() - 0.5) * 20;
    const w = 8 + rng() * 16;
    ctx.strokeStyle = `rgba(150,120,70,${0.18 + rng() * 0.18})`;
    ctx.lineWidth = 1 + rng();
    ctx.beginPath();
    ctx.ellipse(x, y, w, 2.5 + rng() * 2, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  speckle(ctx, rng, 10, 'rgba(120,96,56,0.35)', 0.5, 1.1);
}

function waveDetail(ctx: CanvasRenderingContext2D, rng: () => number, alpha: number) {
  ctx.save();
  clipTop(ctx, S * 0.9);
  ctx.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const x = CX + (rng() - 0.5) * S * 1.5;
    const y = CY + (rng() - 0.5) * 21;
    const w = 5 + rng() * 9;
    ctx.strokeStyle = `rgba(210,235,255,${alpha * (0.35 + rng() * 0.5)})`;
    ctx.lineWidth = 0.8 + rng() * 0.7;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.quadraticCurveTo(x, y - 2.2, x + w / 2, y);
    ctx.stroke();
  }
  ctx.restore();
}

const GROUND: Record<number, GroundStyle> = {
  [Terrain.DEEP_OCEAN]: { top: 0x123048, cliff: SEA_CLIFF, variants: 2, water: true, detail: (c, r) => waveDetail(c, r, 0.35) },
  [Terrain.OCEAN]: { top: 0x1b4368, cliff: SEA_CLIFF, variants: 2, water: true, detail: (c, r) => waveDetail(c, r, 0.55) },
  [Terrain.COAST]: { top: 0x2f7ba0, cliff: SEA_CLIFF, variants: 2, water: true, detail: (c, r) => waveDetail(c, r, 0.8) },
  [Terrain.LAKE]: { top: 0x2c7686, cliff: SEA_CLIFF, variants: 2, water: true, detail: (c, r) => waveDetail(c, r, 0.7) },
  [Terrain.BEACH]: { top: 0xd8c894, cliff: SAND_CLIFF, variants: 2, detail: (c, r) => speckle(c, r, 26, 'rgba(160,138,92,0.4)') },
  [Terrain.GRASSLAND]: { top: 0x4a7a50, cliff: EARTH, variants: 4, detail: (c, r) => grassDetail(c, r) },
  [Terrain.PLAINS]: { top: 0x7d8a4a, cliff: EARTH, variants: 3, detail: (c, r) => grassDetail(c, r, 22, 90, 140) },
  [Terrain.DESERT]: { top: 0xc2a860, cliff: SAND_CLIFF, variants: 3, detail: duneDetail },
  [Terrain.TUNDRA]: { top: 0x6e7566, cliff: COLD_CLIFF, variants: 3, detail: (c, r) => speckle(c, r, 24, 'rgba(150,160,140,0.32)') },
  [Terrain.SNOW]: { top: 0xdde6ec, cliff: ICE_CLIFF, variants: 2, detail: (c, r) => speckle(c, r, 18, 'rgba(255,255,255,0.75)', 0.5, 1.2) }
};

function renderGround(t: Terrain, variant: number): HTMLCanvasElement {
  const ctx = newCanvas();
  const style = GROUND[t];
  const rng = mulberry32(variant * 7919 + t * 131 + 42);

  drawSides(ctx, style.cliff, style.water ? DEPTH * 0.55 : DEPTH);
  drawTop(ctx, style.top);
  style.detail?.(ctx, rng);
  if (!style.water) drawBevel(ctx);
  drawOutline(ctx, style.top, style.water ? 0.25 : 0.4);
  return ctx.canvas;
}

// ── relief overlays ──────────────────────────────────────
// Drawn with partial alpha so the ground beneath tints them: hills on desert
// read as sand dunes, hills on grassland as green downs, with no extra art.

const HILL_VARIANTS = 6;

function renderHills(variant: number): HTMLCanvasElement {
  const ctx = newCanvas();
  const rng = mulberry32(variant * 5171 + 7);
  ctx.save();
  clipTop(ctx, S * 0.97);
  // Fully randomised lobe placement per variant. Fixed positions with a small
  // jitter made hill country tile into visible wallpaper across a region.
  const count = 3 + Math.floor(rng() * 2);
  const lobes: [number, number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    lobes.push([CX + (rng() - 0.5) * S * 1.35, CY + (rng() - 0.5) * 20, 12 + rng() * 10, 7 + rng() * 5]);
  }
  // Back to front, so nearer mounds overlap the ones behind them.
  lobes.sort((a, b) => a[1] - b[1]);
  for (const [x, y, rx, ry] of lobes) {
    const g = ctx.createLinearGradient(x - rx, y - ry, x + rx, y + ry);
    g.addColorStop(0, 'rgba(255,255,240,0.32)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.04)');
    g.addColorStop(1, 'rgba(20,14,4,0.32)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,22,8,0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
  return ctx.canvas;
}

function renderMountains(variant: number, snowcap: boolean): HTMLCanvasElement {
  const ctx = newCanvas();
  const rng = mulberry32(variant * 3313 + (snowcap ? 91 : 17));
  const peaks: [number, number, number][] = [
    [CX - 15, 20 + rng() * 5, 15],
    [CX + 14, 17 + rng() * 5, 13],
    [CX - 1, 30 + rng() * 7, 20]
  ];
  // Far peaks first so the tall centre peak overlaps them.
  peaks.sort((a, b) => a[1] - b[1]);
  for (const [x, hgt, halfW] of peaks) {
    const baseY = CY + 8;
    const apexY = baseY - hgt;
    ctx.beginPath();
    ctx.moveTo(x - halfW, baseY);
    ctx.lineTo(x, apexY);
    ctx.lineTo(x + halfW, baseY);
    ctx.closePath();
    const g = ctx.createLinearGradient(x - halfW, apexY, x + halfW, baseY);
    g.addColorStop(0, '#9aa0a6');
    g.addColorStop(0.45, '#767c84');
    g.addColorStop(1, '#4c525a');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,34,40,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (snowcap && hgt > 20) {
      const capY = apexY + hgt * 0.32;
      const capW = halfW * 0.32;
      ctx.beginPath();
      ctx.moveTo(x - capW, capY);
      ctx.lineTo(x, apexY);
      ctx.lineTo(x + capW, capY);
      ctx.lineTo(x + capW * 0.4, capY + 2.5);
      ctx.lineTo(x - capW * 0.35, capY + 1.5);
      ctx.closePath();
      ctx.fillStyle = 'rgba(245,250,255,0.92)';
      ctx.fill();
    }
  }
  return ctx.canvas;
}

// ── feature overlays ─────────────────────────────────────

function renderForest(variant: number, boreal: boolean): HTMLCanvasElement {
  const ctx = newCanvas();
  const rng = mulberry32(variant * 6113 + (boreal ? 5 : 71));
  ctx.save();
  clipTop(ctx, S * 0.95);
  const n = 7 + Math.floor(rng() * 3);
  const trees: [number, number][] = [];
  for (let i = 0; i < n; i++) trees.push([CX + (rng() - 0.5) * S * 1.5, CY + (rng() - 0.5) * 20]);
  trees.sort((a, b) => a[1] - b[1]);
  for (const [x, y] of trees) {
    const hgt = 11 + rng() * 6;
    const wid = 5 + rng() * 2.5;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 2, wid * 0.8, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a3222';
    ctx.fillRect(x - 0.9, y - 2, 1.8, 4);
    // Two stacked conifer skirts read as a tree at this size.
    const dark = boreal ? '#1f3d2c' : '#24502c';
    const lit = boreal ? '#356248' : '#3d7a45';
    for (const [dy, sc] of [
      [0, 1],
      [-hgt * 0.42, 0.72]
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(x - wid * sc, y - 1 + dy);
      ctx.lineTo(x, y - hgt + dy);
      ctx.lineTo(x + wid * sc, y - 1 + dy);
      ctx.closePath();
      const g = ctx.createLinearGradient(x - wid, y - hgt + dy, x + wid, y + dy);
      g.addColorStop(0, lit);
      g.addColorStop(1, dark);
      ctx.fillStyle = g;
      ctx.fill();
    }
  }
  ctx.restore();
  return ctx.canvas;
}

function renderJungle(variant: number): HTMLCanvasElement {
  const ctx = newCanvas();
  const rng = mulberry32(variant * 4271 + 23);
  ctx.save();
  clipTop(ctx, S * 0.95);
  for (let i = 0; i < 13; i++) {
    const x = CX + (rng() - 0.5) * S * 1.55;
    const y = CY + (rng() - 0.5) * 22;
    const r = 5 + rng() * 4.5;
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, 0, x, y, r);
    g.addColorStop(0, 'rgba(96,170,80,0.95)');
    g.addColorStop(1, 'rgba(28,86,42,0.95)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 5; i++) {
    const x = CX + (rng() - 0.5) * S * 1.3;
    const y = CY + (rng() - 0.5) * 16;
    ctx.strokeStyle = 'rgba(180,210,110,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 3, y + 5, x + 1, y + 9);
    ctx.stroke();
  }
  ctx.restore();
  return ctx.canvas;
}

function renderMarsh(): HTMLCanvasElement {
  const ctx = newCanvas();
  const rng = mulberry32(881);
  ctx.save();
  clipTop(ctx, S * 0.93);
  for (let i = 0; i < 6; i++) {
    const x = CX + (rng() - 0.5) * S * 1.4;
    const y = CY + (rng() - 0.5) * 18;
    ctx.fillStyle = 'rgba(70,110,120,0.5)';
    ctx.beginPath();
    ctx.ellipse(x, y, 6 + rng() * 5, 2.5 + rng() * 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 16; i++) {
    const x = CX + (rng() - 0.5) * S * 1.5;
    const y = CY + (rng() - 0.5) * 20;
    ctx.strokeStyle = `rgba(110,130,70,${0.45 + rng() * 0.3})`;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 2, y - 5 - rng() * 4);
    ctx.stroke();
  }
  ctx.restore();
  return ctx.canvas;
}

function renderOasis(): HTMLCanvasElement {
  const ctx = newCanvas();
  ctx.save();
  clipTop(ctx, S * 0.9);
  ctx.fillStyle = 'rgba(46,132,148,0.9)';
  ctx.beginPath();
  ctx.ellipse(CX, CY + 4, 13, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,180,120,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  for (const dx of [-9, 6]) {
    ctx.strokeStyle = '#5a4326';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(CX + dx, CY + 1);
    ctx.quadraticCurveTo(CX + dx - 1, CY - 7, CX + dx + 2, CY - 12);
    ctx.stroke();
    ctx.fillStyle = '#3f7f38';
    for (const a of [-0.9, -0.3, 0.4, 1.0]) {
      ctx.beginPath();
      ctx.ellipse(CX + dx + 2, CY - 12, 6, 2, a, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  return ctx.canvas;
}

function renderIce(): HTMLCanvasElement {
  const ctx = newCanvas();
  const rng = mulberry32(3607);
  ctx.save();
  clipTop(ctx, S * 0.97);
  hexPath(ctx, S * 0.97);
  ctx.fillStyle = 'rgba(232,244,250,0.88)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(150,180,200,0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    const x = CX + (rng() - 0.5) * S * 1.5;
    const y = CY + (rng() - 0.5) * 20;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 18, y + (rng() - 0.5) * 10);
    ctx.stroke();
  }
  ctx.restore();
  return ctx.canvas;
}

// ── rivers ───────────────────────────────────────────────

/**
 * A river tile draws a stroke from its center out to the midpoint of each edge
 * it links across. The neighbor on the far side carries the reciprocal bit and
 * draws its own half, so the two meet exactly on the shared edge with no seam
 * and no ownership rule. Rivers therefore consume no tile of their own.
 */
const RIVER_VARIANTS = 3;

function renderRiver(mask: number, variant: number): HTMLCanvasElement {
  const ctx = newCanvas();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const rng = mulberry32(mask * 7717 + variant * 131 + 5);
  const dirs: number[] = [];
  for (let d = 0; d < 6; d++) if (mask & (1 << d)) dirs.push(d);

  // Every link runs to a common off-centre point via a bowed curve. Straight
  // centre-to-edge segments made collinear steps join into one ruler-straight
  // diagonal across the map, which read as a power line rather than a river.
  // The endpoints stay exactly on the edge midpoints, so neighbouring tiles
  // still meet without a seam.
  const hx = CX + (rng() - 0.5) * 13;
  const hy = CY + (rng() - 0.5) * 7;

  for (const pass of [
    { w: 6, color: 'rgba(28,70,104,0.85)' },
    { w: 3.4, color: 'rgba(86,158,208,0.95)' }
  ]) {
    ctx.strokeStyle = pass.color;
    ctx.lineWidth = pass.w;
    for (const d of dirs) {
      const m = edgeMid(d);
      const bow = (rng() - 0.5) * 9;
      // Control point at the midpoint of the run, pushed perpendicular to it.
      const mx = (m.x + hx) / 2;
      const my = (m.y + hy) / 2;
      const dx = hx - m.x;
      const dy = hy - m.y;
      const len = Math.max(1e-3, Math.sqrt(dx * dx + dy * dy));
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.quadraticCurveTo(mx - (dy / len) * bow, my + (dx / len) * bow, hx, hy);
      ctx.stroke();
    }
    // A source or mouth is a single stub; round it off so it doesn't end flat.
    if (dirs.length === 1) {
      ctx.beginPath();
      ctx.arc(hx, hy, pass.w / 2.2, 0, Math.PI * 2);
      ctx.fillStyle = pass.color;
      ctx.fill();
    }
  }
  return ctx.canvas;
}

// ── special resources ────────────────────────────────────

function renderSpecial(kind: Special): HTMLCanvasElement {
  const ctx = newCanvas();
  const y = CY - 6;
  ctx.save();
  // A dark disc keeps every icon legible over both pale desert and dark forest.
  ctx.beginPath();
  ctx.arc(CX, y, 9.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(18,22,28,0.55)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,225,150,0.75)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  const dot = (dx: number, dy: number, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(CX + dx, y + dy, r, 0, Math.PI * 2);
    ctx.fill();
  };

  switch (kind) {
    case Special.WHEAT:
      ctx.strokeStyle = '#e8c65a';
      ctx.lineWidth = 1.4;
      for (const dx of [-3, 0, 3]) {
        ctx.beginPath();
        ctx.moveTo(CX + dx, y + 5);
        ctx.lineTo(CX + dx, y - 4);
        ctx.stroke();
        for (const dy of [-3, -1, 1]) {
          ctx.beginPath();
          ctx.moveTo(CX + dx, y + dy);
          ctx.lineTo(CX + dx + 2.5, y + dy - 2);
          ctx.stroke();
        }
      }
      break;
    case Special.GAME:
      ctx.strokeStyle = '#c8a070';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(CX - 4, y + 5);
      ctx.lineTo(CX - 4, y - 1);
      ctx.lineTo(CX - 1, y - 5);
      ctx.lineTo(CX + 2, y - 1);
      ctx.lineTo(CX + 2, y + 5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(CX - 1, y - 5);
      ctx.lineTo(CX - 4, y - 8);
      ctx.moveTo(CX - 1, y - 5);
      ctx.lineTo(CX + 3, y - 8);
      ctx.stroke();
      break;
    case Special.FURS:
      dot(0, 0, 6, '#8a6a4a');
      dot(-2, -2, 2, '#d8c0a0');
      break;
    case Special.FISH:
    case Special.WHALES: {
      const big = kind === Special.WHALES;
      ctx.fillStyle = big ? '#5a7fa8' : '#7fc0d8';
      ctx.beginPath();
      ctx.ellipse(CX, y, big ? 8 : 6, big ? 4 : 3.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(CX + (big ? 7 : 5), y);
      ctx.lineTo(CX + (big ? 11 : 9), y - 3.5);
      ctx.lineTo(CX + (big ? 11 : 9), y + 3.5);
      ctx.closePath();
      ctx.fill();
      dot(big ? -4 : -3, -1, 1, '#0e1a24');
      break;
    }
    case Special.COAL:
      dot(-3, 1, 4, '#2c2c30');
      dot(3, 2, 3.4, '#3a3a40');
      dot(0, -3, 3.2, '#242428');
      break;
    case Special.IRON:
      ctx.fillStyle = '#9aa2ac';
      ctx.beginPath();
      ctx.moveTo(CX, y - 6);
      ctx.lineTo(CX + 6, y);
      ctx.lineTo(CX, y + 6);
      ctx.lineTo(CX - 6, y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#d8dee6';
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    case Special.GOLD:
      dot(-3, 2, 3.6, '#e8c24a');
      dot(3, 2, 3.6, '#f0d268');
      dot(0, -2, 3.8, '#ffe285');
      break;
    case Special.GEMS:
      ctx.fillStyle = '#b06ad8';
      ctx.beginPath();
      ctx.moveTo(CX, y - 6);
      ctx.lineTo(CX + 5, y - 1);
      ctx.lineTo(CX, y + 6);
      ctx.lineTo(CX - 5, y - 1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#e8c0ff';
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
  }
  ctx.restore();
  return ctx.canvas;
}

function renderShroud(): HTMLCanvasElement {
  const ctx = newCanvas();
  // Unknown ground: a flat, cool fog kept deliberately unlike any terrain so
  // the edge of the charted map reads clearly. The old shroud was dark green
  // and passed for unlit grass. A faint mottle stops it looking like a dead
  // fill without suggesting anything is actually there.
  drawSides(ctx, [
    [46, 54, 64],
    [36, 43, 52],
    [26, 32, 40]
  ]);
  drawTop(ctx, 0x2b333e);
  ctx.save();
  clipTop(ctx, S * 0.95);
  const rng = mulberry32(20260804);
  for (let i = 0; i < 14; i++) {
    const x = CX + (rng() - 0.5) * S * 1.5;
    const y = CY + (rng() - 0.5) * 22;
    const r = 5 + rng() * 9;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(122,134,152,${0.05 + rng() * 0.06})`);
    g.addColorStop(1, 'rgba(122,134,152,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  drawOutline(ctx, 0x2b333e, 0.2);
  return ctx.canvas;
}

/** Representative flat color for a terrain, for the minimap. */
export function terrainColor(t: Terrain): number {
  return GROUND[t]?.top ?? 0x2b333e;
}

/** The shroud color, for painting unexplored tiles on the minimap. */
export const SHROUD_COLOR = 0x1c222b;

// ── cache ────────────────────────────────────────────────

const cache = new Map<string, Texture>();

function tex(key: string, make: () => HTMLCanvasElement): Texture {
  let t = cache.get(key);
  if (!t) {
    t = Texture.from(make());
    cache.set(key, t);
  }
  return t;
}

const variantOf = (col: number, row: number, n: number, salt: number) => (n > 1 ? (hash2(col, row, salt) >>> 0) % n : 0);

export function groundTexture(t: Terrain, col: number, row: number): Texture {
  const v = variantOf(col, row, GROUND[t].variants, 11);
  return tex(`g${t}:${v}`, () => renderGround(t, v));
}

export function reliefTexture(r: Relief, col: number, row: number, snowcap: boolean): Texture {
  if (r === Relief.HILLS) {
    const v = variantOf(col, row, HILL_VARIANTS, 29);
    return tex(`h${v}`, () => renderHills(v));
  }
  const v = variantOf(col, row, 3, 37);
  return tex(`m${v}:${snowcap ? 1 : 0}`, () => renderMountains(v, snowcap));
}

export function featureTexture(f: Feature, col: number, row: number, boreal: boolean): Texture {
  switch (f) {
    case Feature.FOREST: {
      const v = variantOf(col, row, 3, 53);
      return tex(`f${v}:${boreal ? 1 : 0}`, () => renderForest(v, boreal));
    }
    case Feature.JUNGLE: {
      const v = variantOf(col, row, 2, 59);
      return tex(`j${v}`, () => renderJungle(v));
    }
    case Feature.MARSH:
      return tex('marsh', renderMarsh);
    case Feature.OASIS:
      return tex('oasis', renderOasis);
    default:
      return tex('ice', renderIce);
  }
}

export function riverTexture(mask: number, col: number, row: number): Texture {
  // Neighbouring tiles may pick different variants; both still terminate
  // exactly on the shared edge midpoint, so the join stays seamless.
  const v = variantOf(col, row, RIVER_VARIANTS, 71);
  return tex(`r${mask}:${v}`, () => renderRiver(mask, v));
}

export function specialTexture(kind: Special): Texture {
  return tex(`s${kind}`, () => renderSpecial(kind));
}

export function shroudTexture(): Texture {
  return tex('shroud', renderShroud);
}
