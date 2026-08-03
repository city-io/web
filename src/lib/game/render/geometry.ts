import { S, HEX_H, ISO, HEX_VERTS } from '../hex';

/** Height of the extruded side faces. */
export const DEPTH = 20;

const PAD = 2;
/** Vertical room above the hex top for tall art: mountains, towers, trees. */
export const HEADROOM = 30;

export const TEX_W = Math.ceil(S * 2) + PAD * 2;
export const TEX_H = Math.ceil(HEX_H) + DEPTH + PAD * 2 + HEADROOM;
export const CX = TEX_W / 2;
export const CY = PAD + HEADROOM + Math.ceil(HEX_H / 2);

/**
 * Every layer — ground, relief, feature, river, building — uses this one
 * geometry and therefore this one anchor. Separate per-layer texture heights
 * would save about 0.4MB, but each would need its own anchor derived from its
 * own CY/TEX_H, and getting that wrong offsets a layer by ~26px while still
 * looking almost right. Worse, hit-testing is pure math (`pixelToHex`), so it
 * stays correct only while a sprite's position is exactly hexToPixel(col,row):
 * anyone "fixing" such an offset by nudging sprite.y would silently desync
 * clicks from what's drawn. One geometry makes that unrepresentable.
 */
export const ANCHOR_X = CX / TEX_W;
export const ANCHOR_Y = CY / TEX_H;

export type RGB = readonly [number, number, number];

/** Vertex i of a hex of the given radius, in texture space. */
export function vert(i: number, s = S) {
  const a = (Math.PI / 3) * i;
  return { x: CX + s * Math.cos(a), y: CY + s * Math.sin(a) * ISO };
}

export function hexPath(ctx: CanvasRenderingContext2D, s = S) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const { x, y } = vert(i, s);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Midpoint of the edge shared with neighbor `dir`, in texture space. */
export function edgeMid(dir: number) {
  const a = vert(dir);
  const b = vert((dir + 1) % 6);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function newCanvas(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  return canvas.getContext('2d')!;
}

export const rgbOf = (hex: number): RGB => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
export const css = (c: RGB, a = 1) => (a === 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
export const scale = (c: RGB, f: number): RGB => [Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f)];

/** Three extruded lower faces, lit from the north-west. */
export function drawSides(ctx: CanvasRenderingContext2D, pal: readonly [RGB, RGB, RGB], depth = DEPTH) {
  const faces: [number, number, number][] = [
    [0, 1, 2],
    [1, 2, 1],
    [2, 3, 0]
  ];
  for (const [a, b, pi] of faces) {
    const c = pal[pi];
    const va = vert(a);
    const vb = vert(b);
    const grad = ctx.createLinearGradient(0, Math.min(va.y, vb.y), 0, Math.max(va.y, vb.y) + depth);
    grad.addColorStop(0, css(c));
    grad.addColorStop(1, css(scale(c, 0.65)));
    ctx.beginPath();
    ctx.moveTo(va.x, va.y);
    ctx.lineTo(vb.x, vb.y);
    ctx.lineTo(vb.x, vb.y + depth);
    ctx.lineTo(va.x, va.y + depth);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 1;
  for (const idx of [1, 2]) {
    const v = vert(idx);
    ctx.beginPath();
    ctx.moveTo(v.x, v.y);
    ctx.lineTo(v.x, v.y + depth);
    ctx.stroke();
  }
}

export function drawTop(ctx: CanvasRenderingContext2D, color: number) {
  const [r, g, b] = rgbOf(color);
  hexPath(ctx);
  const grad = ctx.createRadialGradient(CX - 10, CY - 6, 0, CX, CY, S);
  grad.addColorStop(0, `rgb(${Math.min(255, r + 20)},${Math.min(255, g + 20)},${Math.min(255, b + 20)})`);
  grad.addColorStop(1, `rgb(${r},${g},${b})`);
  ctx.fillStyle = grad;
  ctx.fill();
}

export function drawBevel(ctx: CanvasRenderingContext2D) {
  const v = (i: number) => vert(i);
  ctx.beginPath();
  ctx.moveTo(v(3).x, v(3).y);
  ctx.lineTo(v(4).x, v(4).y);
  ctx.lineTo(v(5).x, v(5).y);
  ctx.lineTo(v(0).x, v(0).y);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(v(0).x, v(0).y);
  ctx.lineTo(v(1).x, v(1).y);
  ctx.lineTo(v(2).x, v(2).y);
  ctx.lineTo(v(3).x, v(3).y);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function drawOutline(ctx: CanvasRenderingContext2D, color: number, alpha = 0.4) {
  const [r, g, b] = rgbOf(color);
  hexPath(ctx);
  ctx.strokeStyle = `rgba(${r * 0.5},${g * 0.5},${b * 0.5},${alpha})`;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Clip subsequent drawing to the hex top face. */
export function clipTop(ctx: CanvasRenderingContext2D, s = S * 0.95) {
  hexPath(ctx, s);
  ctx.clip();
}
