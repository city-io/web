/**
 * Isometric (2:1 dimetric) square-grid math. Replaces the flat-top hex mapping.
 *
 * The world is a square N×N tile grid; each (x, y) maps to a screen diamond via
 * a simple affine transform, so screen→tile is just the inverse matrix + round
 * (no cube-rounding like the hex grid needed).
 */

/** Base diamond dimensions (pixel-art iso standard: 64×32). */
export const TW = 64;
export const TH = 32;
export const HW = TW / 2; // 32 — half width (tile-space X unit)
export const HH = TH / 2; // 16 — half height (tile-space Y unit)

/**
 * Diamond vertices relative to the tile center, as [x0,y0, x1,y1, ...].
 * Order: top, right, bottom, left. Slots in where HEX_VERTS was used.
 */
export const DIAMOND_VERTS: number[] = [0, -HH, HW, 0, 0, HH, -HW, 0];

/** Convert tile (x, y) to screen-space pixel position of the diamond center. */
export function tileToScreen(x: number, y: number) {
  return { sx: (x - y) * HW, sy: (x + y) * HH };
}

/** Convert a screen-space pixel position back to the nearest tile (x, y). */
export function screenToTile(sx: number, sy: number) {
  const a = sx / HW;
  const b = sy / HH;
  return { x: Math.round((a + b) / 2), y: Math.round((b - a) / 2) };
}

/** Create a string key for a tile coordinate pair. Signature matches hex.ts. */
export function tileKey(x: number, y: number) {
  return `${x},${y}`;
}

/** The 4-neighbourhood offsets (unordered set). */
export const NEIGHBORS4: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1]
];

export function neighbors4(x: number, y: number): [number, number][] {
  return NEIGHBORS4.map(([dx, dy]) => [x + dx, y + dy] as [number, number]);
}

/**
 * Diamond edge i (vertex i → vertex (i+1)%4) → the neighbour tile across it.
 * Edge 0 top→right shares with (x, y-1); 1 right→bottom with (x+1, y);
 * 2 bottom→left with (x, y+1); 3 left→top with (x-1, y).
 */
export const EDGE_TO_NEIGHBOR: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0]
];

/**
 * Screen-space AABB of a rectangular tile grid's diamond centers, padded for tall
 * sprites poking above the top row. Used for culling and camera clamping.
 */
export function mapBounds(width: number, height = width) {
  const maxX = width - 1;
  const maxY = height - 1;
  return {
    minX: -maxY * HW - HW,
    maxX: maxX * HW + HW,
    minY: -64, // headroom for mountains and tall city sprites
    maxY: (maxX + maxY) * HH + TH
  };
}

// ── picking round-trip assertion ─────────────────────────
// Guard the affine inverse: screenToTile(tileToScreen(x,y)) must equal (x,y).
// Runs once at module load in dev; a mismatch means the matrices drifted apart.
if (import.meta.env?.DEV) {
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [7, 3],
    [74, 74],
    [12, 40],
    [40, 12]
  ]) {
    const { sx, sy } = tileToScreen(x, y);
    const t = screenToTile(sx, sy);
    if (t.x !== x || t.y !== y) {
      console.error(`iso picking round-trip failed: (${x},${y}) → (${t.x},${t.y})`);
    }
  }
}
