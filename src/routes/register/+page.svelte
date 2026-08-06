<script lang="ts">
  import { goto } from '$app/navigation';
  import { userClient } from '$lib/api/client';
  import { token as tokenStore, userId as userIdStore } from '$lib/stores';
  import { clearSession } from '$lib/session';
  import Brand from '$lib/components/Brand.svelte';
  import Panel from '$lib/components/Panel.svelte';
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

<main class="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
  <div class="relative w-full max-w-sm">
    <div class="mb-8">
      <Brand tagline="Create your account and found your first city." />
    </div>

    <Panel title="Create account">
      {#if errorMessage}
        <div class="mb-4 flex items-start gap-2 rounded-panel border border-red-900/60 bg-red-900/40 px-3 py-2.5 text-[13px] text-red-200 shadow-bevel-inset" role="alert">
          <svg viewBox="0 0 20 20" fill="currentColor" class="mt-0.5 h-4 w-4 shrink-0 text-red-300">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 012 0v4a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z" clip-rule="evenodd" />
          </svg>
          <span>{errorMessage}</span>
        </div>
      {/if}

      <form class="space-y-4" on:submit|preventDefault={handleRegister}>
        <TextField id="username" label="Username" type="text" autocomplete="username" placeholder="commander" bind:value={username} />
        <TextField id="email" label="Email" type="email" autocomplete="email" placeholder="you@example.com" bind:value={email} />
        <TextField id="password" label="Password" type="password" autocomplete="new-password" placeholder="••••••••••••" bind:value={password} />
        <TextField
          id="confirmPassword"
          label="Confirm password"
          type="password"
          autocomplete="new-password"
          placeholder="••••••••••••"
          invalid={!!confirmPassword && confirmPassword !== password}
          bind:value={confirmPassword}
        >
          <p slot="hint" class="mt-1.5 text-[11px] text-red-300">
            {#if confirmPassword && confirmPassword !== password}Passwords don't match{/if}
          </p>
        </TextField>

        <Button type="submit" variant="primary" class="w-full" disabled={isLoading} loading={isLoading}>
          Create account
          <span slot="loading">Creating account…</span>
        </Button>
      </form>
    </Panel>

    <p class="mt-6 text-center text-sm text-stone-300">
      Already have an account?
      <button class="font-semibold text-bronze-300 transition-colors hover:text-bronze-400" on:click={() => goto('/login')}>Sign in</button>
    </p>
  </div>
</main>
