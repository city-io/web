import { FeatureType, ReliefType, SpecialType, TerrainType } from '$lib/gen/cityio/entity/v1/terrain_pb';

/**
 * The map is generated and owned by the server; this module only describes what
 * arrives over the wire. The enums come straight from the proto so there is a
 * single source of truth for the byte values packed into each plane.
 */
export { FeatureType as Feature, ReliefType as Relief, SpecialType as Special, TerrainType as Terrain };

export interface WorldMap {
  w: number;
  h: number;
  seed: bigint;
  /**
   * One byte per tile, row-major: the value for (x, y) is at y * w + x. These
   * are meaningful wherever `explored` is set and stay filled in once charted —
   * terrain is remembered, not re-fetched.
   */
  terrain: Uint8Array;
  relief: Uint8Array;
  feature: Uint8Array;
  special: Uint8Array;
  /** 6-bit mask per tile: bit i means a river continues toward neighbor i. */
  rivers: Uint8Array;
  /** 1 where the player has ever seen the ground. Only ever grows. */
  explored: Uint8Array;
  /**
   * 1 where the player can see the tile right now. A subset of `explored` that
   * shrinks as well as grows: it says where a unit currently has eyes, which is
   * where entities are shown and where terrain is drawn bright rather than
   * dimmed from memory.
   */
  visible: Uint8Array;
}

interface TerrainReveal {
  indices: number[];
  terrain: Uint8Array;
  relief: Uint8Array;
  feature: Uint8Array;
  special: Uint8Array;
  rivers: Uint8Array;
}

/** Unpack a row-major bit i (y*w + x) from a packed bitset. */
const bitSet = (packed: Uint8Array, i: number) => (packed[i >> 3] & (1 << (i & 7))) !== 0;

/** Build the client world from the GetTerrain bootstrap response. */
export function worldFromTerrain(t: {
  width: number;
  height: number;
  seed: bigint;
  terrain: Uint8Array;
  relief: Uint8Array;
  feature: Uint8Array;
  special: Uint8Array;
  rivers: Uint8Array;
  explored: Uint8Array;
  visible: number[];
}): WorldMap {
  const n = t.width * t.height;
  const explored = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (bitSet(t.explored, i)) explored[i] = 1;
  const visible = new Uint8Array(n);
  for (const i of t.visible) if (i >= 0 && i < n) visible[i] = 1;
  return {
    w: t.width,
    h: t.height,
    seed: t.seed,
    terrain: t.terrain.slice(),
    relief: t.relief.slice(),
    feature: t.feature.slice(),
    special: t.special.slice(),
    rivers: t.rivers.slice(),
    explored,
    visible
  };
}

/**
 * Apply a visibility update from the stream.
 *
 * `revealed` tiles are written into the remembered planes and never taken back
 * out — terrain is charted permanently. `visible` is the live set and is
 * replaced wholesale, because losing sight of ground is as common as gaining
 * it: an army walking away must dim the tiles it was lighting even though they
 * stay charted.
 */
export function applyVisibility(world: WorldMap, vis: { revealed?: TerrainReveal; visible: number[] }): void {
  const r = vis.revealed;
  if (r) {
    for (let k = 0; k < r.indices.length; k++) {
      const i = r.indices[k];
      if (i < 0 || i >= world.explored.length) continue;
      world.terrain[i] = r.terrain[k];
      world.relief[i] = r.relief[k];
      world.feature[i] = r.feature[k];
      world.special[i] = r.special[k];
      world.rivers[i] = r.rivers[k];
      world.explored[i] = 1;
    }
  }
  world.visible.fill(0);
  for (const i of vis.visible) if (i >= 0 && i < world.visible.length) world.visible[i] = 1;
}

export const isWater = (t: TerrainType) => t >= TerrainType.DEEP_OCEAN && t <= TerrainType.LAKE;
export const isLand = (t: TerrainType) => t >= TerrainType.BEACH;

export const TERRAIN_NAME: Record<number, string> = {
  [TerrainType.DEEP_OCEAN]: 'Deep Ocean',
  [TerrainType.OCEAN]: 'Ocean',
  [TerrainType.COAST]: 'Coast',
  [TerrainType.LAKE]: 'Lake',
  [TerrainType.BEACH]: 'Beach',
  [TerrainType.GRASSLAND]: 'Grassland',
  [TerrainType.PLAINS]: 'Plains',
  [TerrainType.DESERT]: 'Desert',
  [TerrainType.TUNDRA]: 'Tundra',
  [TerrainType.SNOW]: 'Glacier'
};

export const RELIEF_NAME: Record<number, string> = {
  [ReliefType.UNSPECIFIED]: '',
  [ReliefType.FLAT]: '',
  [ReliefType.HILLS]: 'Hills',
  [ReliefType.MOUNTAINS]: 'Mountains'
};

export const FEATURE_NAME: Record<number, string> = {
  [FeatureType.UNSPECIFIED]: '',
  [FeatureType.FOREST]: 'Forest',
  [FeatureType.JUNGLE]: 'Jungle',
  [FeatureType.MARSH]: 'Marsh',
  [FeatureType.OASIS]: 'Oasis',
  [FeatureType.ICE]: 'Ice'
};

export const SPECIAL_NAME: Record<number, string> = {
  [SpecialType.UNSPECIFIED]: '',
  [SpecialType.WHEAT]: 'Wheat',
  [SpecialType.GAME]: 'Game',
  [SpecialType.FURS]: 'Furs',
  [SpecialType.FISH]: 'Fish',
  [SpecialType.WHALES]: 'Whales',
  [SpecialType.COAL]: 'Coal',
  [SpecialType.IRON]: 'Iron',
  [SpecialType.GOLD]: 'Gold',
  [SpecialType.GEMS]: 'Gems'
};

/** Human-readable description of a tile, e.g. "Grassland · Hills · Forest". */
export function describeTile(world: WorldMap, x: number, y: number): string {
  const i = y * world.w + x;
  return [TERRAIN_NAME[world.terrain[i]] ?? 'Unknown', RELIEF_NAME[world.relief[i]], FEATURE_NAME[world.feature[i]]].filter(Boolean).join(' · ');
}
