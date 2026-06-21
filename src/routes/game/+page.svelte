<script lang="ts">
  import { buildings, cities, mapCenter, token, username, gold, food, foodIncomePerHour, foodUpkeepPerHour, userId, gameConfig } from '$lib/stores';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { Application, Container, Graphics, Rectangle, Sprite } from 'pixi.js';
  import { S, HEX_H, HEX_VERTS, hexToPixel, pixelToHex, tileKey, hexNeighbors } from '$lib/game/hex';
  import { getTileTexture, TILE_ANCHOR_X, TILE_ANCHOR_Y, type TileKind } from '$lib/game/tiles';
  import { ratePerHour, fmtPerHour, durationSeconds } from '$lib/game/rates';
  import type { City } from '$lib/gen/cityio/entity/v1/city_pb';
  import type { Building } from '$lib/gen/cityio/entity/v1/building_pb';
  import { BuildingType, CityType } from '$lib/gen/cityio/entity/v1/common_pb';
  import type { BuildingConfig, BuildingLevelStats, ResourceRate } from '$lib/gen/cityio/service/v1/config_pb';
  import type { Duration } from '@bufbuild/protobuf/wkt';
  import { mapClient, buildingClient, cityClient } from '$lib/api/client';

  // ── constants ──────────────────────────────────────────
  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 3;
  const CLICK_DIST = 5;

  // ── pixi state ──────────────────────────────────────────
  let app: Application;
  let cont: Container;
  let el: HTMLDivElement;
  let cw = 800,
    ch = 600;

  // drag
  let drag = false;
  let dsx = 0,
    dsy = 0,
    csx = 0,
    csy = 0;

  // tiles
  let loaded = new Map<string, Container>();
  let tileData = new Map<string, { city?: City; building?: Building }>();
  let constructionGfx = new Map<string, { gfx: Graphics; startMs: number; endMs: number; cx: number; cy: number }>();
  let selGfx: Graphics | null = null;

  // ── UI state ────────────────────────────────────────────
  let sel: { x: number; y: number; city?: City; building?: Building } | null = null;
  let myCities: City[] = [];
  let buildType: BuildingType = BuildingType.HOUSE;
  const placeTypes = [BuildingType.HOUSE, BuildingType.FARM, BuildingType.MINE, BuildingType.BARRACKS];
  let busy = false;
  let err = '';
  let showBuild = false;

  // ── live clock (1s tick for construction progress) ───────
  let now = Date.now();
  const tick = setInterval(() => {
    now = Date.now();
  }, 1000);
  onDestroy(() => clearInterval(tick));

  // ── names ───────────────────────────────────────────────
  const BN: Record<number, string> = {
    [BuildingType.CITY_CENTER]: 'City Center',
    [BuildingType.TOWN_CENTER]: 'Town Center',
    [BuildingType.BARRACKS]: 'Barracks',
    [BuildingType.HOUSE]: 'House',
    [BuildingType.FARM]: 'Farm',
    [BuildingType.MINE]: 'Mine'
  };
  const bName = (t: BuildingType) => BN[t] ?? 'Unknown';
  const cName = (t: CityType) => (t === CityType.CITY ? 'City' : t === CityType.TOWN ? 'Town' : 'Settlement');

  // ── building config helpers ─────────────────────────────
  const getBuildingConfig = (t: BuildingType): BuildingConfig | undefined => $gameConfig.buildings.find((b) => b.type === t);

  const getLevelStats = (t: BuildingType, level: number): BuildingLevelStats | undefined => getBuildingConfig(t)?.levels.find((l) => l.level === level);

  const fmtTime = (d?: Duration): string => {
    const s = durationSeconds(d);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };

  // One-shot amounts (build costs): plain "<n> <resource>".
  const fmtRes = (r: { resource: string; amount: bigint }): string => `${r.amount.toString()} ${r.resource}`;

  // Ongoing production flows, always normalized to per-hour: "<n>/hr <resource>".
  const fmtProd = (r: ResourceRate): string => `${Math.round(ratePerHour(r.rate)).toLocaleString()}/hr ${r.resource}`;

  // Net food into/out of the shared pool per hour across all owned cities.
  $: netFoodPerHour = $foodIncomePerHour - $foodUpkeepPerHour;

  // Live city state (food rates / starving) is pushed into the $cities store per
  // tick, while myCities is a one-shot snapshot — look up the fresh copy by id.
  $: liveCityById = new Map($cities.map((c) => [c.cityId?.value, c]));
  const liveCity = (c: City): City => liveCityById.get(c.cityId?.value) ?? c;

  const fmtCountdown = (ms: number): string => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };

  // ── reactive store sync ─────────────────────────────────
  // buildLookup is cheap (rebuilds a Map) — run synchronously so tileData is always fresh.
  // rebuildTiles is expensive (destroys/creates Pixi containers) — debounce via rAF.
  let renderPending = false;
  const scheduleRender = () => {
    if (renderPending || !cont) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      rebuildTiles();
    });
  };
  $: if ($cities || $buildings) {
    buildLookup();
    // Immediately hide construction overlays for finished/removed constructions
    for (const [k, entry] of constructionGfx) {
      const td = tileData.get(k);
      const active = td?.building?.constructionEnd && Number(td.building.constructionEnd.seconds) * 1000 > Date.now();
      if (!active) entry.gfx.visible = false;
    }
    if (sel) {
      const t = tileData.get(tileKey(sel.x, sel.y));
      sel = { x: sel.x, y: sel.y, ...t };
    }
    scheduleRender();
  }

  // ── tile data ───────────────────────────────────────────
  const buildLookup = () => {
    tileData.clear();
    for (const c of $cities) {
      if (!c.start) continue;
      for (let dx = 0; dx < c.size; dx++)
        for (let dy = 0; dy < c.size; dy++) {
          const k = tileKey(c.start.x + dx, c.start.y + dy);
          tileData.set(k, { ...tileData.get(k), city: c });
        }
    }
    for (const b of $buildings) {
      if (!b.coords) continue;
      const k = tileKey(b.coords.x, b.coords.y);
      tileData.set(k, { ...tileData.get(k), building: b });
    }
  };

  // ── visibility (fog of war) ─────────────────────────────
  const getVisDist = (col: number, row: number): number => {
    let min = Infinity;
    for (const city of myCities) {
      if (!city.start) continue;
      const sx = city.start.x,
        sy = city.start.y,
        s = city.size;
      const dx = Math.max(sx - col, col - (sx + s - 1), 0);
      const dy = Math.max(sy - row, row - (sy + s - 1), 0);
      min = Math.min(min, Math.max(dx, dy));
    }
    return min;
  };

  const getCenter = () => {
    if (!cont) return { x: 0, y: 0 };
    return pixelToHex((-cont.x + cw / 2) / cont.scale.x, (-cont.y + ch / 2) / cont.scale.y);
  };

  const clampCam = () => {
    if (!cont) return;
    const s = cont.scale.x;
    const pad = 200;
    const mapW = $gameConfig.mapSize * 1.5 * S;
    const mapH = $gameConfig.mapSize * HEX_H;
    const xMin = cw - mapW * s - pad;
    const xMax = pad;
    if (xMin < xMax) cont.x = Math.max(xMin, Math.min(xMax, cont.x));
    const yMin = ch - mapH * s - pad;
    const yMax = pad;
    if (yMin < yMax) cont.y = Math.max(yMin, Math.min(yMax, cont.y));
  };

  const centerCam = (col: number, row: number) => {
    const p = hexToPixel(col, row);
    cont.x = -p.x * cont.scale.x + cw / 2;
    cont.y = -p.y * cont.scale.y + ch / 2;
    clampCam();
  };

  // ── data actions ────────────────────────────────────────
  const rebuildTiles = () => {
    for (const [, c] of loaded) c.destroy({ children: true });
    loaded.clear();
    constructionGfx.clear();
    if (selGfx) {
      selGfx.destroy();
      selGfx = null;
    }
    loadVisible();
    if (sel) drawSel(sel.x, sel.y);
  };

  const loadCities = async () => {
    try {
      myCities = (await cityClient.listCities({})).entities?.cities ?? [];
      rebuildTiles();
    } catch {
      /* */
    }
  };

  const doAction = async (fn: () => Promise<unknown>, msg: string) => {
    busy = true;
    err = '';
    try {
      await fn();
    } catch (e: unknown) {
      err = e instanceof Error ? e.message : msg;
    } finally {
      busy = false;
    }
  };

  // ── pixi init ───────────────────────────────────────────
  onMount(() => {
    buildLookup();
    initPixi();
    loadCities();
    const onR = () => resize();
    window.addEventListener('resize', onR);
    return () => {
      window.removeEventListener('resize', onR);
      app?.destroy(true, { children: true });
    };
  });

  const resize = () => {
    if (!app || !el) return;
    cw = el.clientWidth;
    ch = el.clientHeight;
    app.renderer.resize(cw, ch);
    loadVisible();
  };

  const initPixi = async () => {
    cw = el.clientWidth;
    ch = el.clientHeight;
    app = new Application();
    await app.init({ width: cw, height: ch, backgroundColor: 0x0f1f10, antialias: true });
    el.appendChild(app.canvas);
    cont = new Container();
    cont.sortableChildren = true;
    cont.interactive = true;
    cont.hitArea = new Rectangle(-1e5, -1e5, 2e5, 2e5);
    app.stage.addChild(cont);
    centerCam($mapCenter.x, $mapCenter.y);
    setupInput();
    loadVisible();

    // Selection pulse + construction overlay animation
    app.ticker.add(() => {
      const t = performance.now() / 1000;

      if (selGfx) {
        selGfx.alpha = 0.85 + 0.15 * Math.sin(t * 2.5);
      }

      const nowMs = Date.now();
      for (const [, entry] of constructionGfx) {
        const { gfx, startMs, endMs } = entry;
        gfx.clear();

        const pct = Math.min(1, (nowMs - startMs) / (endMs - startMs));
        const done = nowMs >= endMs;
        const color = done ? 0x34d399 : 0xf59e0b;

        // Pulsing hex fill — steady when done, pulsing while building
        const pulse = done ? 0.1 : 0.08 + 0.06 * Math.sin(t * 3);
        gfx.poly(HEX_VERTS);
        gfx.fill({ color, alpha: pulse });

        // Progress ring
        const radius = S * 0.35;
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + pct * Math.PI * 2;
        gfx.circle(0, 0, radius);
        gfx.stroke({ color: 0xffffff, width: 2.5, alpha: 0.1 });
        gfx.arc(0, 0, radius, startAngle, endAngle);
        gfx.stroke({ color, width: 2.5, alpha: 0.7 });
      }
    });
  };

  // ── tile rendering ──────────────────────────────────────
  const renderTile = (col: number, row: number) => {
    if (col < 0 || row < 0 || col >= $gameConfig.mapSize || row >= $gameConfig.mapSize) return;
    const k = tileKey(col, row);
    if (loaded.has(k)) return;

    const td = tileData.get(k);
    const { x: px, y: py } = hexToPixel(col, row);
    const tc = new Container();
    tc.x = px;
    tc.y = py;
    tc.zIndex = Math.round(py);
    cont.addChild(tc);
    loaded.set(k, tc);

    const dist = myCities.length > 0 ? getVisDist(col, row) : 0;
    const inFog = dist > $gameConfig.visionRadius;

    let kind: TileKind;
    if (inFog) {
      kind = 'fog';
    } else if (td?.building) {
      const bt = td.building.type;
      if (bt === BuildingType.FARM) kind = 'farm';
      else if (bt === BuildingType.MINE) kind = 'mine';
      else if (bt === BuildingType.BARRACKS) kind = 'barracks';
      else if (bt === BuildingType.CITY_CENTER) kind = 'city_center';
      else if (bt === BuildingType.TOWN_CENTER) kind = 'town_center';
      else kind = 'house';
    } else if (td?.city) {
      kind = 'city';
    } else {
      kind = 'grass';
    }

    const spr = new Sprite(getTileTexture(kind, col, row));
    spr.anchor.set(TILE_ANCHOR_X, TILE_ANCHOR_Y);
    tc.addChild(spr);

    // Construction-in-progress overlay
    if (!inFog && td?.building?.constructionStart && td?.building?.constructionEnd) {
      const startMs = Number(td.building.constructionStart.seconds) * 1000;
      const endMs = Number(td.building.constructionEnd.seconds) * 1000;
      if (endMs > Date.now()) {
        const cg = new Graphics();
        cg.zIndex = 1e6;
        tc.addChild(cg);
        constructionGfx.set(k, { gfx: cg, startMs, endMs, cx: px, cy: py });
      }
    }

    if (!inFog) {
      let hasOverlay = false;
      const g = new Graphics();

      // Territory boundary edges
      if (td?.city) {
        const cityId = td.city.cityId;
        const owner = td.city.owner;
        const oc = owner?.value === $userId ? 0x4499ff : owner ? 0xdd4444 : 0x999999;
        const neighbors = hexNeighbors(col, row);
        for (let i = 0; i < 6; i++) {
          const [nc, nr] = neighbors[i];
          const nk = tileKey(nc, nr);
          const nd = tileData.get(nk);
          if (nd?.city?.cityId?.value === cityId?.value) continue;
          // This edge is a boundary — draw it
          const vi = i * 2,
            vn = ((i + 1) % 6) * 2;
          g.moveTo(HEX_VERTS[vi], HEX_VERTS[vi + 1]);
          g.lineTo(HEX_VERTS[vn], HEX_VERTS[vn + 1]);
          g.stroke({ color: oc, width: 3, alpha: 0.8 });
          hasOverlay = true;
        }
      }

      // Visibility edge glow
      if (dist >= $gameConfig.visionRadius - 1) {
        g.poly(HEX_VERTS);
        g.stroke({ color: 0x40a0b0, width: 1.5, alpha: 0.2 });
        hasOverlay = true;
      }

      if (hasOverlay) tc.addChild(g);
    }
  };

  const loadVisible = () => {
    if (!cont) return;
    const s = cont.scale.x;
    const ox = -cont.x / s,
      oy = -cont.y / s;
    const vw = cw / s,
      vh = ch / s;
    const colMin = Math.floor(ox / (1.5 * S)) - 2;
    const colMax = Math.ceil((ox + vw) / (1.5 * S)) + 2;
    const rowMin = Math.floor(oy / HEX_H) - 2;
    const rowMax = Math.ceil((oy + vh) / HEX_H) + 2;
    for (let col = colMin; col <= colMax; col++) for (let row = rowMin; row <= rowMax; row++) renderTile(col, row);
  };

  // ── selection ───────────────────────────────────────────
  const drawSel = (col: number, row: number) => {
    if (selGfx) {
      cont.removeChild(selGfx);
      selGfx.destroy();
    }
    selGfx = new Graphics();
    const { x: px, y: py } = hexToPixel(col, row);
    selGfx.position.set(px, py);
    selGfx.poly(HEX_VERTS);
    selGfx.fill({ color: 0xffd700, alpha: 0.15 });
    selGfx.poly(HEX_VERTS);
    selGfx.stroke({ color: 0xffd700, width: 3, alpha: 0.9 });
    selGfx.zIndex = 1e7;
    cont.addChild(selGfx);
  };

  const deselect = () => {
    sel = null;
    if (selGfx) {
      cont.removeChild(selGfx);
      selGfx.destroy();
      selGfx = null;
    }
  };

  // ── input ───────────────────────────────────────────────
  const setupInput = () => {
    cont.on('pointerdown', (e) => {
      drag = true;
      const p = e.data.global;
      dsx = p.x;
      dsy = p.y;
      csx = cont.x;
      csy = cont.y;
    });

    cont.on('pointermove', (e) => {
      if (!drag) return;
      const p = e.data.global;
      cont.x = csx + (p.x - dsx);
      cont.y = csy + (p.y - dsy);
      clampCam();
      loadVisible();
    });

    cont.on('pointerup', (e) => {
      if (!drag) return;
      const p = e.data.global;
      const dx = p.x - dsx,
        dy = p.y - dsy;
      if (Math.sqrt(dx * dx + dy * dy) < CLICK_DIST) {
        const mc = pixelToHex((p.x - cont.x) / cont.scale.x, (p.y - cont.y) / cont.scale.y);
        if (mc.x >= 0 && mc.y >= 0 && mc.x < $gameConfig.mapSize && mc.y < $gameConfig.mapSize) {
          const t = tileData.get(tileKey(mc.x, mc.y));
          sel = { x: mc.x, y: mc.y, ...t };
          err = '';
          showBuild = false;
          drawSel(mc.x, mc.y);
        }
      } else {
        mapCenter.set(getCenter());
      }
      drag = false;
    });

    cont.on('pointerupoutside', () => {
      if (drag) mapCenter.set(getCenter());
      drag = false;
    });

    cont.on('wheel', (e) => {
      const dir = e.deltaY < 0 ? 1 : -1;
      const cur = cont.scale.x;
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cur * (1 + dir * 0.08)));
      if (next === cur) return;
      const mx = e.data.global.x,
        my = e.data.global.y;
      const f = next / cur;
      cont.x = mx - (mx - cont.x) * f;
      cont.y = my - (my - cont.y) * f;
      cont.scale.set(next);
      clampCam();
      loadVisible();
      mapCenter.set(getCenter());
    });
  };

  const logout = () => {
    token.set(undefined);
    username.set(undefined);
    userId.set(undefined);
    goto('/login');
  };
</script>

<svelte:head>
  <title>Game - city.io</title>
</svelte:head>

<div class="relative h-screen w-screen overflow-hidden" style="background:#0f1f10">
  <!-- Canvas -->
  <div bind:this={el} class="absolute inset-0 cursor-grab active:cursor-grabbing"></div>

  <!-- Top bar -->
  <div class="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-3">
    <!-- Username -->
    <div class="pointer-events-auto flex items-center gap-2.5 rounded-lg bg-gray-900/85 px-4 py-2 backdrop-blur-sm">
      <div class="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.4)]"></div>
      <span class="text-sm font-medium tracking-wide text-gray-100">{$username}</span>
    </div>

    <!-- Resources -->
    <div class="pointer-events-auto flex items-center gap-4 rounded-lg bg-gray-900/85 px-3.5 py-2 backdrop-blur-sm">
      <span class="text-xs text-gray-400">Gold <span class="tabular-nums text-amber-300">{$gold.toLocaleString()}</span></span>
      <span class="flex items-center gap-1.5 text-xs text-gray-400">
        Food <span class="tabular-nums text-emerald-300">{$food.toLocaleString()}</span>
        {#if Math.round(netFoodPerHour) !== 0}
          <span class="text-[10px] tabular-nums {netFoodPerHour > 0 ? 'text-emerald-400/70' : 'text-red-400'}" title="Net food into the shared pool per hour">{fmtPerHour(netFoodPerHour)}/hr</span>
        {/if}
      </span>
    </div>

    <!-- Logout -->
    <button class="pointer-events-auto rounded-lg bg-gray-900/85 px-3 py-1.5 text-xs font-medium text-gray-500 backdrop-blur-sm transition-colors hover:text-gray-200" on:click={logout}
      >Sign Out</button
    >
  </div>

  <!-- Right panel -->
  <div class="pointer-events-none absolute bottom-4 right-4 top-16 flex w-60 flex-col gap-2.5">
    {#if myCities.length > 0}
      <div class="pointer-events-auto rounded-lg bg-gray-900/85 p-3 backdrop-blur-sm">
        <div class="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Your Cities</div>
        {#each myCities as rawCity}
          {@const city = liveCity(rawCity)}
          <button
            class="group flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors duration-150 hover:bg-white/[0.06]"
            on:click={() => {
              if (city.start) {
                centerCam(city.start.x + Math.floor(city.size / 2), city.start.y + Math.floor(city.size / 2));
                loadVisible();
                mapCenter.set(getCenter());
              }
            }}
          >
            <div class="h-1.5 w-1.5 rounded-full {city.starving ? 'animate-pulse bg-red-400' : 'bg-emerald-400/60'}"></div>
            <span class="text-xs font-medium text-gray-300 group-hover:text-gray-100">{city.name}</span>
            {#if city.starving}
              <span class="text-[9px] font-semibold uppercase tracking-wide text-red-400">Starving</span>
            {/if}
            <span class="ml-auto text-[10px] text-gray-600">{cName(city.type)}</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if sel}
      <div class="pointer-events-auto space-y-3 rounded-lg bg-gray-900/85 p-3 backdrop-blur-sm" transition:fly={{ x: 16, duration: 200 }}>
        <!-- Header -->
        <div class="flex items-center justify-between">
          <span class="rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-gray-500">{sel.x}, {sel.y}</span>
          <button
            aria-label="Close"
            class="flex h-5 w-5 items-center justify-center rounded-lg text-gray-600 transition-colors duration-150 hover:bg-white/[0.06] hover:text-gray-300"
            on:click={deselect}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {#if err}
          <div class="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-400">{err}</div>
        {/if}

        <!-- City info card (always shown when city exists) -->
        {#if sel.city}
          <div class="rounded-md bg-white/[0.04] p-3">
            <div class="flex items-center justify-between">
              <span class="text-sm font-semibold text-emerald-200">{sel.city.name}</span>
              {#if sel.city.owner?.value === $userId}
                <span class="rounded bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-bold text-blue-400">YOURS</span>
              {:else if sel.city.owner}
                <span class="rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold text-red-400">ENEMY</span>
              {:else}
                <span class="rounded bg-gray-500/15 px-1.5 py-0.5 text-[9px] font-bold text-gray-400">NEUTRAL</span>
              {/if}
            </div>
            <div class="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
              <span>{cName(sel.city.type)}</span>
              <span class="text-gray-700">&middot;</span>
              <span>Pop {sel.city.population.toFixed(0)}<span class="text-gray-600">/{sel.city.populationCap.toFixed(0)}</span></span>
              {#if sel.city.starving}
                <span class="text-gray-700">&middot;</span>
                <span class="flex items-center gap-1 font-semibold text-red-400">
                  <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400"></span>Starving
                </span>
              {/if}
            </div>
            <!-- Food economy is owner-only intel; non-owners receive these unset -->
            {#if sel.city.owner?.value === $userId}
              {@const netFlow = ratePerHour(sel.city.netFoodFlow)}
              <div class="mt-2 space-y-1 border-t border-white/[0.06] pt-2">
                <div class="flex items-center justify-between text-[10px]">
                  <span class="text-gray-500">Food produced</span>
                  <span class="tabular-nums text-emerald-400">{Math.round(ratePerHour(sel.city.foodProduction)).toLocaleString()}/hr</span>
                </div>
                <div class="flex items-center justify-between text-[10px]">
                  <span class="text-gray-500">Food upkeep</span>
                  <span class="tabular-nums text-red-400/80">{fmtPerHour(-ratePerHour(sel.city.foodUpkeep))}/hr</span>
                </div>
                <div class="flex items-center justify-between text-[10px]">
                  <span class="text-gray-500">{netFlow >= 0 ? 'Surplus to pool' : 'Drawn from pool'}</span>
                  <span class="font-semibold tabular-nums {netFlow >= 0 ? 'text-emerald-300' : 'text-red-400'}">{fmtPerHour(netFlow)}/hr</span>
                </div>
              </div>
            {/if}
          </div>
        {/if}

        <!-- Building info card -->
        {#if sel.building}
          {@const isBuilding = sel.building.level === 0}
          {@const stats = isBuilding ? null : getLevelStats(sel.building.type, sel.building.level)}
          {@const nextStats = getLevelStats(sel.building.type, sel.building.level + 1)}
          <div class="rounded-md bg-white/[0.04] p-3">
            <div class="flex items-center justify-between">
              <span class="text-sm font-semibold text-amber-200">{bName(sel.building.type)}</span>
              {#if !isBuilding}
                <span class="rounded-lg bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-amber-400">Lv {sel.building.level}</span>
              {/if}
            </div>
            {#if sel.building.constructionStart && sel.building.constructionEnd}
              {@const startMs = Number(sel.building.constructionStart.seconds) * 1000}
              {@const endMs = Number(sel.building.constructionEnd.seconds) * 1000}
              {@const totalMs = endMs - startMs}
              {@const elapsedMs = now - startMs}
              {@const remainMs = endMs - now}
              {@const pct = Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100))}
              <div class="mt-2 space-y-1.5">
                <div class="flex items-center justify-between text-[10px]">
                  <span class="text-amber-400/70">
                    {isBuilding ? 'Building' : `Upgrading to Lv ${sel.building.targetLevel}`}
                  </span>
                  <span class="tabular-nums text-amber-300">{remainMs > 0 ? fmtCountdown(remainMs) : 'Done'}</span>
                </div>
                <div class="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div class="h-full rounded-full transition-all duration-1000 ease-linear {remainMs <= 0 ? 'bg-emerald-400' : 'bg-amber-400'}" style="width: {pct.toFixed(1)}%"></div>
                </div>
              </div>
            {/if}
            {#if stats}
              <div class="mt-2 space-y-1 border-t border-white/[0.06] pt-2">
                {#if stats.production.length > 0}
                  <div class="flex items-center justify-between text-[10px]">
                    <span class="text-gray-500">Production</span>
                    <span class="tabular-nums text-emerald-400">{stats.production.map(fmtProd).join(', ')}</span>
                  </div>
                {/if}
                {#if stats.population > 0}
                  <div class="flex items-center justify-between text-[10px]">
                    <span class="text-gray-500">Population</span>
                    <span class="tabular-nums text-blue-400">+{stats.population}</span>
                  </div>
                {/if}
              </div>
            {/if}
            {#if nextStats && sel.city?.owner?.value === $userId}
              <div class="mt-2 space-y-1.5 border-t border-white/[0.06] pt-2">
                <div class="text-[9px] font-semibold uppercase tracking-wider text-gray-500">Lv {sel.building.level + 1} Upgrade</div>
                <div class="flex items-center justify-between text-[10px]">
                  <span class="text-gray-500">Cost</span>
                  <span class="tabular-nums text-amber-300">{nextStats.cost.map(fmtRes).join(', ')}</span>
                </div>
                <div class="flex items-center justify-between text-[10px]">
                  <span class="text-gray-500">Time</span>
                  <span class="tabular-nums text-gray-400">{fmtTime(nextStats.constructionTime)}</span>
                </div>
                {#if nextStats.production.length > 0}
                  <div class="flex items-center justify-between text-[10px]">
                    <span class="text-gray-500">Production</span>
                    <span class="tabular-nums">
                      {#if stats}
                        <span class="text-gray-500">{stats.production.map(fmtProd).join(', ')}</span>
                        <span class="mx-0.5 text-gray-600">&rarr;</span>
                      {/if}
                      <span class="text-emerald-400">{nextStats.production.map(fmtProd).join(', ')}</span>
                    </span>
                  </div>
                {/if}
                {#if nextStats.population > 0}
                  <div class="flex items-center justify-between text-[10px]">
                    <span class="text-gray-500">Population</span>
                    <span class="tabular-nums">
                      {#if stats}
                        <span class="text-gray-500">+{stats.population}</span>
                        <span class="mx-0.5 text-gray-600">&rarr;</span>
                      {/if}
                      <span class="text-blue-400">+{nextStats.population}</span>
                    </span>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
          {#if sel.city?.owner?.value === $userId}
            {@const upgrading = !!(sel.building.constructionStart && sel.building.constructionEnd && Number(sel.building.constructionEnd.seconds) * 1000 > now)}
            <div class="flex gap-2">
              <button
                class="flex-1 rounded-md bg-sky-500/15 py-2 text-[11px] font-semibold text-sky-300 transition-colors hover:bg-sky-500/25 disabled:opacity-30"
                disabled={busy || upgrading}
                on:click={() => sel?.building && doAction(() => buildingClient.upgradeBuilding({ buildingId: sel!.building!.buildingId }), 'Upgrade failed')}>{busy ? '...' : 'Upgrade'}</button
              >
              <button
                class="flex-1 rounded-md bg-red-500/10 py-2 text-[11px] font-semibold text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-30"
                disabled={busy || upgrading}
                on:click={() => sel?.building && doAction(() => buildingClient.deleteBuilding({ buildingId: sel!.building!.buildingId }), 'Demolish failed')}>{busy ? '...' : 'Demolish'}</button
              >
            </div>
          {/if}
        {:else if sel.city?.owner?.value === $userId}
          <!-- Build toggle (own city, no building on tile) -->
          <button
            class="w-full rounded-md py-2 text-xs font-semibold transition-colors
							{showBuild ? 'bg-gray-500/15 text-gray-300 hover:bg-gray-500/25' : 'bg-emerald-600/25 text-emerald-200 hover:bg-emerald-600/35'}"
            on:click={() => (showBuild = !showBuild)}>{showBuild ? 'Cancel' : 'Build'}</button
          >
          {#if showBuild}
            <div>
              <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Build Structure</div>
              <div class="grid grid-cols-2 gap-1.5">
                {#each placeTypes as bt}
                  <button
                    class="rounded-xl px-1.5 py-1.5 text-[11px] font-medium transition-all duration-150
											{buildType === bt ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25' : 'bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] hover:text-gray-300'}"
                    on:click={() => (buildType = bt)}>{bName(bt)}</button
                  >
                {/each}
              </div>
            </div>
            {@const buildStats = getLevelStats(buildType, 1)}
            {#if buildStats}
              <div class="space-y-1 rounded-md bg-white/[0.04] p-2.5">
                <div class="text-[10px] font-semibold text-gray-300">{bName(buildType)}</div>
                <div class="flex items-center justify-between text-[10px]">
                  <span class="text-gray-500">Cost</span>
                  <span class="tabular-nums text-amber-300">{buildStats.cost.map(fmtRes).join(', ')}</span>
                </div>
                <div class="flex items-center justify-between text-[10px]">
                  <span class="text-gray-500">Build time</span>
                  <span class="tabular-nums text-gray-400">{fmtTime(buildStats.constructionTime)}</span>
                </div>
                {#if buildStats.production.length > 0}
                  <div class="flex items-center justify-between text-[10px]">
                    <span class="text-gray-500">Produces</span>
                    <span class="tabular-nums text-emerald-400">{buildStats.production.map(fmtProd).join(', ')}</span>
                  </div>
                {/if}
                {#if buildStats.population > 0}
                  <div class="flex items-center justify-between text-[10px]">
                    <span class="text-gray-500">Population</span>
                    <span class="tabular-nums text-blue-400">+{buildStats.population}</span>
                  </div>
                {/if}
              </div>
            {/if}
            <button
              class="w-full rounded-md bg-emerald-600/25 py-2 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-600/35 disabled:opacity-30"
              disabled={busy}
              on:click={() => sel?.city && doAction(() => buildingClient.createBuilding({ cityId: sel!.city!.cityId, type: buildType, coords: { x: sel!.x, y: sel!.y } }), 'Build failed')}
              >{busy ? '...' : 'Place Building'}</button
            >
          {/if}
        {:else if !sel.city}
          <!-- Empty tile message -->
          <div class="py-3 text-center text-xs text-gray-600">
            {myCities.length > 0 && getVisDist(sel.x, sel.y) > $gameConfig.visionRadius ? 'Beyond visibility range' : 'No structures on this tile'}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Bottom hint -->
  {#if !sel}
    <div class="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2" transition:fade={{ duration: 200 }}>
      <div class="rounded-full bg-gray-900/80 px-4 py-1.5 backdrop-blur-sm">
        <span class="text-xs font-medium text-gray-500">Select a hex tile to inspect</span>
      </div>
    </div>
  {/if}
</div>
