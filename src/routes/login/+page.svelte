<script lang="ts">
  import { goto } from '$app/navigation';
  import { userClient } from '$lib/api/client';
  import { email as emailStore, username as usernameStore, gold, food, token as tokenStore, userId as userIdStore } from '$lib/stores';
  import { clearSession } from '$lib/session';
  import Brand from '$lib/components/Brand.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import Button from '$lib/components/Button.svelte';
  import TextField from '$lib/components/TextField.svelte';

  let identifier = '';
  let password = '';
  let isLoading = false;
  let errorMessage = '';

  const handleLogin = async () => {
    isLoading = true;
    errorMessage = '';
    // Drop any prior session so a new login can never inherit stale state.
    clearSession();

    try {
      const response = await userClient.login({ identifier, password });
      tokenStore.set(response.token);

      const user = response.user!;
      userIdStore.set(user.userId?.value);
      emailStore.set(user.email);
      usernameStore.set(user.username);
      gold.set(user.gold);
      food.set(user.food);

      goto('/game');
    } catch (error: unknown) {
      errorMessage = error instanceof Error ? error.message : 'Invalid login credentials';
    } finally {
      isLoading = false;
    }
  };
</script>

<svelte:head>
  <title>Sign In - city.io</title>
</svelte:head>

<main class="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
  <div class="relative w-full max-w-sm">
    <div class="mb-8">
      <Brand tagline="Build, expand, and command your empire." />
    </div>

    <Panel title="Welcome back">
      {#if errorMessage}
        <div class="mb-4 flex items-start gap-2 rounded-panel border border-red-900/60 bg-red-900/40 px-3 py-2.5 text-[13px] text-red-200 shadow-bevel-inset" role="alert">
          <svg viewBox="0 0 20 20" fill="currentColor" class="mt-0.5 h-4 w-4 shrink-0 text-red-300">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 012 0v4a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z" clip-rule="evenodd" />
          </svg>
          <span>{errorMessage}</span>
        </div>
      {/if}

      <form class="space-y-4" on:submit|preventDefault={handleLogin}>
        <TextField id="identifier" label="Username or email" type="text" autocomplete="username" placeholder="you@example.com" bind:value={identifier} />
        <TextField id="password" label="Password" type="password" autocomplete="current-password" placeholder="••••••••••••" bind:value={password} />

        <Button type="submit" variant="primary" class="w-full" disabled={isLoading} loading={isLoading}>
          Sign in
          <span slot="loading">Signing in…</span>
        </Button>
      </form>
    </Panel>

    <p class="mt-6 text-center text-sm text-stone-300">
      Don't have an account?
      <button class="font-semibold text-bronze-300 transition-colors hover:text-bronze-400" on:click={() => goto('/register')}>Create one</button>
    </p>
  </div>
</main>
