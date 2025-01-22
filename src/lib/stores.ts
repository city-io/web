import { writable } from 'svelte/store';

export interface User {
  id: number;
  username: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export const token = writable<string | undefined>(
  typeof window !== 'undefined' ? (localStorage.getItem('jwt-token') as string | undefined) : ''
);
token.subscribe((val) => {
  if (typeof window !== 'undefined') localStorage.setItem('jwt-token', val ?? '');
});

export let user = writable<User | null>(null);
