<script lang="ts">
  // Beveled Civ2 stone panel. Optional title renders a bronze pixel-font header.
  export let title: string | undefined = undefined;
  let klass = '';
  export { klass as class };
</script>

<div class="panel {klass}">
  {#if title}
    <div class="border-b border-stone-950/60 px-3 py-2">
      <span class="panel-title">{title}</span>
    </div>
  {/if}
  <div class={title ? 'p-3' : 'p-3'}>
    <slot />
  </div>
</div>
