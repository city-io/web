<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';

  // Labeled field with optional show/hide toggle for passwords. Absorbs the
  // duplicated markup that used to live in login/register.
  export let id: string;
  export let label: string;
  export let value = '';
  export let type: 'text' | 'email' | 'password' = 'text';
  export let placeholder = '';
  export let autocomplete: HTMLInputAttributes['autocomplete'] = undefined;
  export let invalid = false;

  let show = false;
  $: effectiveType = type === 'password' && show ? 'text' : type;
</script>

<div>
  <label for={id} class="field-label">{label}</label>
  <div class="relative">
    <input
      {id}
      type={effectiveType}
      {placeholder}
      {autocomplete}
      class="field {type === 'password' ? 'pr-10' : ''} {invalid ? 'border-red-700 focus:border-red-600 focus:ring-red-600/40' : ''}"
      bind:value
    />
    {#if type === 'password'}
      <button
        type="button"
        class="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-stone-400 transition-colors hover:text-bronze-300"
        aria-label={show ? 'Hide password' : 'Show password'}
        on:click={() => (show = !show)}
      >
        {#if show}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4"
            ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.4 5.1A9.8 9.8 0 0112 5c5 0 9 4 9 7a11 11 0 01-2.3 3.2M6.2 6.2A11 11 0 003 12c0 3 4 7 9 7 1.2 0 2.3-.2 3.3-.6"
            /></svg
          >
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-4 w-4"
            ><path stroke-linecap="round" stroke-linejoin="round" d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="2.5" /></svg
          >
        {/if}
      </button>
    {/if}
  </div>
  <slot name="hint" />
</div>
