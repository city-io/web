<script lang="ts">
  import { API_HOST } from '$lib/constants';
  import { capital as capitalStore, mapCenter, token, user } from '$lib/stores';

  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  onMount(async () => {
    const response = await fetch(`${API_HOST}/users/validate`, {
      headers: {
        Authorization: `Bearer ${$token}`
      }
    });

    if (response.ok) {
      const { capital, email, username, userId } = await response.json();
      user.set({ email, username, userId });
      capitalStore.set(capital);
      mapCenter.set({ x: capital.startX + 2, y: capital.startY + 2 });

      goto('/game');
    } else {
      goto('/login');
    }
  });
</script>
