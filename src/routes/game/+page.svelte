<script lang="ts">
  import { token } from '$lib/stores';

  import { goto } from '$app/navigation';

  const logout = async () => {
    token.set(undefined);
    goto('/login');
  };
</script>

<button on:click={logout}>Logout</button>
