<script lang="ts">
  export let size: 'sm' | 'lg' = 'lg';
  export let tagline: string | undefined = undefined;
</script>

<div class="flex flex-col items-center text-center">
  <h1 class="font-semibold text-[#f2f4f2] {size === 'lg' ? 'text-3xl' : 'text-xl'}">city<span class="text-[#9fc39d]">.</span>io</h1>
  {#if tagline}
    <p class="mt-3 text-sm text-[#929a94]">{tagline}</p>
  {/if}
</div>
