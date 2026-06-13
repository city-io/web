import { writable } from 'svelte/store';

import type { City } from '$lib/gen/cityio/v1/city_pb';
import type { Building } from '$lib/gen/cityio/v1/building_pb';

export const token = writable<string | undefined>(
	typeof window !== 'undefined' ? (localStorage.getItem('jwt-token') as string | undefined) : ''
);
token.subscribe((val) => {
	if (typeof window !== 'undefined') localStorage.setItem('jwt-token', val ?? '');
});

export const userId = writable<string | undefined>('');
export const email = writable<string | undefined>('');
export const username = writable<string | undefined>('');
export const gold = writable<bigint>(BigInt(0));
export const food = writable<bigint>(BigInt(0));

export const capital = writable<City | null>(null);
export const mapCenter = writable<{ x: number; y: number }>({ x: 0, y: 0 });

export const cities = writable<City[]>([]);
export const buildings = writable<Building[]>([]);
