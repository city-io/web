<script lang="ts">
  import { WS_CODE, WS_HOST } from "$lib/constants";
  import { capital, email, lastMapFetch, map, mapCenter, token, user, userId, ws } from "$lib/stores";
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';

  let app: Application;
  let container: Container;

  const tileSize = 64; // Tile size (64x64)
  let visibleWidth = 9 * tileSize;
  let visibleHeight = 7 * tileSize;

  const minZoom = 0.5;
  const maxZoom = 2;
  let currentZoom = 1;

  const fetchThreshold = 1;;

  onMount(async () => {
    await initializePixi();
    getMapTiles($mapCenter);

    return () => {
      if (app) {
        app.destroy(true, { children: true });
      }
    };
  });

  // $: console.log($mapCenter);

  const getCenter = (): { x: number; y: number } => {
    if (!container) {
      return { x: 0, y: 0 };
    }
    return {
      x: (-container.x + visibleWidth / 2 - tileSize / 2) / tileSize,
      y: (-container.y + visibleHeight / 2 - tileSize / 2) / tileSize,
    };
  }

  const getMapTiles = (center: { x: number, y: number }) => {
    if ($ws) {
      $ws.send(JSON.stringify({ req: WS_CODE.REQ_MAP, data: { x: Math.floor(center.x), y: Math.floor(center.y), radius: 5 } }));
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

  let loadedTiles = new Map();

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

    const startX = Math.floor(offsetX / tileSize);
    const endX = Math.min(Math.ceil((offsetX + visibleWidth) / tileSize), mapWidth);

    const startY = Math.floor(offsetY / tileSize);
    const endY = Math.min(Math.ceil((offsetY + visibleHeight) / tileSize), mapHeight);

    let fetch = false;
    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) {
          continue;
        }
        const tileKey = `${x},${y}`;
        if (!loadedTiles.has(tileKey)) {
          const tileData = $map[y][x];

          const graphics = new Graphics();
          graphics.rect(0, 0, tileSize, tileSize);
          graphics.x = x * tileSize;
          graphics.y = y * tileSize;

          let text = `(${tileData.x}, ${tileData.y})`;
          if (!tileData.fetched) {
            text = "...";
            fetch = true;
          }
          else if (tileData.building) {
            text = `${tileData.building.type}`;
          }
          else if (tileData.city) {
            text = `${tileData.city.type}`;
          }
          const tileText = new Text({
            text,
            style: {
              fontSize: 64,
              fill: "black",
              align: "center",
            }
          });
          tileText.x = x * tileSize;
          tileText.y = y * tileSize;
          tileText.width = tileSize;
          tileText.height = tileSize;

          container.addChild(graphics);
          container.addChild(tileText);

          if (tileData.fetched)
            loadedTiles.set(tileKey, { graphics, tileText });
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
        const newPosition = event.data.global.clone();
        container.x = container.containerStart.x + (newPosition.x - container.dragStart.x);
        container.y = container.containerStart.y + (newPosition.y - container.dragStart.y);

        const center = getCenter();
        if (Math.abs(center.x - $lastMapFetch.x) > fetchThreshold || Math.abs(center.y - $lastMapFetch.y) > fetchThreshold) {
          console.log(`Last fetch: ${$lastMapFetch.x}, ${$lastMapFetch.y}`);
          console.log(`Center: ${center.x}, ${center.y}`);
          getMapTiles(getCenter());
          lastMapFetch.set(getCenter());
          loadVisibleTiles();
        }

        mapCenter.set(getCenter());
      }
    });

    container.on("pointerup", () => (container.dragging = false));
    container.on("pointerupoutside", () => (container.dragging = false));
  };

  const centerCamera = (x: number, y: number) => {
    container.x = Math.min(0, -(x * tileSize - visibleWidth / 2 + tileSize / 2))
    container.y = Math.min(0, -(y * tileSize - visibleHeight / 2 + tileSize / 2))
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
  </div>
</div>
