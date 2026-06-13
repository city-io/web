/** Hex size: center-to-vertex distance in pixels. */
export const S = 50;

export const SQRT3 = Math.sqrt(3);
export const HEX_H = SQRT3 * S;

/** Flat-top hex vertices relative to center, as [x0, y0, x1, y1, ...]. */
export const HEX_VERTS: number[] = [];
for (let i = 0; i < 6; i++) {
	const angle = (Math.PI / 3) * i;
	HEX_VERTS.push(S * Math.cos(angle), S * Math.sin(angle));
}

/** Scaled-down hex variants for inner accents. */
export const INNER_HEX_SM = HEX_VERTS.map((v) => v * 0.55);
export const INNER_HEX_LG = HEX_VERTS.map((v) => v * 0.72);

/** Convert hex grid (col, row) to pixel position (flat-top, odd-q offset). */
export function hexToPixel(col: number, row: number) {
	return {
		x: col * 1.5 * S,
		y: (row + 0.5 * (col & 1)) * HEX_H
	};
}

/** Convert pixel position to hex grid (col, row) via axial cube rounding. */
export function pixelToHex(px: number, py: number) {
	const q = ((2 / 3) * px) / S;
	const r = ((-1 / 3) * px + (SQRT3 / 3) * py) / S;
	const s = -q - r;
	let rq = Math.round(q),
		rr = Math.round(r);
	const rs = Math.round(s);
	const dq = Math.abs(rq - q),
		dr = Math.abs(rr - r),
		ds = Math.abs(rs - s);
	if (dq > dr && dq > ds) rq = -rr - rs;
	else if (dr > ds) rr = -rq - rs;
	return { x: rq, y: rr + (rq - (rq & 1)) / 2 };
}

/** Create a string key for a tile coordinate pair. */
export function tileKey(x: number, y: number) {
	return `${x},${y}`;
}

/**
 * Get the 6 hex neighbors for flat-top odd-q offset coordinates.
 * Returns [neighbor0, ..., neighbor5] where edge i (vertex i → vertex (i+1)%6)
 * is shared with neighbor i.
 */
const EVEN_NEIGHBORS = [[1, 0], [0, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ODD_NEIGHBORS = [[1, 1], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, 0]];

export function hexNeighbors(col: number, row: number): [number, number][] {
	const offsets = (col & 1) ? ODD_NEIGHBORS : EVEN_NEIGHBORS;
	return offsets.map(([dc, dr]) => [col + dc, row + dr]);
}
