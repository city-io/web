<script lang="ts">
  import { WS_HOST } from '$lib/constants';
  import { capital, map, token, ws } from '$lib/stores';

  import { goto } from '$app/navigation';

  import { onMount } from 'svelte';

  let websocket: WebSocket | null = null;
  let connected = false;

  onMount(() => {
    if (!$capital) {
      goto('/');
      return;
    }
    websocket = new WebSocket(`${WS_HOST}/ws?token=${$token}`);
    ws.set(websocket);

    websocket.onopen = () => {
      console.log('WebSocket connection opened');
      connected = true;
    };

    websocket.onmessage = (event) => {
      console.log('Message received');
      try {
        const tiles = JSON.parse(event.data);
        for (const tile of tiles) {
          $map[tile.y][tile.x] = tile;
        }
      } catch (error) {
        // ignore ping messages
      }
    };

    websocket.onclose = () => {
      console.log('WebSocket connection closed');
      connected = false;
    };

    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    setInterval(() => {
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({ req: 'ping' }));
      }
    }, 30000);
  });
</script>

{#if connected}
  <slot />
{/if}
