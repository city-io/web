<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<div class="min-h-screen bg-stone-900 text-stone-100">
  {@render children()}
</div>
