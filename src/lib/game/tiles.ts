import { Texture } from 'pixi.js';
import { S, HEX_H } from './hex';
import { tileHash } from './colors';

export const DEPTH = 10;

const PAD = 2;
const TEX_W = Math.ceil(S * 2) + PAD * 2;
const TEX_H = Math.ceil(HEX_H) + DEPTH + PAD * 2;
const CX = TEX_W / 2;
const CY = PAD + Math.ceil(HEX_H / 2);

/** Sprite anchor so the hex center aligns with the sprite position. */
export const TILE_ANCHOR_X = CX / TEX_W;
export const TILE_ANCHOR_Y = CY / TEX_H;

export type TileKind =
	| 'grass'
	| 'fog'
	| 'city'
	| 'house'
	| 'farm'
	| 'mine'
	| 'barracks'
	| 'city_center'
	| 'town_center';

// ── helpers ──────────────────────────────────────────

function vert(i: number, s = S) {
	const a = (Math.PI / 3) * i;
	return { x: CX + s * Math.cos(a), y: CY + s * Math.sin(a) };
}

function hexPath(ctx: CanvasRenderingContext2D, s = S) {
	ctx.beginPath();
	for (let i = 0; i < 6; i++) {
		const { x, y } = vert(i, s);
		i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
	}
	ctx.closePath();
}

function mulberry32(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function rgb(hex: number): [number, number, number] {
	return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

// ── drawing primitives ───────────────────────────────

function drawSides(ctx: CanvasRenderingContext2D, color: number) {
	const [r, g, b] = rgb(color);
	const faces: [number, number, number, number][] = [
		[0, 1, 0.55, 0.25],
		[1, 2, 0.4, 0.15],
		[2, 3, 0.55, 0.25]
	];
	for (const [a, bIdx, ft, fb] of faces) {
		const va = vert(a),
			vb = vert(bIdx);
		const grad = ctx.createLinearGradient(
			0,
			Math.min(va.y, vb.y),
			0,
			Math.max(va.y, vb.y) + DEPTH
		);
		grad.addColorStop(0, `rgb(${r * ft},${g * ft},${b * ft})`);
		grad.addColorStop(1, `rgb(${r * fb},${g * fb},${b * fb})`);
		ctx.beginPath();
		ctx.moveTo(va.x, va.y);
		ctx.lineTo(vb.x, vb.y);
		ctx.lineTo(vb.x, vb.y + DEPTH);
		ctx.lineTo(va.x, va.y + DEPTH);
		ctx.closePath();
		ctx.fillStyle = grad;
		ctx.fill();
	}
}

function drawTop(ctx: CanvasRenderingContext2D, color: number) {
	const [r, g, b] = rgb(color);
	hexPath(ctx);
	const grad = ctx.createRadialGradient(CX - 8, CY - 8, 0, CX, CY, S);
	grad.addColorStop(
		0,
		`rgb(${Math.min(255, r + 18)},${Math.min(255, g + 18)},${Math.min(255, b + 18)})`
	);
	grad.addColorStop(1, `rgb(${r},${g},${b})`);
	ctx.fillStyle = grad;
	ctx.fill();
}

function drawBevel(ctx: CanvasRenderingContext2D) {
	const v0 = vert(0),
		v1 = vert(1),
		v2 = vert(2),
		v3 = vert(3),
		v4 = vert(4),
		v5 = vert(5);
	ctx.beginPath();
	ctx.moveTo(v3.x, v3.y);
	ctx.lineTo(v4.x, v4.y);
	ctx.lineTo(v5.x, v5.y);
	ctx.lineTo(v0.x, v0.y);
	ctx.strokeStyle = 'rgba(255,255,255,0.22)';
	ctx.lineWidth = 2;
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(v0.x, v0.y);
	ctx.lineTo(v1.x, v1.y);
	ctx.lineTo(v2.x, v2.y);
	ctx.lineTo(v3.x, v3.y);
	ctx.strokeStyle = 'rgba(0,0,0,0.3)';
	ctx.lineWidth = 2;
	ctx.stroke();
}

function drawOutline(ctx: CanvasRenderingContext2D, color: number, alpha = 0.4) {
	const [r, g, b] = rgb(color);
	hexPath(ctx);
	ctx.strokeStyle = `rgba(${r * 0.5},${g * 0.5},${b * 0.5},${alpha})`;
	ctx.lineWidth = 1;
	ctx.stroke();
}

// ── detail renderers ─────────────────────────────────

function drawGrass(ctx: CanvasRenderingContext2D, seed: number) {
	ctx.save();
	hexPath(ctx, S * 0.93);
	ctx.clip();
	const rng = mulberry32(seed);
	for (let i = 0; i < 40; i++) {
		const x = CX + (rng() - 0.5) * S * 1.6;
		const y = CY + (rng() - 0.5) * HEX_H * 0.85;
		const len = 3 + rng() * 5;
		const angle = -Math.PI / 2 + (rng() - 0.5) * 0.7;
		const green = 65 + Math.floor(rng() * 55);
		ctx.strokeStyle = `rgba(28,${green},22,${0.25 + rng() * 0.3})`;
		ctx.lineWidth = 0.7 + rng() * 0.8;
		ctx.beginPath();
		ctx.moveTo(x, y);
		ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
		ctx.stroke();
	}
	ctx.restore();
}

function drawFarmRows(ctx: CanvasRenderingContext2D) {
	ctx.save();
	hexPath(ctx, S * 0.8);
	ctx.clip();
	for (let y = CY - 28; y < CY + 28; y += 7) {
		ctx.strokeStyle = 'rgba(100,140,40,0.3)';
		ctx.lineWidth = 1.2;
		ctx.beginPath();
		ctx.moveTo(CX - 32, y);
		ctx.lineTo(CX + 32, y);
		ctx.stroke();
		for (let x = CX - 28; x < CX + 28; x += 5) {
			ctx.strokeStyle = 'rgba(75,120,25,0.35)';
			ctx.lineWidth = 0.7;
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.lineTo(x, y - 3.5);
			ctx.stroke();
		}
	}
	ctx.restore();
}

function drawHouse(ctx: CanvasRenderingContext2D) {
	ctx.fillStyle = 'rgba(0,0,0,0.12)';
	ctx.fillRect(CX - 7, CY + 1, 16, 11);
	ctx.fillStyle = '#b8956a';
	ctx.fillRect(CX - 8, CY - 1, 16, 11);
	ctx.fillStyle = '#8b4c2a';
	ctx.beginPath();
	ctx.moveTo(CX - 11, CY - 1);
	ctx.lineTo(CX, CY - 11);
	ctx.lineTo(CX + 11, CY - 1);
	ctx.closePath();
	ctx.fill();
	ctx.fillStyle = '#5a3520';
	ctx.fillRect(CX - 2, CY + 3, 4, 7);
	ctx.fillStyle = 'rgba(180,220,255,0.5)';
	ctx.fillRect(CX + 4, CY + 1, 3, 3);
}

function drawMine(ctx: CanvasRenderingContext2D) {
	ctx.fillStyle = '#787068';
	ctx.beginPath();
	ctx.arc(CX - 6, CY + 3, 7, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = '#6a6358';
	ctx.beginPath();
	ctx.arc(CX + 5, CY + 4, 6, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = '#7a7268';
	ctx.beginPath();
	ctx.arc(CX, CY - 3, 6, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = 'rgba(220,190,100,0.5)';
	ctx.beginPath();
	ctx.arc(CX - 3, CY - 5, 1.5, 0, Math.PI * 2);
	ctx.fill();
	ctx.beginPath();
	ctx.arc(CX + 4, CY + 1, 1.2, 0, Math.PI * 2);
	ctx.fill();
}

function drawBarracks(ctx: CanvasRenderingContext2D) {
	ctx.fillStyle = '#6a4a38';
	ctx.fillRect(CX - 10, CY - 4, 20, 14);
	ctx.fillStyle = '#4a2a1a';
	ctx.beginPath();
	ctx.moveTo(CX - 12, CY - 4);
	ctx.lineTo(CX, CY - 12);
	ctx.lineTo(CX + 12, CY - 4);
	ctx.closePath();
	ctx.fill();
	ctx.strokeStyle = '#8a7a60';
	ctx.lineWidth = 1.5;
	ctx.beginPath();
	ctx.moveTo(CX + 8, CY - 4);
	ctx.lineTo(CX + 8, CY - 18);
	ctx.stroke();
	ctx.fillStyle = '#c03030';
	ctx.beginPath();
	ctx.moveTo(CX + 8, CY - 18);
	ctx.lineTo(CX + 16, CY - 15);
	ctx.lineTo(CX + 8, CY - 12);
	ctx.closePath();
	ctx.fill();
}

function drawCityCenter(ctx: CanvasRenderingContext2D) {
	ctx.fillStyle = '#a0906a';
	ctx.fillRect(CX - 6, CY - 12, 12, 20);
	ctx.fillRect(CX - 8, CY - 15, 4, 4);
	ctx.fillRect(CX - 1, CY - 15, 4, 4);
	ctx.fillRect(CX + 5, CY - 15, 4, 4);
	ctx.fillStyle = '#908060';
	ctx.fillRect(CX - 14, CY - 4, 8, 12);
	ctx.fillRect(CX + 6, CY - 4, 8, 12);
	ctx.fillStyle = '#4a3520';
	ctx.beginPath();
	ctx.arc(CX, CY + 2, 3.5, Math.PI, 0);
	ctx.lineTo(CX + 3.5, CY + 8);
	ctx.lineTo(CX - 3.5, CY + 8);
	ctx.closePath();
	ctx.fill();
}

function drawTownCenter(ctx: CanvasRenderingContext2D) {
	ctx.fillStyle = '#9a8a68';
	ctx.fillRect(CX - 10, CY - 5, 20, 13);
	ctx.fillStyle = '#7a5a3a';
	ctx.beginPath();
	ctx.moveTo(CX - 13, CY - 5);
	ctx.lineTo(CX, CY - 13);
	ctx.lineTo(CX + 13, CY - 5);
	ctx.closePath();
	ctx.fill();
	ctx.fillStyle = '#4a3020';
	ctx.fillRect(CX - 2.5, CY + 1, 5, 7);
	ctx.fillStyle = 'rgba(180,210,240,0.45)';
	ctx.fillRect(CX - 8, CY - 2, 3, 3);
	ctx.fillRect(CX + 5, CY - 2, 3, 3);
}

// ── base colors per kind ─────────────────────────────

const BASE: Record<TileKind, number> = {
	grass: 0x4a7a50,
	fog: 0x161e18,
	city: 0x3d8855,
	house: 0x557a52,
	farm: 0x6a8a3e,
	mine: 0x5a7050,
	barracks: 0x4a7050,
	city_center: 0x4a7a50,
	town_center: 0x4a7a50
};

// ── texture generation ───────────────────────────────

function render(kind: TileKind, seed: number): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = TEX_W;
	canvas.height = TEX_H;
	const ctx = canvas.getContext('2d')!;
	const color = BASE[kind];
	const isFog = kind === 'fog';

	drawSides(ctx, color);
	drawTop(ctx, color);

	if (!isFog) {
		drawGrass(ctx, seed);
		switch (kind) {
			case 'farm':
				drawFarmRows(ctx);
				break;
			case 'house':
				drawHouse(ctx);
				break;
			case 'mine':
				drawMine(ctx);
				break;
			case 'barracks':
				drawBarracks(ctx);
				break;
			case 'city_center':
				drawCityCenter(ctx);
				break;
			case 'town_center':
				drawTownCenter(ctx);
				break;
		}
		drawBevel(ctx);
	}

	drawOutline(ctx, color, isFog ? 0.15 : 0.4);
	return canvas;
}

// ── public API ───────────────────────────────────────

const cache = new Map<string, Texture>();
const VARIANTS: Partial<Record<TileKind, number>> = { grass: 4, city: 3 };

export function getTileTexture(kind: TileKind, col: number, row: number): Texture {
	const nv = VARIANTS[kind] ?? 1;
	const variant = nv > 1 ? (tileHash(col, row) >>> 0) % nv : 0;
	const key = `${kind}:${variant}`;

	let tex = cache.get(key);
	if (!tex) {
		tex = Texture.from(render(kind, variant * 7919 + 42));
		cache.set(key, tex);
	}
	return tex;
}
