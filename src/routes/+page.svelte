<script lang="ts">
  import { userClient } from '$lib/api/client';
  import { email as emailStore, username as usernameStore, gold, food, token, userId as userIdStore } from '$lib/stores';
  import { isTokenValid, clearSession } from '$lib/session';

  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import Brand from '$lib/components/Brand.svelte';
  import Button from '$lib/components/Button.svelte';

  // Gate the landing render until we know whether a returning user should be
  // bounced straight into the game.
  let checking = true;

  onMount(async () => {
    // No token (or an obviously dead one) → show the landing page, logged out.
    if (!isTokenValid($token)) {
      clearSession();
      checking = false;
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
      // getUser failed (or Unauthenticated handled by the interceptor): drop the
      // session and show the landing page instead of an error.
      clearSession();
      checking = false;
    }
  });
</script>

<svelte:head>
  <title>city.io — build your empire</title>
</svelte:head>

{#if !checking}
  <main class="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-16 text-center">
    <!-- Isometric skyline flourish -->
    <div class="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-stone-950/70 to-transparent"></div>

    <div class="relative z-10 flex max-w-2xl flex-col items-center">
      <Brand />

      <h2 class="mt-8 font-display text-lg leading-relaxed text-stone-100 sm:text-xl" style="text-shadow: 2px 2px 0 rgba(0,0,0,0.6)">Found cities. Command an empire.</h2>
      <p class="mt-5 max-w-md text-sm leading-relaxed text-stone-300">
        Raise settlements across an isometric world, grow your population, balance gold and food, and expand your borders one tile at a time.
      </p>

      <div class="mt-10 flex flex-wrap items-center justify-center gap-3">
        <Button variant="primary" class="px-6 py-3" on:click={() => goto('/register')}>Start playing</Button>
        <Button class="px-6 py-3" on:click={() => goto('/login')}>Sign in</Button>
      </div>

      <div class="mt-14 grid grid-cols-1 gap-3 text-left sm:grid-cols-3">
        {#each [['Expand', 'Claim territory and push back the fog of war.'], ['Build', 'Houses, farms, mines and barracks — each earns its keep.'], ['Command', 'Watch gold and food flow across your whole empire.']] as [title, body]}
          <div class="panel p-4">
            <div class="panel-title mb-1.5">{title}</div>
            <p class="text-xs leading-relaxed text-stone-300">{body}</p>
          </div>
        {/each}
      </div>
    </div>
  </main>
{/if}
