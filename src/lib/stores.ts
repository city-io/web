import { writable } from 'svelte/store';

import type { City, MapTile, User } from './types';

export const token = writable<string | undefined>(typeof window !== 'undefined' ? (localStorage.getItem('jwt-token') as string | undefined) : '');
token.subscribe((val) => {
  if (typeof window !== 'undefined') localStorage.setItem('jwt-token', val ?? '');
});
export const userId = writable<string | undefined>('');
export const email = writable<string | undefined>('');

export let ws = writable<WebSocket | null>(null);

export let user = writable<User | null>(null);

export let capital = writable<City | null>(null);

// store map as a 2D array prefilled with empty maptiles of 128x128
export let map = writable<MapTile[][]>(Array.from({ length: 128 }, (_, x) => Array.from({ length: 128 }, (_, y) => ({ x, y }))));

export let mapCenter = writable<{ x: number; y: number }>({ x: 0, y: 0 });
