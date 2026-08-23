<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<div class="min-h-screen bg-[#0e110f] text-[#edf0ed]">
  {@render children()}
</div>
