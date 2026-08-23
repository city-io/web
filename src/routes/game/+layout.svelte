<script lang="ts">
  import { mapClient, userClient, configClient } from '$lib/api/client';
  import {
    token,
    armies as armiesStore,
    buildings as buildingsStore,
    capital,
    cities as citiesStore,
    food,
    foodIncomePerHour,
    foodUpkeepPerHour,
    gameConfig,
    gold,
    mapCenter,
    tiles as tilesStore,
    userId
  } from '$lib/stores';
  import { tileKey } from '$lib/game/iso';
  import type { Tile } from '$lib/gen/cityio/entity/v1/tile_pb';
  import { ratePerHour } from '$lib/game/rates';
  import { isTokenValid, handleUnauthenticated } from '$lib/session';
  import { Code, ConnectError } from '@connectrpc/connect';

  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  let mapLoaded = false;

  onMount(() => {
    // Never enter the game with an obviously dead token.
    if (!isTokenValid(get(token))) {
      handleUnauthenticated();
      return;
    }

    const abortController = new AbortController();

    loadConfig();
    // Load map first, then start stream so the stream's initial snapshot
    // (from actor memory, always fresh) upserts over potentially stale DB data
    loadMap().then(() => startStream(abortController.signal));

    return () => {
      abortController.abort();
    };
  });

  const loadConfig = async () => {
    try {
      const cfg = await configClient.getGameConfig({});
      gameConfig.set(cfg);
    } catch {
      /* use defaults */
    }
  };

  const loadMap = async () => {
    try {
      const response = await mapClient.getMap({});
      citiesStore.set(response.entities?.cities ?? []);
      buildingsStore.set(response.entities?.buildings ?? []);
      armiesStore.set(response.entities?.armies ?? []);

      const rawTiles = new Map<string, Tile>();
      for (const tile of response.entities?.tiles ?? []) {
        if (!tile.tileId) continue;
        rawTiles.set(tileKey(tile.tileId.x, tile.tileId.y), tile);
      }
      const rootedTiles = new Map<string, Tile>();
      for (const id of response.tileIds) {
        const key = tileKey(id.x, id.y);
        const tile = rawTiles.get(key);
        if (tile) rootedTiles.set(key, tile);
      }
      tilesStore.set(rootedTiles);

      // Find user's capital
      const allCities = response.entities?.cities ?? [];
      const userCapital = allCities.find((c) => c.owner?.value === $userId && c.type === 1);
      if (userCapital && userCapital.start) {
        capital.set(userCapital);
        mapCenter.set({
          x: userCapital.start.x + 2,
          y: userCapital.start.y + 2
        });
      }

      mapLoaded = true;
    } catch (err) {
      // The auth interceptor already redirects on Unauthenticated; only handle
      // other (network) failures here.
      if (err instanceof ConnectError && err.code === Code.Unauthenticated) return;
      goto('/');
    }
  };

  const startStream = async (signal: AbortSignal) => {
    while (!signal.aborted) {
      try {
        for await (const state of userClient.streamState({}, { signal })) {
          const bag = state.entities;
          if (bag) {
            // User resource updates
            const u = bag.users[0];
            if (u) {
              gold.set(u.gold);
              food.set(u.food);
              foodIncomePerHour.set(ratePerHour(u.foodIncome));
              foodUpkeepPerHour.set(ratePerHour(u.foodUpkeep));
            }

            // City delta updates (upsert by ID)
            if (bag.cities.length) {
              citiesStore.update((prev) => {
                const updated = [...prev];
                for (const c of bag.cities) {
                  const id = c.cityId?.value;
                  if (!id) continue;
                  const idx = updated.findIndex((x) => x.cityId?.value === id);
                  if (idx >= 0) updated[idx] = c;
                  else updated.push(c);
                }
                return updated;
              });
            }

            // Building delta updates (upsert by ID)
            if (bag.buildings.length) {
              buildingsStore.update((prev) => {
                const updated = [...prev];
                for (const b of bag.buildings) {
                  const id = b.buildingId?.value;
                  if (!id) continue;
                  const idx = updated.findIndex((x) => x.buildingId?.value === id);
                  if (idx >= 0) updated[idx] = b;
                  else updated.push(b);
                }
                return updated;
              });
            }

            // Army delta updates (upsert by ID)
            if (bag.armies.length) {
              armiesStore.update((prev) => {
                const updated = [...prev];
                for (const army of bag.armies) {
                  const id = army.armyId?.value;
                  if (!id) continue;
                  const idx = updated.findIndex((x) => x.armyId?.value === id);
                  if (idx >= 0) updated[idx] = army;
                  else updated.push(army);
                }
                return updated;
              });
            }

            if (bag.tiles.length) {
              tilesStore.update((prev) => {
                const updated = new Map(prev);
                for (const tile of bag.tiles) {
                  if (!tile.tileId) continue;
                  updated.set(tileKey(tile.tileId.x, tile.tileId.y), tile);
                }
                return updated;
              });
            }
          }

          // Tombstones live on StreamStateResponse and can arrive without a bag.
          if (state.deletedBuildingIds.length) {
            const ids = new Set(state.deletedBuildingIds.map((id) => id.value).filter(Boolean));
            buildingsStore.update((prev) => prev.filter((b) => !ids.has(b.buildingId?.value ?? '')));
          }

          if (state.deletedArmyIds.length) {
            const ids = new Set(state.deletedArmyIds.map((id) => id.value).filter(Boolean));
            armiesStore.update((prev) => prev.filter((army) => !ids.has(army.armyId?.value ?? '')));
          }
        }
      } catch (err: unknown) {
        if (signal.aborted) return;
        // A rejected session ends the stream for good; otherwise reconnect.
        if (err instanceof ConnectError && err.code === Code.Unauthenticated) {
          handleUnauthenticated();
          return;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  };
</script>

{#if mapLoaded}
  <slot />
{/if}
