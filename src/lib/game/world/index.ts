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
