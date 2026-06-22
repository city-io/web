<script lang="ts">
  import { goto } from '$app/navigation';
  import { userClient } from '$lib/api/client';
  import { token as tokenStore, userId as userIdStore } from '$lib/stores';
  import { clearSession } from '$lib/session';

  let username = '';
  let email = '';
  let password = '';
  let confirmPassword = '';
  let showPassword = false;
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

<main class="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0f2417] px-4 py-10">
  <!-- ambient background -->
  <div class="pointer-events-none absolute inset-0">
    <div class="absolute -left-24 top-1/4 h-80 w-80 rounded-full bg-emerald-400/15 blur-3xl"></div>
    <div class="bottom-1/5 absolute -right-20 h-80 w-80 rounded-full bg-emerald-500/15 blur-3xl"></div>
    <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(26,46,30,0.45)_0%,_rgba(10,22,14,0.55)_100%)]"></div>
  </div>

  <div class="relative w-full max-w-sm">
    <!-- brand -->
    <div class="mb-8 flex flex-col items-center text-center">
      <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-700 shadow-lg shadow-emerald-900/40">
        <svg viewBox="0 0 24 24" fill="none" class="h-6 w-6 text-white">
          <path d="M4 20V9l5-3v3l5-3v3l6-2v13H4z" fill="currentColor" opacity="0.95" />
        </svg>
      </div>
      <h1 class="text-2xl font-semibold tracking-tight text-gray-50">city.io</h1>
      <p class="mt-1 text-sm text-gray-400">Create your account and found your first city.</p>
    </div>

    <!-- card -->
    <div class="rounded-2xl border border-white/10 bg-gray-900/60 p-6 shadow-2xl backdrop-blur-xl sm:p-7">
      <h2 class="mb-5 text-sm font-semibold uppercase tracking-widest text-gray-400">Create account</h2>

      {#if errorMessage}
        <div class="mb-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-[13px] text-red-300" role="alert">
          <svg viewBox="0 0 20 20" fill="currentColor" class="mt-0.5 h-4 w-4 shrink-0 text-red-400">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 012 0v4a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z" clip-rule="evenodd" />
          </svg>
          <span>{errorMessage}</span>
        </div>
      {/if}

      <form class="space-y-4" on:submit|preventDefault={handleRegister}>
        <div>
          <label for="username" class="mb-1.5 block text-xs font-medium text-gray-300">Username</label>
          <input
            class="block w-full rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-gray-100 placeholder-gray-600 transition-colors focus:border-emerald-500/50 focus:bg-white/[0.06] focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
            id="username"
            autocomplete="username"
            placeholder="commander"
            bind:value={username}
          />
        </div>

        <div>
          <label for="email" class="mb-1.5 block text-xs font-medium text-gray-300">Email</label>
          <input
            class="block w-full rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-gray-100 placeholder-gray-600 transition-colors focus:border-emerald-500/50 focus:bg-white/[0.06] focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
            id="email"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            bind:value={email}
          />
        </div>

        <div>
          <label for="password" class="mb-1.5 block text-xs font-medium text-gray-300">Password</label>
          <div class="relative">
            <input
              class="block w-full rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 pr-10 text-sm text-gray-100 placeholder-gray-600 transition-colors focus:border-emerald-500/50 focus:bg-white/[0.06] focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
              id="password"
              type={showPassword ? 'text' : 'password'}
              autocomplete="new-password"
              placeholder="••••••••••••"
              bind:value={password}
            />
            <button
              type="button"
              class="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-gray-500 transition-colors hover:text-gray-300"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              on:click={() => (showPassword = !showPassword)}
            >
              {#if showPassword}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4"
                  ><path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.4 5.1A9.8 9.8 0 0112 5c5 0 9 4 9 7a11 11 0 01-2.3 3.2M6.2 6.2A11 11 0 003 12c0 3 4 7 9 7 1.2 0 2.3-.2 3.3-.6"
                  /></svg
                >
              {:else}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4"
                  ><path stroke-linecap="round" stroke-linejoin="round" d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></svg
                >
              {/if}
            </button>
          </div>
        </div>

        <div>
          <label for="confirmPassword" class="mb-1.5 block text-xs font-medium text-gray-300">Confirm password</label>
          <input
            class="block w-full rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-gray-100 placeholder-gray-600 transition-colors focus:border-emerald-500/50 focus:bg-white/[0.06] focus:outline-none focus:ring-1 focus:ring-emerald-500/40 {confirmPassword &&
            confirmPassword !== password
              ? 'border-red-500/40 focus:border-red-500/50 focus:ring-red-500/30'
              : ''}"
            id="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            autocomplete="new-password"
            placeholder="••••••••••••"
            bind:value={confirmPassword}
          />
          {#if confirmPassword && confirmPassword !== password}
            <p class="mt-1.5 text-[11px] text-red-400">Passwords don't match</p>
          {/if}
        </div>

        <button
          class="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-900/30 transition-colors hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:cursor-not-allowed disabled:opacity-60"
          type="submit"
          disabled={isLoading}
        >
          {#if isLoading}
            <div class="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></div>
            <span>Creating account…</span>
          {:else}
            Create account
          {/if}
        </button>
      </form>
    </div>

    <p class="mt-6 text-center text-sm text-gray-400">
      Already have an account?
      <button class="font-medium text-emerald-400 transition-colors hover:text-emerald-300" on:click={() => goto('/login')}>Sign in</button>
    </p>
  </div>
</main>
