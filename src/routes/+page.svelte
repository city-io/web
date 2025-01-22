<script lang="ts">
  import { API_HOST } from '$lib/constants';
  import { token } from '$lib/stores';

  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  onMount(async () => {
    const response = await fetch(`${API_HOST}/users/validate`, {
      headers: {
        Authorization: `Bearer ${$token}`
      }
    });
    
    if (response.ok) {
      goto('/game');
    } else {
      goto('/login');
    }
  });
</script>
