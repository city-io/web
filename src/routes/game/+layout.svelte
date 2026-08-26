<script lang="ts">
  import { mailboxClient, mapClient, userClient, configClient } from '$lib/api/client';
  import {
    token,
    armies as armiesStore,
    armyOrders as armyOrdersStore,
    battles as battlesStore,
    buildings as buildingsStore,
    capital,
    cities as citiesStore,
    food,
    foodIncomePerHour,
    foodUpkeepPerHour,
    gameConfig,
    gold,
    mailboxMessages as mailboxMessagesStore,
    mapCenter,
    tileVisibility as tileVisibilityStore,
    tiles as tilesStore,
    userId
  } from '$lib/stores';
  import { tileKey } from '$lib/game/iso';
  import type { Tile } from '$lib/gen/cityio/entity/v1/tile_pb';
  import type { EntityBag } from '$lib/gen/cityio/entity/v1/bag_pb';
  import type { EntityIdBag } from '$lib/gen/cityio/entity/v1/ids_pb';
  import type { StateDelta, StateSnapshot, TileVisibility } from '$lib/gen/cityio/service/v1/state_pb';
  import { ratePerHour } from '$lib/game/rates';
  import { isTokenValid, handleUnauthenticated } from '$lib/session';
  import { Code, ConnectError } from '@connectrpc/connect';

  import { get } from 'svelte/store';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  let mapLoaded = false;

  const visibilityMap = (entries: TileVisibility[]) => {
    const result = new Map<string, TileVisibility['state']>();
    for (const entry of entries) {
      if (entry.tileId) result.set(tileKey(entry.tileId.x, entry.tileId.y), entry.state);
    }
    return result;
  };

  const setResources = (bag?: EntityBag) => {
    const u = bag?.users[0];
    if (!u) return;
    gold.set(u.gold);
    food.set(u.food);
    foodIncomePerHour.set(ratePerHour(u.foodIncome));
    foodUpkeepPerHour.set(ratePerHour(u.foodUpkeep));
  };

  const setCapital = (bag?: EntityBag, center = false) => {
    const userCapital = bag?.cities.find((c) => c.owner?.value === $userId && c.type === 1);
    if (!userCapital?.start) return;
    capital.set(userCapital);
    if (center) mapCenter.set({ x: userCapital.start.x + 2, y: userCapital.start.y + 2 });
  };

  const tileMap = (bag?: EntityBag) => {
    const result = new Map<string, Tile>();
    for (const tile of bag?.tiles ?? []) {
      if (tile.tileId) result.set(tileKey(tile.tileId.x, tile.tileId.y), tile);
    }
    return result;
  };

  const applySnapshot = (snapshot: StateSnapshot) => {
    const bag = snapshot.entities;
    setResources(bag);
    citiesStore.set(bag?.cities ?? []);
    buildingsStore.set(bag?.buildings ?? []);
    armiesStore.set(bag?.armies ?? []);
    armyOrdersStore.set(bag?.armyOrders ?? []);
    battlesStore.set(bag?.battles ?? []);
    tilesStore.set(tileMap(bag));
    tileVisibilityStore.set(visibilityMap(snapshot.tileVisibility));
    setCapital(bag);
  };

  const upsertById = <T,>(previous: T[], incoming: T[], idOf: (value: T) => string | undefined): T[] => {
    const result = new Map<string, T>();
    for (const value of previous) {
      const id = idOf(value);
      if (id) result.set(id, value);
    }
    for (const value of incoming) {
      const id = idOf(value);
      if (id) result.set(id, value);
    }
    return [...result.values()];
  };

  const removedIds = (deleted?: EntityIdBag, hidden?: EntityIdBag) => ({
    cities: new Set([...(deleted?.cityIds ?? []), ...(hidden?.cityIds ?? [])].map((id) => id.value)),
    buildings: new Set([...(deleted?.buildingIds ?? []), ...(hidden?.buildingIds ?? [])].map((id) => id.value)),
    armies: new Set([...(deleted?.armyIds ?? []), ...(hidden?.armyIds ?? [])].map((id) => id.value)),
    armyOrders: new Set([...(deleted?.armyOrderIds ?? []), ...(hidden?.armyOrderIds ?? [])].map((id) => id.value)),
    battles: new Set([...(deleted?.battleIds ?? []), ...(hidden?.battleIds ?? [])].map((id) => id.value)),
    mailboxMessages: new Set([...(deleted?.mailboxMessageIds ?? []), ...(hidden?.mailboxMessageIds ?? [])].map((id) => id.value))
  });

  const applyDelta = (delta: StateDelta) => {
    const bag = delta.upserts;
    setResources(bag);
    const removed = removedIds(delta.deleted, delta.hidden);
    if (bag?.cities.length || removed.cities.size) {
      citiesStore.update((previous) =>
        upsertById(
          previous.filter((city) => !removed.cities.has(city.cityId?.value ?? '')),
          bag?.cities ?? [],
          (city) => city.cityId?.value
        )
      );
    }
    if (bag?.buildings.length || removed.buildings.size) {
      buildingsStore.update((previous) =>
        upsertById(
          previous.filter((building) => !removed.buildings.has(building.buildingId?.value ?? '')),
          bag?.buildings ?? [],
          (building) => building.buildingId?.value
        )
      );
    }
    if (bag?.armies.length || removed.armies.size) {
      armiesStore.update((previous) =>
        upsertById(
          previous.filter((army) => !removed.armies.has(army.armyId?.value ?? '')),
          bag?.armies ?? [],
          (army) => army.armyId?.value
        )
      );
    }
    if (bag?.armyOrders.length || removed.armyOrders.size) {
      armyOrdersStore.update((previous) =>
        upsertById(
          previous.filter((order) => !removed.armyOrders.has(order.armyOrderId?.value ?? '')),
          bag?.armyOrders ?? [],
          (order) => order.armyOrderId?.value
        )
      );
    }
    if (bag?.battles.length || removed.battles.size) {
      battlesStore.update((previous) =>
        upsertById(
          previous.filter((battle) => !removed.battles.has(battle.battleId?.value ?? '')),
          bag?.battles ?? [],
          (battle) => battle.battleId?.value
        )
      );
    }
    if (bag?.mailboxMessages.length || removed.mailboxMessages.size) {
      mailboxMessagesStore.update((previous) =>
        upsertById(
          previous.filter((message) => !removed.mailboxMessages.has(message.mailboxMessageId?.value ?? '')),
          bag?.mailboxMessages ?? [],
          (message) => message.mailboxMessageId?.value
        )
      );
    }
    if (bag?.tiles.length) {
      tilesStore.update((previous) => {
        const result = new Map(previous);
        for (const tile of bag.tiles) if (tile.tileId) result.set(tileKey(tile.tileId.x, tile.tileId.y), tile);
        return result;
      });
    }
    if (delta.tileVisibility.length) {
      tileVisibilityStore.update((previous) => {
        const result = new Map(previous);
        for (const visibility of delta.tileVisibility) if (visibility.tileId) result.set(tileKey(visibility.tileId.x, visibility.tileId.y), visibility.state);
        return result;
      });
    }
  };

  onMount(() => {
    // Never enter the game with an obviously dead token.
    if (!isTokenValid(get(token))) {
      handleUnauthenticated();
      return;
    }

    const abortController = new AbortController();

    mailboxMessagesStore.set([]);
    loadConfig();
    loadMailbox();
    // Load map first, then let the stream's initial authoritative snapshot
    // reconcile it with fresh actor state.
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

  const loadMailbox = async () => {
    try {
      const response = await mailboxClient.listMailboxMessages({});
      mailboxMessagesStore.update((previous) => upsertById(response.messages, previous, (message) => message.mailboxMessageId?.value));
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.Unauthenticated) return;
    }
  };

  const loadMap = async () => {
    try {
      const response = await mapClient.getMap({});
      citiesStore.set(response.entities?.cities ?? []);
      buildingsStore.set(response.entities?.buildings ?? []);
      armiesStore.set(response.entities?.armies ?? []);
      armyOrdersStore.set(response.entities?.armyOrders ?? []);
      battlesStore.set(response.entities?.battles ?? []);

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
      tileVisibilityStore.set(visibilityMap(response.tileVisibility));

      setResources(response.entities);
      setCapital(response.entities, true);

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
          if (state.frame.case === 'snapshot') applySnapshot(state.frame.value);
          else if (state.frame.case === 'delta') applyDelta(state.frame.value);
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
