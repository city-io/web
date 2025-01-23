import { writable } from 'svelte/store';

export interface User {
  userId: number;
  username: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface City {
  cityId: number;
  name: string;
  startX: number;
  startY: number;
}

export interface Building {
  buildingId: string;
  cityId: string;
  type: string;
  x: number;
  y: number;
  constructionEnd: Date;
}

export interface Army {
  armyId: string;
  tileX: number;
  tileY: number;
  owner: string;
  size: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  marchActive: boolean;
}

export interface MapTile {
  x: number;
  y: number;
  city?: City;
  building?: Building;
  armies?: Map<string, Army[]>;
}

export const token = writable<string | undefined>(typeof window !== 'undefined' ? (localStorage.getItem('jwt-token') as string | undefined) : '');
token.subscribe((val) => {
  if (typeof window !== 'undefined') localStorage.setItem('jwt-token', val ?? '');
});

export let ws = writable<WebSocket | null>(null);

export let user = writable<User | null>(null);

export let capital = writable<City | null>(null);

// store map as a 2D array prefilled with empty maptiles of 128x128
export let map = writable<MapTile[][]>(Array.from({ length: 128 }, (_, x) => Array.from({ length: 128 }, (_, y) => ({ x, y }))));

export let mapCenter = writable<{ x: number; y: number }>({ x: 0, y: 0 });
