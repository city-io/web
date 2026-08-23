<script lang="ts">
  export let title: string | undefined = undefined;
  let klass = '';
  export { klass as class };
</script>

<div class="panel {klass}">
  {#if title}
    <div class="border-b border-white/[0.08] px-4 py-3">
      <span class="panel-title">{title}</span>
    </div>
  {/if}
  <div class="p-4">
    <slot />
  </div>
</div>
