<script lang="ts">
  import { onMount } from 'svelte';
  import { armies, cities, buildings, mapCenter, userId, gameConfig } from '$lib/stores';

  // A plain square overview (readability over iso fidelity). No new RPC — every
  // pixel comes from the stores already loaded by the game layout.
  export let onPan: (col: number, row: number) => void = () => {};
  // Visible tile span of the main viewport, for the viewport rectangle.
  export let viewCols = 0;
  export let viewRows = 0;

  const SIZE = 150;
  let canvas: HTMLCanvasElement;
  let raf = 0;

  $: N = $gameConfig.mapSize || 75;

  const draw = () => {
    raf = 0;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = SIZE / N;

    // Backdrop — undiscovered terrain.
    ctx.fillStyle = '#101512';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // City territories as owner-colored blocks.
    for (const c of $cities) {
      if (!c.start) continue;
      const own = c.owner?.value === $userId;
      ctx.fillStyle = own ? 'rgba(68,153,255,0.5)' : c.owner ? 'rgba(221,68,68,0.5)' : 'rgba(153,153,153,0.4)';
      ctx.fillRect(Math.floor(c.start.x * s), Math.floor(c.start.y * s), Math.ceil(c.size * s), Math.ceil(c.size * s));
    }

    // Buildings as bright pixels.
    ctx.fillStyle = '#e8c37a';
    for (const b of $buildings) {
      if (!b.coords) continue;
      ctx.fillRect(Math.floor(b.coords.x * s), Math.floor(b.coords.y * s), Math.max(1, s), Math.max(1, s));
    }

    // Armies use owner colors and a slightly larger dot than buildings.
    for (const army of $armies) {
      if (!army.coords) continue;
      ctx.fillStyle = army.owner?.value === $userId ? '#60a5fa' : '#f87171';
      ctx.fillRect(Math.floor(army.coords.x * s) - 1, Math.floor(army.coords.y * s) - 1, Math.max(2, s + 1), Math.max(2, s + 1));
    }

    // Viewport rectangle from the live map center + visible span.
    if (viewCols > 0 && viewRows > 0) {
      const vx = ($mapCenter.x - viewCols / 2) * s;
      const vy = ($mapCenter.y - viewRows / 2) * s;
      ctx.strokeStyle = '#efe2c4';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(vx) + 0.5, Math.round(vy) + 0.5, Math.round(viewCols * s), Math.round(viewRows * s));
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
  };

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(draw);
  };

  // Redraw when any source changes ($mapCenter is an object, always truthy —
  // the condition exists only to register the reactive dependencies).
  $: if ($cities || $buildings || $armies || $mapCenter || viewCols || viewRows) schedule();

  onMount(() => {
    draw();
    return () => raf && cancelAnimationFrame(raf);
  });

  const handleClick = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const col = Math.round(((e.clientX - rect.left) / rect.width) * N);
    const row = Math.round(((e.clientY - rect.top) / rect.height) * N);
    onPan(col, row);
  };
</script>

<div class="overflow-hidden rounded-lg border border-white/[0.1] bg-[#101512]/90 p-1 shadow-[0_12px_36px_rgba(0,0,0,0.22)] backdrop-blur-md">
  <canvas bind:this={canvas} width={SIZE} height={SIZE} class="block cursor-pointer rounded" style="image-rendering: pixelated; width: {SIZE}px; height: {SIZE}px" on:click={handleClick}></canvas>
</div>
