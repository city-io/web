<script lang="ts">
  import { goto } from '$app/navigation';
  import { userClient } from '$lib/api/client';
  import { token as tokenStore, userId as userIdStore } from '$lib/stores';
  import { clearSession } from '$lib/session';
  import Brand from '$lib/components/Brand.svelte';
  import Button from '$lib/components/Button.svelte';
  import TextField from '$lib/components/TextField.svelte';

  let username = '';
  let email = '';
  let password = '';
  let confirmPassword = '';
  let isLoading = false;
  let errorMessage = '';

  const handleRegister = async () => {
    if (password !== confirmPassword) {
      errorMessage = 'Passwords do not match';
      return;
    }
    isLoading = true;
    errorMessage = '';
    // Start from a clean slate so no prior session leaks into the new account.
    clearSession();

    try {
      const response = await userClient.register({ username, email, password });
      tokenStore.set(response.token);
      userIdStore.set(response.userId?.value);

      goto('/game');
    } catch (error: unknown) {
      errorMessage = error instanceof Error ? error.message : 'Username or email already exists';
    } finally {
      isLoading = false;
    }
  };
</script>

<svelte:head>
  <title>Register - city.io</title>
</svelte:head>

<main class="relative flex min-h-screen flex-col bg-[#0e110f] px-6">
  <header class="mx-auto flex h-20 w-full max-w-6xl items-center border-b border-white/[0.07]">
    <button aria-label="Go to home" on:click={() => goto('/')}>
      <Brand size="sm" />
    </button>
  </header>

  <section class="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
    <div class="mb-8">
      <p class="mb-3 text-xs font-medium uppercase tracking-[0.16em] text-[#79827c]">Account</p>
      <h2 class="text-[32px] font-semibold tracking-[-0.04em] text-white">Create an account</h2>
      <p class="mt-2 text-sm text-[#8f9891]">Start a new city in a few seconds.</p>
    </div>

    {#if errorMessage}
      <div class="mb-5 border-l-2 border-red-400 bg-red-400/[0.08] px-3 py-2.5 text-[13px] text-red-300" role="alert">{errorMessage}</div>
    {/if}

    <form class="space-y-4" on:submit|preventDefault={handleRegister}>
      <TextField id="username" label="Username" type="text" autocomplete="username" placeholder="Choose a username" bind:value={username} />
      <TextField id="email" label="Email" type="email" autocomplete="email" placeholder="you@example.com" bind:value={email} />
      <TextField id="password" label="Password" type="password" autocomplete="new-password" placeholder="Create a password" bind:value={password} />
      <TextField
        id="confirmPassword"
        label="Confirm password"
        type="password"
        autocomplete="new-password"
        placeholder="Repeat your password"
        invalid={!!confirmPassword && confirmPassword !== password}
        bind:value={confirmPassword}
      >
        <p slot="hint" class="mt-1.5 text-[11px] text-red-300">
          {#if confirmPassword && confirmPassword !== password}Passwords don't match{/if}
        </p>
      </TextField>

      <Button type="submit" variant="primary" class="mt-2 w-full py-3" disabled={isLoading} loading={isLoading}>
        Create account
        <span slot="loading">Creating account…</span>
      </Button>
    </form>

    <p class="mt-7 text-sm text-[#8f9891]">
      Already have an account?
      <button class="ml-1 font-medium text-[#dce5da] underline decoration-white/20 underline-offset-4 transition-colors hover:text-white" on:click={() => goto('/login')}>Sign in</button>
    </p>
  </section>
</main>
