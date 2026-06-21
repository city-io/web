import { writable } from 'svelte/store';

import type { Duration } from '@bufbuild/protobuf/wkt';

import type { City } from '$lib/gen/cityio/entity/v1/city_pb';
import type { Building } from '$lib/gen/cityio/entity/v1/building_pb';
import type { BuildingConfig } from '$lib/gen/cityio/service/v1/config_pb';

const persisted = (key: string) => {
  const init = typeof window !== 'undefined' ? localStorage.getItem(key) || '' : '';
  const store = writable<string | undefined>(init || undefined);
  store.subscribe((val) => {
    if (typeof window !== 'undefined') localStorage.setItem(key, val ?? '');
  });
  return store;
};

// Auth
export const token = persisted('jwt-token');
export const userId = persisted('user-id');
export const email = persisted('user-email');
export const username = persisted('user-name');

// Resources
export const gold = writable<bigint>(0n);
export const food = writable<bigint>(0n);

// Shared food pool flow rates, normalized to per-day, sampled live from the stream
export const foodIncomePerDay = writable<number>(0);
export const foodUpkeepPerDay = writable<number>(0);

// Game config (loaded from server). buildingTick/cityTick are actor cadences.
export const gameConfig = writable<{
  mapSize: number;
  citySize: number;
  visionRadius: number;
  buildingTick?: Duration;
  cityTick?: Duration;
  buildings: BuildingConfig[];
}>({ mapSize: 128, citySize: 5, visionRadius: 5, buildings: [] });

export const capital = writable<City | null>(null);
export const mapCenter = writable<{ x: number; y: number }>({ x: 0, y: 0 });

export const cities = writable<City[]>([]);
export const buildings = writable<Building[]>([]);
