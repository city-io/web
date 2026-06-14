<script lang="ts">
	import { mapClient, userClient, configClient } from '$lib/api/client';
	import {
		buildings as buildingsStore,
		capital,
		cities as citiesStore,
		food,
		gameConfig,
		gold,
		mapCenter,
		userId
	} from '$lib/stores';

	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let mapLoaded = false;

	onMount(() => {
		const abortController = new AbortController();

		loadConfig();
		loadMap();
		startStream(abortController.signal);

		return () => {
			abortController.abort();
		};
	});

	const loadConfig = async () => {
		try {
			const cfg = await configClient.getGameConfig({});
			gameConfig.set(cfg);
		} catch { /* use defaults */ }
	};

	const loadMap = async () => {
		try {
			const response = await mapClient.getMap({});
			citiesStore.set(response.entities?.cities ?? []);
			buildingsStore.set(response.entities?.buildings ?? []);

			// Find user's capital
			const allCities = response.entities?.cities ?? [];
			const userCapital = allCities.find(
				(c) => c.owner?.value === $userId && c.type === 1
			);
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
					const u = state.entities?.users?.[0];
					if (u) { gold.set(u.gold); food.set(u.food); }
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
