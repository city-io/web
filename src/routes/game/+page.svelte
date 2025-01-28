<script lang="ts">
  import { WS_CODE, WS_HOST } from "$lib/constants";
  import { capital, email, lastMapFetch, map, mapCenter, token, user, userId, ws } from "$lib/stores";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { Application, Assets, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';

  let app: Application;
  let container: Container;

  const tileSize = 130; // Tile size (64x64)
  let visibleWidth = 9 * tileSize;
  let visibleHeight = 6 * tileSize;

  const minZoom = 0.5;
  const maxZoom = 2;
  let currentZoom = 1;

  const fetchThreshold = 1;

  onMount(async () => {
    await initializePixi();
    getMapTiles($mapCenter);

    return () => {
      if (app) {
        app.destroy(true, { children: true });
      }
    };
  });

  const convertToCanvas = (x: number, y: number): { x: number, y: number } => {
    const canvasY = y * tileSize / 2;
    const canvasX = x * tileSize + (canvasY % 2) * tileSize / 2;
    return {
      x: canvasX,
      y: canvasY,
    };
  };

  const convertToMap = (canvasX: number, canvasY: number): { x: number, y: number } => {
    const y = Math.floor(canvasY / (tileSize / 2));
    const x = Math.floor((canvasX - (y % 2) * tileSize / 2) / tileSize);
    return { x, y };
  };

  const getCenter = (): { x: number, y: number } => {
    if (!container) {
      return { x: 0, y: 0 };
    }
    const canvasY = (-container.y + visibleHeight / 2 - (tileSize / 2)) / (tileSize / 2);
    const canvasX = ((-container.x + visibleWidth / 2 - (tileSize / 2)) - (canvasY % 2) * tileSize / 2) / tileSize;

    return { x: canvasX, y: canvasY };
  };

  const centerCamera = (x: number, y: number) => {
    const { x: containerX, y: containerY } = convertToCanvas(x, y);
    container.x = -containerX + visibleWidth / 2 - (tileSize / 2);
    container.y = -containerY + visibleHeight / 2 - (tileSize / 2);
  };

  const getMapTiles = (center: { x: number, y: number }) => {
    if ($ws) {
      $ws.send(JSON.stringify({ req: WS_CODE.REQ_MAP, data: { x: Math.floor(center.x), y: Math.floor(center.y), radius: 6 } }));
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
    goto("/login");
  };

  let loadedTiles = new Map<string, { sprite: Sprite }>();

  const initializePixi = async () => {
    app = new Application();
    await app.init({
      width: visibleWidth,
      height: visibleHeight,
      backgroundColor: 0xf0f0f0,
    });

    document.getElementById("pixi-container").appendChild(app.canvas);

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

  const loadVisibleTiles = () => {
    const mapWidth = $map[0].length;
    const mapHeight = $map.length;

    const offsetX = -container.x;
    const offsetY = -container.y;

    const start = convertToMap(offsetX, offsetY);
    const end = convertToMap(offsetX + visibleWidth, offsetY + visibleHeight);

    console.log(start, end);

    let fetch = false;
    for (let y = start.y - 1; y < end.y; y++) {
      for (let x = start.x; x < end.x + 1; x++) {
        if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) {
          continue;
        }
        const tileKey = `${x},${y}`;
        if (!loadedTiles.has(tileKey)) {
          const tileData = $map[y][x];

          let text = '...';
          if (!tileData.fetched) {
            fetch = true;
          }
          else {
            const { x: spriteX, y: spriteY } = convertToCanvas(x, y);
            Assets.load('/grass1.png').then((texture) => {
              const sprite = new Sprite(texture);
              sprite.x = spriteX;
              sprite.y = spriteY;
              sprite.width = tileSize;
              sprite.height = tileSize;
              sprite.zIndex = spriteY * mapWidth + spriteX;
              container.addChild(sprite);
              loadedTiles.set(tileKey, { sprite });
            })

            const text = new Text({
              text: tileData.building
                ? tileData.building.type
                : tileData.city
                ? tileData.city.type
                : `(${tileData.x}, ${tileData.y})`,
              style: {
                fontSize: 64,
                fill: "black",
                align: "center",
              }
            });
            text.x = spriteX + tileSize / 4;
            text.y = spriteY + tileSize / 8;
            text.width = tileSize / 2;
            text.height = tileSize / 2;
            text.zIndex = spriteY * mapWidth + spriteX + 1;
            container.addChild(text);
          }
        }
      }
    }

    if (fetch)
      requestAnimationFrame(loadVisibleTiles);
  };

  const setupInteraction = () => {
    container.interactive = true;
    container.on("pointerdown", (event) => {
      container.dragging = true;
      container.dragStart = event.data.global.clone();
      container.containerStart = container.position.clone();
    });

    container.on("pointermove", (event) => {
      if (container.dragging) {
        const center = getCenter();
        // add camera restrictions
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

    container.on("pointerup", () => (container.dragging = false));
    container.on("pointerupoutside", () => (container.dragging = false));
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
