const clamp8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Deterministic hash for per-tile color variation. */
export function tileHash(x: number, y: number) {
	let h = (x * 374761393 + y * 668265263) | 0;
	h = ((h ^ (h >>> 13)) * 1274126177) | 0;
	return h ^ (h >>> 16);
}

/** Vary a base color by a small deterministic amount per tile position. */
export function varyColor(base: number, x: number, y: number, range = 8) {
	const h = tileHash(x, y);
	const dr = (((h & 0xf) - 8) * range) / 8;
	const dg = ((((h >> 4) & 0xf) - 8) * range) / 8;
	const db = ((((h >> 8) & 0xf) - 8) * range) / 8;
	return (
		(clamp8(((base >> 16) & 0xff) + dr) << 16) |
		(clamp8(((base >> 8) & 0xff) + dg) << 8) |
		clamp8((base & 0xff) + db)
	);
}

/** Multiply each RGB channel by a factor (< 1 darkens, > 1 lightens). */
export function darken(c: number, f = 0.8) {
	return (
		(clamp8(((c >> 16) & 0xff) * f) << 16) |
		(clamp8(((c >> 8) & 0xff) * f) << 8) |
		clamp8((c & 0xff) * f)
	);
}
