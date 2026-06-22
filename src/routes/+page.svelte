<script lang="ts">
  import { userClient } from '$lib/api/client';
  import { email as emailStore, username as usernameStore, gold, food, token, userId as userIdStore } from '$lib/stores';
  import { isTokenValid, clearSession } from '$lib/session';

  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  onMount(async () => {
    // No token, or an obviously dead one → clean slate, go to login.
    if (!isTokenValid($token)) {
      clearSession();
      goto('/login');
      return;
    }

    try {
      // Parse JWT payload to extract userId and confirm the server still
      // recognizes this user before entering the game.
      const payload = JSON.parse(atob($token!.split('.')[1]));
      const id = payload.userId || payload.sub;

      const response = await userClient.getUser({ userId: { value: id } });
      const user = response.user!;
      userIdStore.set(user.userId?.value);
      emailStore.set(user.email);
      usernameStore.set(user.username);
      gold.set(user.gold);
      food.set(user.food);

      goto('/game');
    } catch {
      // getUser failed (or Unauthenticated handled by the interceptor):
      // drop the session and require a fresh login.
      clearSession();
      goto('/login');
    }
  });
</script>

<svelte:head>
  <title>city.io</title>
</svelte:head>
