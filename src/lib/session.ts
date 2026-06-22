import { goto } from '$app/navigation';

import { token, userId, email, username, gold, food, foodIncomePerHour, foodUpkeepPerHour, capital, cities, buildings } from '$lib/stores';

// clearSession wipes every piece of per-account state — persisted auth stores
// (which also clears localStorage) and in-memory game state — so no stale
// identity or world data can bleed into the next session. Call this on login
// (before setting the new account), on logout, and on any auth failure.
export const clearSession = () => {
  token.set(undefined);
  userId.set(undefined);
  email.set(undefined);
  username.set(undefined);
  gold.set(0n);
  food.set(0n);
  foodIncomePerHour.set(0);
  foodUpkeepPerHour.set(0);
  capital.set(null);
  cities.set([]);
  buildings.set([]);
};

// isTokenValid does a cheap client-side sanity check: the token must exist,
// be a well-formed JWT, and (if it carries an exp claim) not be expired. The
// server is still the source of truth — this only avoids entering the app with
// an obviously dead token.
export const isTokenValid = (t?: string | null): boolean => {
  if (!t) return false;
  try {
    const payload = JSON.parse(atob(t.split('.')[1]));
    if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) return false;
    return true;
  } catch {
    return false;
  }
};

// handleUnauthenticated is the single response to a rejected session: clear all
// state and send the user to login (unless already on a public auth page).
export const handleUnauthenticated = () => {
  clearSession();
  if (typeof window === 'undefined') return;
  const path = window.location.pathname;
  if (path === '/login' || path === '/register') return;
  goto('/login');
};
