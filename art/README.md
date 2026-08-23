# Terrain source art

`source/terrain-atlas-source.png` is the original high-resolution source used for `static/sprites/terrain.png`. The runtime atlas contains four curated 68×72 frames for each backend terrain type, with a common tile center at y=48.

The source was generated with the built-in image generation tool using this prompt:

> Create one clean sprite sheet containing original isometric terrain tiles for a classic mid-1990s PC turn-based strategy game. Arrange it as an exact 8-column by 4-row grid, with grassland, plains, forest, hills, mountains, desert, marsh, and water from left to right and four variants per terrain. Use a shared limited palette, crisp chunky pixel clusters, sparse dithering, irregular natural silhouettes, and a transparent background. Keep every 2:1 diamond at the same footprint and camera angle. Include no text, UI, buildings, roads, units, borders, selection marks, logos, or watermark. Do not reproduce an existing game's sprites.

Mixed-terrain variants from the generated source are intentionally excluded from the runtime atlas. The runtime renderer adds shoreline and terrain-edge masks from neighboring backend tiles; those masks do not alter the authoritative terrain data.
