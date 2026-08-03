/** Hex size: center-to-vertex distance in pixels. */
export const S = 50;

export const SQRT3 = Math.sqrt(3);
export const ISO = 0.5;
export const HEX_H = SQRT3 * S * ISO;

/** Flat-top hex vertices relative to center, as [x0, y0, x1, y1, ...]. */
export const HEX_VERTS: number[] = [];
for (let i = 0; i < 6; i++) {
  const angle = (Math.PI / 3) * i;
  HEX_VERTS.push(S * Math.cos(angle), S * Math.sin(angle) * ISO);
}

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
  const r = ((-1 / 3) * px + (SQRT3 / 3) * (py / ISO)) / S;
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
 * Neighbor offsets for flat-top odd-q offset coordinates, indexed by column
 * parity (`col & 1`) then by direction 0..5. Direction i shares the edge
 * running from vertex i to vertex (i+1)%6, so the reciprocal of direction i is
 * (i+3)%6 — which is what lets territory borders and river links agree from
 * both sides of an edge.
 *
 * Exported as flat offset tables so hot loops (terrain generation runs six
 * passes over every tile) can walk neighbors without allocating.
 */
export const NEIGHBOR_OFFSETS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [1, 0],
    [0, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1]
  ],
  [
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [0, -1],
    [1, 0]
  ]
];

/** The direction that points back the way you came. */
export const opposite = (dir: number) => (dir + 3) % 6;

/** Get the 6 hex neighbors of (col, row), in direction order. */
export function hexNeighbors(col: number, row: number): [number, number][] {
  return NEIGHBOR_OFFSETS[col & 1].map(([dc, dr]) => [col + dc, row + dr] as [number, number]);
}

/** Midpoint of the edge shared with the neighbor in the given direction. */
export function edgeMidpoint(dir: number): { x: number; y: number } {
  const a = dir * 2;
  const b = ((dir + 1) % 6) * 2;
  return { x: (HEX_VERTS[a] + HEX_VERTS[b]) / 2, y: (HEX_VERTS[a + 1] + HEX_VERTS[b + 1]) / 2 };
}
