<script lang="ts">
  import { API_HOST } from '$lib/constants';

  import { goto } from '$app/navigation';

  let username = '';
  let email = '';
  let password = '';
  let confirmPassword = '';
  let isLoading = false;
  let errorMessage = '';
  let loading = true;

  const handleRegister = async () => {
    if (password !== confirmPassword) {
      errorMessage = 'Passwords do not match';
      return;
    }
    isLoading = true;
    errorMessage = '';

    try {
      const response = await fetch(`${API_HOST}/users/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username,
          email,
          password
        })
      });

      if (!response.ok) {
        errorMessage = 'Username or email already exists';
        return;
      }

      goto('/login');
    } catch (error) {
      errorMessage = error.message;
    } finally {
      isLoading = false;
    }
  };
</script>

<main class="bg-gray-50">
  <div class="mx-auto flex flex-col items-center justify-center px-6 py-8 md:h-screen lg:py-0">
    <p class="font-heavy mb-6 flex items-center text-3xl text-gray-900">Register for city.io</p>
    <div class="w-full rounded-lg bg-white shadow sm:max-w-md md:mt-0 xl:p-0">
      {#if errorMessage}
        <div class="border-l-4 border-red-500 bg-red-100 p-4 text-red-700" role="alert">
          <p>{errorMessage}</p>
        </div>
      {/if}
      <div class="space-y-4 p-6 sm:p-8 md:space-y-6">
        <form class="space-y-4 md:space-y-6" on:submit|preventDefault={handleRegister}>
          <div>
            <label for="username" class="mb-2 block text-sm font-medium text-gray-900">Username</label>
            <input
              class="block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-gray-900 focus:border-blue-600 focus:ring-blue-600 sm:text-sm"
              id="username"
              placeholder="prayujt"
              bind:value={username}
            />
          </div>
          <div>
            <label for="email" class="mb-2 block text-sm font-medium text-gray-900">Email</label>
            <input
              class="block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-gray-900 focus:border-blue-600 focus:ring-blue-600 sm:text-sm"
              id="email"
              placeholder="example@prayujt.com"
              bind:value={email}
            />
          </div>
          <div>
            <label for="password" class="mb-2 block text-sm font-medium text-gray-900">Password</label>
            <input
              class="block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-gray-900 focus:border-blue-600 focus:ring-blue-600 sm:text-sm"
              id="password"
              type="password"
              placeholder="******************"
              bind:value={password}
            />
          </div>
          <div>
            <label for="confirmPassword" class="mb-2 block text-sm font-medium text-gray-900">Confirm Password</label>
            <input
              class="block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 text-gray-900 focus:border-blue-600 focus:ring-blue-600 sm:text-sm"
              id="confirmPassword"
              type="password"
              placeholder="******************"
              bind:value={confirmPassword}
            />
          </div>
          <button
            class="flex w-full items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-center text-sm font-medium text-white hover:bg-blue-700 focus:outline-none"
            type="submit"
            disabled={isLoading}
            style="min-width: 120px;"
          >
            {#if isLoading}
              <span>Registering...</span>
              <div class="ml-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
            {:else}
              Register
            {/if}
          </button>
          <p class="text-sm font-light">
            Already have an account?
            <button class="font-medium text-blue-600" on:click={() => goto('/login')}> Sign in </button>
          </p>
        </form>
      </div>
    </div>
  </div>
</main>
