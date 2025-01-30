<script lang="ts">
  import { WS_CODE, WS_HOST } from '$lib/constants';
  import { capital, email, lastMapFetch, map, mapCenter, token, user, userId, ws } from '$lib/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { Application, Assets, Container, Sprite, Text, TextStyle } from 'pixi.js';

  let app: Application;
  let container: Container;

  const numTiles = 128;

  const tileSize = 130;
  let visibleWidth = 9 * tileSize;
  let visibleHeight = 6 * tileSize;

  const minZoom = 0.5;
  const maxZoom = 2;
  let currentZoom = 1;

  const fetchThreshold = 4;

  let loadedTiles = new Map<string, { sprite: Sprite }>();

  onMount(async () => {
    await initializePixi();
    getMapTiles($mapCenter);
    getMapTiles({ x: 6, y: 6 });

    return () => {
      if (app) {
        app.destroy(true, { children: true });
      }
    };
  });

  const initializePixi = async () => {
    app = new Application();
    await app.init({
      width: visibleWidth,
      height: visibleHeight,
      backgroundColor: 0xf0f0f0
    });

    document.getElementById('pixi-container')?.appendChild(app.canvas);

    container = new Container();
    app.stage.addChild(container);

    createMap();
    setupInteraction();
    loadVisibleTiles();
  };

  const createMap = () => {
    container.removeChildren();

    centerCamera($mapCenter.x, $mapCenter.y);
  };

  const convertToCanvas = (mapX: number, mapY: number): { x: number; y: number } => ({
    x: (mapX - mapY) * (tileSize / 2),
    y: (mapX + mapY) * (tileSize / 2)
  });

  const convertToMap = (canvasX: number, canvasY: number): { x: number; y: number } => ({
    x: Math.floor((canvasY / (tileSize / 2) + canvasX / (tileSize / 2)) / 2),
    y: Math.floor((canvasY / (tileSize / 2) - canvasX / (tileSize / 2)) / 2)
  });

  const getCenter = (): { x: number; y: number } => {
    if (!container) {
      return { x: 0, y: 0 };
    }

    const canvasX = -container.x + visibleWidth / 2 - tileSize;
    const canvasY = -container.y + visibleWidth / 2 - tileSize;
    return convertToMap(canvasX, canvasY);
  };

  const centerCamera = (x: number, y: number) => {
    const { x: containerX, y: containerY } = convertToCanvas(x, y);
    container.x = -containerX + visibleWidth / 2 - tileSize / 2;
    container.y = -containerY + visibleHeight / 2 - tileSize / 2;
  };

  const getMapTiles = (center: { x: number; y: number }) => {
    if ($ws) {
      $ws.send(JSON.stringify({ req: WS_CODE.REQ_MAP, data: { x: Math.floor(center.x), y: Math.floor(center.y), radius: 14 } }));
    }
  };

  const logout = async () => {
    if ($ws) {
      $ws.close();
      ws.set(null);
    }
    token.set(undefined);
    user.set(undefined);
    capital.set(undefined);
    goto('/login');
  };

  const renderTile = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= numTiles || y >= numTiles) return false;

    let fetch = false;
    const tileKey = `${x},${y}`;
    if (!loadedTiles.has(tileKey)) {
      const tileData = $map[y][x];

      if (!tileData.fetched) {
        fetch = true;
      } else {
        const { x: spriteX, y: spriteY } = convertToCanvas(x, y);
        Assets.load('/grass1.png').then((texture) => {
          const sprite = new Sprite(texture);
          sprite.x = spriteX;
          sprite.y = spriteY;
          sprite.width = tileSize;
          sprite.height = tileSize;
          sprite.zIndex = spriteY * tileSize + spriteX;
          container.addChild(sprite);
          loadedTiles.set(tileKey, { sprite });
        });

        const text = new Text({
          text: tileData.building ? tileData.building.type : tileData.city ? tileData.city.type : `(${tileData.x}, ${tileData.y})`,
          style: {
            fontSize: 64,
            fill: 'black',
            align: 'center'
          }
        });
        text.x = spriteX + tileSize / 4;
        text.y = spriteY + tileSize / 8;
        text.width = tileSize / 2;
        text.height = tileSize / 2;
        text.zIndex = spriteY * tileSize + spriteX + 1;
        container.addChild(text);
      }
    }
    return fetch;
  };

  const loadVisibleTiles = () => {
    const mapWidth = $map[0].length;
    const mapHeight = $map.length;

    const offsetX = -container.x;
    const offsetY = -container.y;

    const start = convertToMap(offsetX, offsetY);
    console.log(start);

    let fetch = false;

    // start at -1 to pre-render tiles that are partially visible
    for (let dx = -1; dx < visibleWidth / tileSize + 1; dx++) {
      for (let dy = -1; dy < visibleHeight / tileSize + 1; dy++) {
        const x = start.x + dx + dy;
        const y = start.y - dx + dy;

        fetch = fetch || renderTile(x, y);
        fetch = fetch || renderTile(x, y + 1);
      }
    }

    if (fetch) requestAnimationFrame(loadVisibleTiles);
  };

  const setupInteraction = () => {
    container.interactive = true;
    container.on('pointerdown', (event) => {
      container.dragging = true;
      container.dragStart = event.data.global.clone();
      container.containerStart = container.position.clone();
    });

    container.on('pointermove', (event) => {
      if (container.dragging) {
        const center = getCenter();
        // TODO: add camera restrictions
        const newPosition = event.data.global.clone();
        container.x = container.containerStart.x + (newPosition.x - container.dragStart.x);
        container.y = container.containerStart.y + (newPosition.y - container.dragStart.y);

        if (Math.abs(center.x - $lastMapFetch.x) > fetchThreshold || Math.abs(center.y - $lastMapFetch.y) > fetchThreshold) {
          console.log(`Center: ${center.x}, ${center.y}`);
          getMapTiles(center);
          lastMapFetch.set(center);
        }
        loadVisibleTiles();

        mapCenter.set(center);
      }
    });

    container.on('pointerup', () => (container.dragging = false));
    container.on('pointerupoutside', () => (container.dragging = false));

    // Zoom interaction
    container.on('wheel', (event) => {
      container.stage.x = container.containerStart.width / 100;
      container.stage.y = container.containerStart.height / 100;
    });
  };
</script>

<div class="flex h-screen w-screen overflow-hidden">
  <div id="pixi-container" class="map-container flex h-full overflow-hidden"></div>
  <div class="sidebar flex-1 bg-gray-100">
    <div class="flex items-center justify-between p-4">
      <div class="text-lg">{$user.username}</div>
      <div class="text-sm text-gray-600">Gold: {$user.gold}</div>
      <div class="text-sm text-gray-600">Food: {$user.food}</div>
      <button class="text-sm text-gray-600" on:click={logout}>Logout</button>
    </div>
    <p>Map Center: {$mapCenter.x}, {$mapCenter.y}</p>
  </div>
</div>
