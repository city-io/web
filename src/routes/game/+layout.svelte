<script lang="ts">
  import { mapClient, userClient, configClient } from '$lib/api/client';
  import { buildings as buildingsStore, capital, cities as citiesStore, food, foodIncomePerHour, foodUpkeepPerHour, gameConfig, gold, mapCenter, userId } from '$lib/stores';
  import { ratePerHour } from '$lib/game/rates';

  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  let mapLoaded = false;

  onMount(() => {
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
    } catch {
      goto('/');
    }
  };

  const startStream = async (signal: AbortSignal) => {
    while (!signal.aborted) {
      try {
        for await (const state of userClient.streamState({}, { signal })) {
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
        // Reconnect after a delay
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  };
</script>

{#if mapLoaded}
  <slot />
{/if}
