<script lang="ts">
  import { WS_CODE, WS_HOST } from '$lib/constants';
  import { capital, map, token, user, ws } from '$lib/stores';

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
      const message = JSON.parse(event.data);
      switch (message.msg) {
        case WS_CODE.MAP:
          const tiles = message.data;
          for (const tile of tiles) {
            $map[tile.y][tile.x] = {
              ...tile,
              fetched: true
            };
          }
          break;
        case WS_CODE.USER:
          const userData = message.data;
          user.set(userData);
          break;
        case WS_CODE.PONG:
          break;
        default:
          console.error('Unknown message:', message);
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
        websocket.send(JSON.stringify({ req: WS_CODE.PING }));
      }
    }, 30000);
  });
</script>

{#if connected}
  <slot />
{/if}
