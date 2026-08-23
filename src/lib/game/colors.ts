const clamp8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Deterministic hash for per-tile color variation. */
export function tileHash(x: number, y: number) {
	let h = (x * 374761393 + y * 668265263) | 0;
	h = ((h ^ (h >>> 13)) * 1274126177) | 0;
	return h ^ (h >>> 16);
}

/** Multiply each RGB channel by a factor (< 1 darkens, > 1 lightens). */
export function darken(c: number, f = 0.8) {
	return (
		(clamp8(((c >> 16) & 0xff) * f) << 16) |
		(clamp8(((c >> 8) & 0xff) * f) << 8) |
		clamp8((c & 0xff) * f)
	);
}
