<script lang="ts">
	import { userClient } from '$lib/api/client';
	import {
		email as emailStore,
		username as usernameStore,
		gold,
		food,
		token,
		userId as userIdStore
	} from '$lib/stores';

	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	onMount(async () => {
		if (!$token) {
			goto('/login');
			return;
		}

		try {
			// Parse JWT payload to extract userId
			const payload = JSON.parse(atob($token.split('.')[1]));
			const id = payload.sub || payload.userId;

			const response = await userClient.getUser({ userId: { value: id } });
			const user = response.user!;
			userIdStore.set(user.userId?.value);
			emailStore.set(user.email);
			usernameStore.set(user.username);
			gold.set(user.gold);
			food.set(user.food);

			goto('/game');
		} catch {
			goto('/login');
		}
	});
</script>

<svelte:head>
	<title>city.io</title>
</svelte:head>
