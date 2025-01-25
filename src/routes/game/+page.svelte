<script lang="ts">
  import { WS_CODE, WS_HOST } from '$lib/constants';
  import { capital, map, mapCenter, token, user, ws } from '$lib/stores';
  import { goto } from '$app/navigation';

  import { derived } from 'svelte/store';
  const xRadius = 4;
  const yRadius = 3;

  const logout = async () => {
    if ($ws) {
      $ws.close();
      ws.set(null);
    }
    token.set(undefined);
    user.set(undefined);
    capital.set(undefined);
    goto('/login');
  };

  const getMapTiles = () => {
    if ($ws) {
      $ws.send(JSON.stringify({ req: WS_CODE.REQ_MAP, data: { x: $capital.startX + 2, y: $capital.startY + 2, radius: 5 } }));
    }
  };

  const visibleTiles = derived([map, mapCenter], ([$map, $mapCenter]) => {
    let { x: cx, y: cy } = $mapCenter;
    let startX = cx - xRadius;
    let endX = cx + xRadius;
    let startY = cy - yRadius;
    let endY = cy + yRadius;

    if (startX < 0) {
      endX += Math.abs(startX);
      startX = 0;
    } else if (endX >= $map.length) {
      startX -= endX - $map.length + 1;
      endX = $map.length - 1;
    }
    if (startY < 0) {
      endY += Math.abs(startY);
      startY = 0;
    } else if (endY >= $map[0].length) {
      startY -= endY - $map[0].length + 1;
      endY = $map[0].length - 1;
    }

    return $map.slice(startY, endY + 1).map((row) => row.slice(startX, endX + 1));
  });

  getMapTiles();

  $: console.log($visibleTiles);
</script>

<div class="flex h-screen w-screen gap-1 overflow-hidden">
  <div class="map-container flex h-full overflow-hidden">
    <div class="grid gap-1" style="grid-template-columns: repeat(9, minmax(0, 1fr));">
      {#each $visibleTiles as row}
        {#each row as tile}
          <div class="tile flex h-32 w-36 items-center justify-center border border-gray-400 bg-gray-200">
            {#if tile.building}
              <div class="text-xs text-gray-600">{tile.building.type}</div>
            {:else if tile.city}
              <div class="text-xs text-gray-600">{tile.city.type}</div>
            {:else}
              {tile.x}, {tile.y}
            {/if}
          </div>
        {/each}
      {/each}
    </div>
  </div>
  <div class="sidebar flex-1 bg-gray-100">
    <div class="flex items-center justify-between p-4">
      <div class="text-lg font-semibold">Sidebar</div>
      <button class="text-sm text-gray-600" on:click={logout}>Logout</button>
    </div>
  </div>
</div>
