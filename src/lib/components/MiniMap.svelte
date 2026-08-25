<script lang="ts">
  import { onMount } from 'svelte';
  import { armies, cities, buildings, mapCenter, tiles, tileVisibility, userId, gameConfig } from '$lib/stores';
  import { tileKey } from '$lib/game/iso';
  import { TerrainType } from '$lib/gen/cityio/entity/v1/tile_pb';
  import { TileVisibilityState } from '$lib/gen/cityio/service/v1/state_pb';

  // A plain square overview (readability over iso fidelity). No new RPC — every
  // pixel comes from the stores already loaded by the game layout.
  export let onPan: (col: number, row: number) => void = () => {};
  // Visible tile span of the main viewport, for the viewport rectangle.
  export let viewCols = 0;
  export let viewRows = 0;

  const SIZE = 150;
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 6;
  let canvas: HTMLCanvasElement;
  let raf = 0;
  let minimapZoom = MIN_ZOOM;
  let dragPointerId: number | null = null;
  let dragBounds: { cols: number; rows: number; left: number; top: number } | null = null;
  let terrainCanvas: HTMLCanvasElement | null = null;
  let terrainCacheDirty = true;

  $: mapWidth = $gameConfig.mapSize || 75;
  $: mapHeight = $gameConfig.mapSize || 75;
  $: minimapWidth = mapHeight;
  $: minimapHeight = mapWidth;

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

  const visibilityAt = (x: number, y: number) => $tileVisibility.get(tileKey(x, y)) ?? TileVisibilityState.UNEXPLORED;

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  const toMinimap = (x: number, y: number) => ({ x: mapHeight - 1 - y, y: x });
  const fromMinimap = (x: number, y: number) => ({ x: y, y: mapHeight - 1 - x });

  const minimapBounds = () => {
    if (dragBounds) return dragBounds;
    const cols = minimapWidth / minimapZoom;
    const rows = minimapHeight / minimapZoom;
    const center = toMinimap($mapCenter.x, $mapCenter.y);
    return {
      cols,
      rows,
      left: clamp(center.x - cols / 2, 0, minimapWidth - cols),
      top: clamp(center.y - rows / 2, 0, minimapHeight - rows)
    };
  };

  const rebuildTerrainCache = () => {
    if (!terrainCanvas) terrainCanvas = document.createElement('canvas');
    if (terrainCanvas.width !== minimapWidth || terrainCanvas.height !== minimapHeight) {
      terrainCanvas.width = minimapWidth;
      terrainCanvas.height = minimapHeight;
    }
    const context = terrainCanvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#1d241f';
    context.fillRect(0, 0, minimapWidth, minimapHeight);
    for (const [key, visibility] of $tileVisibility) {
      if (visibility === TileVisibilityState.UNEXPLORED) continue;
      const tile = $tiles.get(key);
      const [fallbackX, fallbackY] = key.split(',').map(Number);
      const x = tile?.tileId?.x ?? fallbackX;
      const y = tile?.tileId?.y ?? fallbackY;
      const position = toMinimap(x, y);
      const color = terrainColor(tile?.terrain ?? TerrainType.GRASSLAND);
      context.fillStyle = visibility === TileVisibilityState.VISIBLE ? color : `${color}88`;
      context.fillRect(position.x, position.y, 1, 1);
    }
    terrainCacheDirty = false;
  };

  const draw = () => {
    raf = 0;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { cols, rows, left, top } = minimapBounds();
    const scaleX = SIZE / cols;
    const scaleY = SIZE / rows;

    if (terrainCacheDirty || !terrainCanvas) rebuildTerrainCache();
    ctx.imageSmoothingEnabled = false;
    if (terrainCanvas) ctx.drawImage(terrainCanvas, left, top, cols, rows, 0, 0, SIZE, SIZE);

    // City territories as owner-colored blocks.
    for (const c of $cities) {
      if (!c.start) continue;
      const own = c.owner?.value === $userId;
      if (!own && visibilityAt(c.start.x, c.start.y) !== TileVisibilityState.VISIBLE) continue;
      const position = toMinimap(c.start.x, c.start.y + c.size - 1);
      ctx.fillStyle = own ? 'rgba(68,153,255,0.5)' : c.owner ? 'rgba(221,68,68,0.5)' : 'rgba(153,153,153,0.4)';
      ctx.fillRect(Math.floor((position.x - left) * scaleX), Math.floor((position.y - top) * scaleY), Math.ceil(c.size * scaleX), Math.ceil(c.size * scaleY));
    }

    // Buildings as bright pixels.
    ctx.fillStyle = '#e8c37a';
    for (const b of $buildings) {
      if (!b.coords) continue;
      if (visibilityAt(b.coords.x, b.coords.y) !== TileVisibilityState.VISIBLE) continue;
      const position = toMinimap(b.coords.x, b.coords.y);
      ctx.fillRect(Math.floor((position.x - left) * scaleX), Math.floor((position.y - top) * scaleY), Math.max(1, scaleX), Math.max(1, scaleY));
    }

    // Armies use owner colors and a slightly larger dot than buildings.
    for (const army of $armies) {
      if (!army.coords) continue;
      if (visibilityAt(army.coords.x, army.coords.y) !== TileVisibilityState.VISIBLE) continue;
      const position = toMinimap(army.coords.x, army.coords.y);
      ctx.fillStyle = army.owner?.value === $userId ? '#60a5fa' : '#f87171';
      ctx.fillRect(Math.floor((position.x - left) * scaleX) - 1, Math.floor((position.y - top) * scaleY) - 1, Math.max(2, scaleX + 1), Math.max(2, scaleY + 1));
    }

    // Viewport rectangle from the live map center + visible span.
    if (viewCols > 0 && viewRows > 0) {
      const center = toMinimap($mapCenter.x, $mapCenter.y);
      const vx = (center.x - viewRows / 2 - left) * scaleX;
      const vy = (center.y - viewCols / 2 - top) * scaleY;
      ctx.strokeStyle = '#efe2c4';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(vx) + 0.5, Math.round(vy) + 0.5, Math.round(viewRows * scaleX), Math.round(viewCols * scaleY));
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
  };

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(draw);
  };

  $: if ($tiles || $tileVisibility || minimapWidth || minimapHeight) {
    terrainCacheDirty = true;
    schedule();
  }

  // Redraw when any source changes ($mapCenter is an object, always truthy —
  // the condition exists only to register the reactive dependencies).
  $: if ($tiles || $tileVisibility || $cities || $buildings || $armies || $mapCenter || mapWidth || mapHeight || viewCols || viewRows || minimapZoom) schedule();

  onMount(() => {
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    draw();
    return () => {
      canvas.removeEventListener('wheel', handleWheel);
      if (raf) cancelAnimationFrame(raf);
    };
  });

  const panFromPointer = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    const { cols, rows, left, top } = minimapBounds();
    const position = fromMinimap(left + ((clientX - rect.left) / rect.width) * cols, top + ((clientY - rect.top) / rect.height) * rows);
    const col = clamp(Math.round(position.x), 0, mapWidth - 1);
    const row = clamp(Math.round(position.y), 0, mapHeight - 1);
    onPan(col, row);
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragBounds = minimapBounds();
    dragPointerId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    panFromPointer(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (e.pointerId !== dragPointerId) return;
    panFromPointer(e.clientX, e.clientY);
  };

  const finishPointerDrag = (e: PointerEvent, panToPointer: boolean) => {
    if (e.pointerId !== dragPointerId) return;
    if (panToPointer) panFromPointer(e.clientX, e.clientY);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    dragPointerId = null;
    dragBounds = null;
    schedule();
  };

  const setMinimapZoom = (zoom: number) => {
    minimapZoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  };

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const deltaPixels = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? e.deltaY * SIZE : e.deltaY;
    const factor = Math.exp(-deltaPixels * 0.0015);
    setMinimapZoom(minimapZoom * clamp(factor, 1 / 1.25, 1.25));
  };
</script>

<div class="relative overflow-hidden rounded-lg border border-white/[0.1] bg-[#101512]/90 p-1 shadow-[0_12px_36px_rgba(0,0,0,0.22)] backdrop-blur-md">
  <canvas
    bind:this={canvas}
    width={SIZE}
    height={SIZE}
    class="block touch-none rounded {dragPointerId === null ? 'cursor-action-custom' : 'cursor-map-drag'}"
    style="image-rendering: pixelated; width: {SIZE}px; height: {SIZE}px"
    on:pointerdown={handlePointerDown}
    on:pointermove={handlePointerMove}
    on:pointerup={(e) => finishPointerDrag(e, true)}
    on:pointercancel={(e) => finishPointerDrag(e, false)}
  ></canvas>
  <div class="absolute right-2 top-2 flex overflow-hidden border border-white/15 bg-[#101512]/90 text-[9px] font-bold text-white/75 shadow-md">
    <button
      class="h-5 w-5 border-r border-white/10 hover:bg-white/10 hover:text-white disabled:opacity-30"
      type="button"
      aria-label="Zoom minimap out"
      title="Zoom minimap out"
      disabled={minimapZoom <= MIN_ZOOM}
      on:click={() => setMinimapZoom(minimapZoom / 1.4)}>−</button
    >
    <button
      class="h-5 w-5 hover:bg-white/10 hover:text-white disabled:opacity-30"
      type="button"
      aria-label="Zoom minimap in"
      title="Zoom minimap in"
      disabled={minimapZoom >= MAX_ZOOM}
      on:click={() => setMinimapZoom(minimapZoom * 1.4)}>+</button
    >
  </div>
</div>
