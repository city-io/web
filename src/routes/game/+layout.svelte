<script lang="ts">
	import { mapClient, userClient } from '$lib/api/client';
	import {
		buildings as buildingsStore,
		capital,
		cities as citiesStore,
		food,
		gold,
		mapCenter,
		userId
	} from '$lib/stores';

	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let mapLoaded = false;

	onMount(() => {
		const abortController = new AbortController();

		loadMap();
		startStream(abortController.signal);

		return () => {
			abortController.abort();
		};
	});

	const loadMap = async () => {
		try {
			const response = await mapClient.getMap({});
			citiesStore.set(response.cities);
			buildingsStore.set(response.buildings);

			// Find user's capital
			const userCapital = response.cities.find(
				(c) => c.owner === $userId && c.type === 1
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
					gold.set(state.gold);
					food.set(state.food);
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
