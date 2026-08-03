<script lang="ts">
  import { mapClient, userClient, configClient } from '$lib/api/client';
  import { token, buildings as buildingsStore, capital, cities as citiesStore, food, foodIncomePerHour, foodUpkeepPerHour, gameConfig, gold, mapCenter, userId, world } from '$lib/stores';
  import { applyVisibleTerrain, emptyWorld } from '$lib/game/world';
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

    // Config, entities and terrain load in parallel; nothing renders until all
    // three have landed. The stream starts last so its snapshot (from actor
    // memory, always fresh) upserts over potentially stale DB data.
    Promise.all([loadConfig(), loadMap(), loadTerrain()]).then(([, mapOk, terrainOk]) => {
      if (!mapOk || !terrainOk) return;
      mapLoaded = true;
      startStream(abortController.signal);
    });

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

  // Terrain is generated and owned by the server, and only the ground the
  // player can currently see is sent. Vision is ephemeral, so the stream keeps
  // this up to date as cities, armies and held structures move.
  const loadTerrain = async (): Promise<boolean> => {
    try {
      const t = await mapClient.getTerrain({});
      const w = emptyWorld(t.width, t.height, t.seed);
      if (t.visible) applyVisibleTerrain(w, t.visible);
      world.set(w);
      return true;
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.Unauthenticated) return false;
      goto('/');
      return false;
    }
  };

  const loadMap = async (): Promise<boolean> => {
    try {
      const response = await mapClient.getMap({});
      citiesStore.set(response.entities?.cities ?? []);
      buildingsStore.set(response.entities?.buildings ?? []);

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

      return true;
    } catch (err) {
      // The auth interceptor already redirects on Unauthenticated; only handle
      // other (network) failures here.
      if (err instanceof ConnectError && err.code === Code.Unauthenticated) return false;
      goto('/');
      return false;
    }
  };

  const startStream = async (signal: AbortSignal) => {
    while (!signal.aborted) {
      try {
        for await (const state of userClient.streamState({}, { signal })) {
          // Vision moved: replace what the player can see. Absent on most
          // ticks, since only a city, army or watchtower moving changes it.
          if (state.visibleTerrain) {
            world.update((w) => {
              if (w) applyVisibleTerrain(w, state.visibleTerrain!);
              return w;
            });
          }

          const bag = state.entities;
          if (!bag) continue;

          // User resource updates
          const u = bag.users?.[0];
          if (u) {
            gold.set(u.gold);
            food.set(u.food);
            foodIncomePerHour.set(ratePerHour(u.foodIncome));
            foodUpkeepPerHour.set(ratePerHour(u.foodUpkeep));
          }

          // City delta updates (upsert by ID)
          if (bag.cities?.length) {
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
          if (bag.buildings?.length) {
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

          // Building deletions
          if (bag.deletedBuildingIds?.length) {
            const ids = new Set(bag.deletedBuildingIds.map((id) => id.value).filter(Boolean));
            buildingsStore.update((prev) => prev.filter((b) => !ids.has(b.buildingId?.value ?? '')));
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
