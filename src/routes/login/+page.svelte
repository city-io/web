<script lang="ts">
  import { goto } from '$app/navigation';
  import { userClient } from '$lib/api/client';
  import { email as emailStore, username as usernameStore, gold, food, token as tokenStore, userId as userIdStore } from '$lib/stores';
  import { clearSession } from '$lib/session';
  import Brand from '$lib/components/Brand.svelte';
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

<main class="relative flex min-h-screen flex-col bg-[#0e110f] px-6">
  <header class="mx-auto flex h-20 w-full max-w-6xl items-center border-b border-white/[0.07]">
    <button aria-label="Go to home" tabindex="-1" on:click={() => goto('/')}>
      <Brand size="sm" />
    </button>
  </header>

  <section class="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-16">
    <div class="mb-9">
      <p class="mb-2 text-sm text-[#8e9790]">Account</p>
      <h2 class="text-[32px] font-semibold text-white">Sign in</h2>
      <p class="mt-2 text-sm text-[#8f9891]">Welcome back. Enter your details to continue.</p>
    </div>

    {#if errorMessage}
      <div class="mb-5 border-l-2 border-red-400 bg-red-400/[0.08] px-3 py-2.5 text-[13px] text-red-300" role="alert">{errorMessage}</div>
    {/if}

    <form class="space-y-5" on:submit|preventDefault={handleLogin}>
      <TextField id="identifier" label="Username or email" type="text" autocomplete="username" placeholder="you@example.com" bind:value={identifier} />
      <TextField id="password" label="Password" type="password" autocomplete="current-password" placeholder="Your password" bind:value={password} />

      <Button type="submit" variant="primary" class="mt-2 w-full py-3" disabled={isLoading} loading={isLoading}>
        Sign in
        <span slot="loading">Signing in…</span>
      </Button>
    </form>

    <p class="mt-7 text-sm text-[#8f9891]">
      New to city.io?
      <button class="ml-1 font-medium text-[#dce5da] underline decoration-white/20 underline-offset-4 transition-colors hover:text-white" on:click={() => goto('/register')}>Create an account</button>
    </p>
  </section>
</main>
