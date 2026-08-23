<script lang="ts">
  import { onMount } from 'svelte';
  import { armies, cities, buildings, mapCenter, tiles, userId, gameConfig } from '$lib/stores';
  import { tileKey } from '$lib/game/iso';
  import { TerrainType } from '$lib/gen/cityio/entity/v1/tile_pb';

  // A plain square overview (readability over iso fidelity). No new RPC — every
  // pixel comes from the stores already loaded by the game layout.
  export let onPan: (col: number, row: number) => void = () => {};
  // Visible tile span of the main viewport, for the viewport rectangle.
  export let viewCols = 0;
  export let viewRows = 0;

  const SIZE = 150;
  let canvas: HTMLCanvasElement;
  let raf = 0;

  $: mapWidth = $gameConfig.mapSize || 75;
  $: mapHeight = $gameConfig.mapSize || 75;

  const terrainColor = (type: TerrainType) => {
    switch (type) {
      case TerrainType.PLAINS:
        return '#9c9a4b';
      case TerrainType.FOREST:
        return '#315f2f';
      case TerrainType.HILLS:
        return '#777a4e';
      case TerrainType.MOUNTAINS:
        return '#858679';
      case TerrainType.DESERT:
        return '#c29a4b';
      case TerrainType.MARSH:
        return '#42635a';
      case TerrainType.WATER:
        return '#315fa3';
      default:
        return '#5f963e';
    }
  };

  const isVisible = (x: number, y: number) => {
    const ownedCities = $cities.filter((city) => city.owner?.value === $userId && city.start);
    if (ownedCities.length === 0) return true;
    return ownedCities.some((city) => {
      const start = city.start!;
      const dx = Math.max(start.x - x, x - (start.x + city.size - 1), 0);
      const dy = Math.max(start.y - y, y - (start.y + city.size - 1), 0);
      return Math.max(dx, dy) <= $gameConfig.visionRadius;
    });
  };

  const draw = () => {
    raf = 0;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scaleX = SIZE / mapWidth;
    const scaleY = SIZE / mapHeight;

    ctx.fillStyle = '#1d241f';
    ctx.fillRect(0, 0, SIZE, SIZE);

    if ($tiles.size) {
      for (let y = 0; y < mapHeight; y++) {
        for (let x = 0; x < mapWidth; x++) {
          if (!isVisible(x, y)) continue;
          ctx.fillStyle = terrainColor($tiles.get(tileKey(x, y))?.terrain ?? TerrainType.GRASSLAND);
          ctx.fillRect(Math.floor(x * scaleX), Math.floor(y * scaleY), Math.ceil(scaleX), Math.ceil(scaleY));
        }
      }
    }

    // City territories as owner-colored blocks.
    for (const c of $cities) {
      if (!c.start) continue;
      const own = c.owner?.value === $userId;
      if (!own && !isVisible(c.start.x, c.start.y)) continue;
      ctx.fillStyle = own ? 'rgba(68,153,255,0.5)' : c.owner ? 'rgba(221,68,68,0.5)' : 'rgba(153,153,153,0.4)';
      ctx.fillRect(Math.floor(c.start.x * scaleX), Math.floor(c.start.y * scaleY), Math.ceil(c.size * scaleX), Math.ceil(c.size * scaleY));
    }

    // Buildings as bright pixels.
    ctx.fillStyle = '#e8c37a';
    for (const b of $buildings) {
      if (!b.coords) continue;
      if (!isVisible(b.coords.x, b.coords.y)) continue;
      ctx.fillRect(Math.floor(b.coords.x * scaleX), Math.floor(b.coords.y * scaleY), Math.max(1, scaleX), Math.max(1, scaleY));
    }

    // Armies use owner colors and a slightly larger dot than buildings.
    for (const army of $armies) {
      if (!army.coords) continue;
      if (!isVisible(army.coords.x, army.coords.y)) continue;
      ctx.fillStyle = army.owner?.value === $userId ? '#60a5fa' : '#f87171';
      ctx.fillRect(Math.floor(army.coords.x * scaleX) - 1, Math.floor(army.coords.y * scaleY) - 1, Math.max(2, scaleX + 1), Math.max(2, scaleY + 1));
    }

    // Viewport rectangle from the live map center + visible span.
    if (viewCols > 0 && viewRows > 0) {
      const vx = ($mapCenter.x - viewCols / 2) * scaleX;
      const vy = ($mapCenter.y - viewRows / 2) * scaleY;
      ctx.strokeStyle = '#efe2c4';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(vx) + 0.5, Math.round(vy) + 0.5, Math.round(viewCols * scaleX), Math.round(viewRows * scaleY));
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
  };

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(draw);
  };

  // Redraw when any source changes ($mapCenter is an object, always truthy —
  // the condition exists only to register the reactive dependencies).
  $: if ($tiles || $cities || $buildings || $armies || $mapCenter || viewCols || viewRows) schedule();

  onMount(() => {
    draw();
    return () => raf && cancelAnimationFrame(raf);
  });

  const handleClick = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const col = Math.round(((e.clientX - rect.left) / rect.width) * mapWidth);
    const row = Math.round(((e.clientY - rect.top) / rect.height) * mapHeight);
    onPan(col, row);
  };
</script>

<div class="overflow-hidden rounded-lg border border-white/[0.1] bg-[#101512]/90 p-1 shadow-[0_12px_36px_rgba(0,0,0,0.22)] backdrop-blur-md">
  <canvas bind:this={canvas} width={SIZE} height={SIZE} class="block cursor-pointer rounded" style="image-rendering: pixelated; width: {SIZE}px; height: {SIZE}px" on:click={handleClick}></canvas>
</div>
