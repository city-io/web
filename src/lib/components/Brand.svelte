<script lang="ts">
  // Civ2-style wordmark: a bronze-riveted keep glyph + pixel-font title.
  export let size: 'sm' | 'lg' = 'lg';
  export let tagline: string | undefined = undefined;
</script>

<div class="flex flex-col items-center text-center">
  <div class="mb-4 flex items-center justify-center rounded-panel border border-bronze-700 bg-gradient-to-br from-bronze-400 to-bronze-600 shadow-bevel {size === 'lg' ? 'h-14 w-14' : 'h-10 w-10'}">
    <svg viewBox="0 0 24 24" fill="none" class="{size === 'lg' ? 'h-8 w-8' : 'h-6 w-6'} text-stone-900">
      <path d="M4 20V9l4-2v3l4-2v3l4-2v11H4z" fill="currentColor" opacity="0.95" />
      <path d="M8 20v-4h3v4M14 20v-5h3v5" stroke="rgba(0,0,0,0.35)" stroke-width="1" />
    </svg>
  </div>
  <h1 class="font-display text-bronze-300 {size === 'lg' ? 'text-2xl' : 'text-lg'}" style="text-shadow: 2px 2px 0 rgba(0,0,0,0.6)">city.io</h1>
  {#if tagline}
    <p class="mt-3 text-sm text-stone-300">{tagline}</p>
  {/if}
</div>
