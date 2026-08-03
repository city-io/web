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
  /** One byte per tile, row-major: the value for (x, y) is at y * w + x. */
  terrain: Uint8Array;
  relief: Uint8Array;
  feature: Uint8Array;
  special: Uint8Array;
  /** 6-bit mask per tile: bit i means a river continues toward neighbor i. */
  rivers: Uint8Array;
  /**
   * 1 where the player can see the ground right now. Vision is ephemeral — it
   * lasts only while a city, army or held structure is watching — so tiles
   * leave this set as readily as they enter it, and the planes above are only
   * meaningful where it is set.
   */
  visible: Uint8Array;
}

export function emptyWorld(w: number, h: number, seed: bigint): WorldMap {
  const n = w * h;
  return {
    w,
    h,
    seed,
    terrain: new Uint8Array(n),
    relief: new Uint8Array(n),
    feature: new Uint8Array(n),
    special: new Uint8Array(n),
    rivers: new Uint8Array(n),
    visible: new Uint8Array(n)
  };
}

/**
 * Replace what the player can see with the set the server just sent.
 *
 * The whole set arrives every time rather than a reveal-only delta, because
 * losing sight of ground is as common as gaining it. Clearing first is what
 * makes a tile actually go dark when the army watching it walks away.
 */
export function applyVisibleTerrain(world: WorldMap, v: { indices: number[]; terrain: Uint8Array; relief: Uint8Array; feature: Uint8Array; special: Uint8Array; rivers: Uint8Array }): void {
  world.terrain.fill(0);
  world.relief.fill(0);
  world.feature.fill(0);
  world.special.fill(0);
  world.rivers.fill(0);
  world.visible.fill(0);

  for (let k = 0; k < v.indices.length; k++) {
    const i = v.indices[k];
    if (i < 0 || i >= world.visible.length) continue;
    world.terrain[i] = v.terrain[k];
    world.relief[i] = v.relief[k];
    world.feature[i] = v.feature[k];
    world.special[i] = v.special[k];
    world.rivers[i] = v.rivers[k];
    world.visible[i] = 1;
  }
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
