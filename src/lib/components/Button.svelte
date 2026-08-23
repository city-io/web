<script lang="ts">
  export let variant: 'default' | 'primary' | 'danger' = 'default';
  export let type: 'button' | 'submit' = 'button';
  export let disabled = false;
  export let loading = false;
  let klass = '';
  export { klass as class };
</script>

<button {type} {disabled} class="btn {variant === 'primary' ? 'btn-primary' : variant === 'danger' ? 'btn-danger' : ''} {klass}" on:click>
  {#if loading}
    <span class="inline-flex items-center justify-center gap-2">
      <span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-stone-900/40 border-t-stone-900"></span>
      <slot name="loading">Working…</slot>
    </span>
  {:else}
    <slot />
  {/if}
</button>
