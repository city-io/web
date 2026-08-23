<script lang="ts">
  import { armies, buildings, cities, mapCenter, username, gold, food, userId, gameConfig } from '$lib/stores';
  import { clearSession } from '$lib/session';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { Application, Container, Graphics, Rectangle } from 'pixi.js';
  import { HW, HH, DIAMOND_VERTS, EDGE_TO_NEIGHBOR, tileToScreen, screenToTile, tileKey, mapBounds } from '$lib/game/iso';
  import { initSprites, getTileSprite, type TileKind } from '$lib/game/sprites';
  import MiniMap from '$lib/components/MiniMap.svelte';
  import { ratePerHour, fmtPerHour, durationSeconds } from '$lib/game/rates';
  import type { City } from '$lib/gen/cityio/entity/v1/city_pb';
  import type { Building } from '$lib/gen/cityio/entity/v1/building_pb';
  import type { Army } from '$lib/gen/cityio/entity/v1/army_pb';
  import { BuildingType, CityType, TroopType } from '$lib/gen/cityio/entity/v1/common_pb';
  import type { BuildingConfig, BuildingLevelStats, ResourceRate } from '$lib/gen/cityio/service/v1/config_pb';
  import type { Duration } from '@bufbuild/protobuf/wkt';
  import { buildingClient, cityClient } from '$lib/api/client';

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

  // camera easing — cont.x/y/scale are the rendered values; inputs set these
  // targets and the ticker glides the view toward them. Drag is 1:1 and seeds
  // release momentum (velX/velY, px/sec). Disabled under prefers-reduced-motion.
  let tgtX = 0,
    tgtY = 0,
    tgtScale = 1;
  let velX = 0,
    velY = 0;
  let lastMoveT = 0,
    lastMoveX = 0,
    lastMoveY = 0;
  let easeMotion = true;

  // tiles
  let loaded = new Map<string, Container>();
  let tileData = new Map<string, { city?: City; building?: Building; armies?: Army[] }>();
  let constructionGfx = new Map<string, { gfx: Graphics; startMs: number; endMs: number; cx: number; cy: number }>();
  let starvingGfx = new Map<string, { gfx: Graphics; segs: number[][]; isCenter: boolean }>();
  let selGfx: Graphics | null = null;

  // ── UI state ────────────────────────────────────────────
  let sel: { x: number; y: number; city?: City; building?: Building; armies?: Army[] } | null = null;
  let myCities: City[] = [];
  let buildType: BuildingType = BuildingType.HOUSE;
  const placeTypes = [BuildingType.HOUSE, BuildingType.FARM, BuildingType.MINE, BuildingType.BARRACKS];
  let busy = false;
  let err = '';
  let showBuild = false;

  // Compact top-bar menus keep secondary information off the map until needed.
  let ratesOpen = false;
  let ratesEl: HTMLDivElement;
  let citiesOpen = false;
  let citiesEl: HTMLDivElement;

  // Keyboard navigation
  let showHelp = false;
  let cityCycleIdx = -1;
  const PAN_STEP = 110;

  // Minimap viewport rectangle span (tile units), updated by loadVisible.
  let viewTilesW = 0;
  let viewTilesH = 0;

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
  const TN: Record<number, string> = {
    [TroopType.SOLDIER]: 'Soldiers',
    [TroopType.ARCHER]: 'Archers',
    [TroopType.CAVALRY]: 'Cavalry',
    [TroopType.ARTILLERY]: 'Artillery'
  };
  const bName = (t: BuildingType) => BN[t] ?? 'Unknown';
  const cName = (t: CityType) => (t === CityType.CITY ? 'City' : t === CityType.TOWN ? 'Town' : 'Settlement');
  const troopName = (t: TroopType) => TN[t] ?? 'Troops';
  const armySize = (army: Army) => army.troops.reduce((sum, stack) => sum + stack.count, 0);

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

  // Ongoing production flows, normalized to per-hour: "<n> <resource>/hr".
  const fmtProd = (r: ResourceRate): string => `${fmtProdNum(r)} ${r.resource}/hr`;

  // Bare per-hour number for current → next comparisons where the unit is
  // rendered once at the end (keeps the narrow side panel from overflowing).
  const fmtProdNum = (r: ResourceRate): string => Math.round(ratePerHour(r.rate)).toLocaleString();

  // Shared unit suffix for a production set, e.g. "gold/hr". Falls back to a
  // bare "/hr" if a building ever produces more than one resource type.
  const prodUnit = (prod: ResourceRate[]): string => {
    const resources = [...new Set(prod.map((r) => r.resource))];
    return resources.length === 1 ? `${resources[0]}/hr` : '/hr';
  };

  // Empire-wide per-hour rates, summed across owned cities so the top-bar
  // breakdown stays exactly consistent with the per-city numbers. Gold has no
  // upkeep (derived from building production); food nets production vs upkeep.
  $: ownedCities = $cities.filter((c) => c.owner?.value === $userId);
  $: goldPerHour = ownedCities.reduce((s, c) => s + (prodByCity.get(c.cityId?.value ?? '')?.gold ?? 0), 0);
  $: foodProdPerHour = ownedCities.reduce((s, c) => s + ratePerHour(c.foodProduction), 0);
  $: foodUpkeepPerHour = ownedCities.reduce((s, c) => s + ratePerHour(c.foodUpkeep), 0);
  $: netFoodPerHour = foodProdPerHour - foodUpkeepPerHour;

  // Live city state (food rates / starving) is pushed into the $cities store per
  // tick, while myCities is a one-shot snapshot — look up the fresh copy by id.
  $: liveCityById = new Map($cities.map((c) => [c.cityId?.value, c]));
  const liveCity = (c: City): City => liveCityById.get(c.cityId?.value) ?? c;

  // Per-city resource production per hour, summed from each building's current
  // level in the config. Recomputes when buildings or config change. Buildings
  // still under construction (level 0) don't produce yet.
  const computeProd = (bs: Building[], cfg: { buildings: BuildingConfig[] }) => {
    const m = new Map<string, { gold: number; food: number }>();
    for (const b of bs) {
      const id = b.cityId?.value;
      if (!id || b.level < 1) continue;
      const stats = cfg.buildings.find((x) => x.type === b.type)?.levels.find((l) => l.level === b.level);
      if (!stats) continue;
      const e = m.get(id) ?? { gold: 0, food: 0 };
      for (const p of stats.production) {
        const v = ratePerHour(p.rate);
        if (p.resource === 'gold') e.gold += v;
        else if (p.resource === 'food') e.food += v;
      }
      m.set(id, e);
    }
    return m;
  };
  $: prodByCity = computeProd($buildings, $gameConfig);
  const cityProd = (c: City) => prodByCity.get(c.cityId?.value ?? '') ?? { gold: 0, food: 0 };

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
  $: if ($cities || $buildings || $armies) {
    buildLookup();
    // Immediately hide construction overlays for finished/removed constructions
    for (const [k, entry] of constructionGfx) {
      const td = tileData.get(k);
      const active = td?.building?.constructionEnd && Number(td.building.constructionEnd.seconds) * 1000 > Date.now();
      if (!active) entry.gfx.visible = false;
    }
    // Immediately hide starvation borders for cities that recovered
    for (const [k, entry] of starvingGfx) {
      if (!tileData.get(k)?.city?.starving) entry.gfx.visible = false;
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
    for (const army of $armies) {
      if (!army.coords) continue;
      const k = tileKey(army.coords.x, army.coords.y);
      const current = tileData.get(k);
      tileData.set(k, { ...current, armies: [...(current?.armies ?? []), army] });
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
    return screenToTile((-cont.x + cw / 2) / cont.scale.x, (-cont.y + ch / 2) / cont.scale.y);
  };

  // Clamp a container position to the iso map's screen-space AABB (pure).
  const clampPos = (x: number, y: number, s: number) => {
    const pad = 200;
    const b = mapBounds($gameConfig.mapSize);
    const xMin = cw - pad - b.maxX * s,
      xMax = pad - b.minX * s;
    const yMin = ch - pad - b.maxY * s,
      yMax = pad - b.minY * s;
    if (xMin < xMax) x = Math.max(xMin, Math.min(xMax, x));
    if (yMin < yMax) y = Math.max(yMin, Math.min(yMax, y));
    return { x, y };
  };

  // Snap the rendered camera to the current target immediately (used for init
  // and when motion easing is disabled).
  const applyCamNow = () => {
    if (!cont) return;
    cont.x = tgtX;
    cont.y = tgtY;
    cont.scale.set(tgtScale);
    loadVisible();
    mapCenter.set(getCenter());
  };

  const centerCam = (col: number, row: number, snap = false) => {
    const p = tileToScreen(col, row);
    const c = clampPos(-p.sx * tgtScale + cw / 2, -p.sy * tgtScale + ch / 2, tgtScale);
    tgtX = c.x;
    tgtY = c.y;
    velX = velY = 0;
    if (snap || !easeMotion) applyCamNow();
  };

  // Pan to a city's center and select it: focus the actual city/town-center
  // building if we have it, else the territory's geometric middle tile.
  const centerOnCity = (city: City) => {
    const center = $buildings.find((b) => b.cityId?.value === city.cityId?.value && (b.type === BuildingType.CITY_CENTER || b.type === BuildingType.TOWN_CENTER));
    const col = center?.coords?.x ?? (city.start ? city.start.x + Math.floor(city.size / 2) : undefined);
    const row = center?.coords?.y ?? (city.start ? city.start.y + Math.floor(city.size / 2) : undefined);
    if (col === undefined || row === undefined) return;
    // Glide to the city (centerCam eases toward the target).
    centerCam(col, row);
    // Focus the center tile so its detail panel opens, same as a map click.
    sel = { x: col, y: row, ...tileData.get(tileKey(col, row)) };
    err = '';
    showBuild = false;
    drawSel(col, row);
  };

  // Pan the camera by a pixel delta (shared by trackpad scroll + keyboard).
  const panBy = (dx: number, dy: number) => {
    if (!cont) return;
    const c = clampPos(tgtX + dx, tgtY + dy, tgtScale);
    tgtX = c.x;
    tgtY = c.y;
    if (!easeMotion) applyCamNow();
  };

  // Zoom by a multiplicative factor anchored at screen point (ax, ay), clamped.
  const zoomAt = (ax: number, ay: number, factor: number) => {
    if (!cont) return;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, tgtScale * factor));
    if (next === tgtScale) return;
    const f = next / tgtScale;
    const c = clampPos(ax - (ax - tgtX) * f, ay - (ay - tgtY) * f, next);
    tgtScale = next;
    tgtX = c.x;
    tgtY = c.y;
    if (!easeMotion) applyCamNow();
  };

  // Per-frame camera step: apply release momentum to the target, then ease the
  // rendered camera toward it. Frame-rate independent via exponential decay.
  const animateCam = (dtMs: number) => {
    if (!cont) return;
    const dt = Math.min(dtMs, 50) / 1000;

    // Drag-release glide: coast the target, decay velocity, stop at edges.
    if (easeMotion && !drag && (Math.abs(velX) > 1 || Math.abs(velY) > 1)) {
      const reqX = tgtX + velX * dt,
        reqY = tgtY + velY * dt;
      const c = clampPos(reqX, reqY, tgtScale);
      if (c.x !== reqX) velX = 0;
      if (c.y !== reqY) velY = 0;
      tgtX = c.x;
      tgtY = c.y;
      const decay = Math.pow(0.0025, dt);
      velX *= decay;
      velY *= decay;
      if (Math.abs(velX) < 1) velX = 0;
      if (Math.abs(velY) < 1) velY = 0;
    }

    if (cont.x === tgtX && cont.y === tgtY && cont.scale.x === tgtScale) return;

    // Ease toward target (snap instantly when motion easing is off).
    const k = easeMotion ? 1 - Math.pow(0.0001, dt) : 1;
    let nx = cont.x + (tgtX - cont.x) * k;
    let ny = cont.y + (tgtY - cont.y) * k;
    let ns = cont.scale.x + (tgtScale - cont.scale.x) * k;
    if (Math.abs(nx - tgtX) < 0.05 && Math.abs(ny - tgtY) < 0.05 && Math.abs(ns - tgtScale) < 0.0002) {
      nx = tgtX;
      ny = tgtY;
      ns = tgtScale;
    }
    cont.x = nx;
    cont.y = ny;
    cont.scale.set(ns);
    loadVisible();
    mapCenter.set(getCenter());
  };

  // ── data actions ────────────────────────────────────────
  const rebuildTiles = () => {
    for (const [, c] of loaded) c.destroy({ children: true });
    loaded.clear();
    constructionGfx.clear();
    starvingGfx.clear();
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
    initSprites().then(() => initPixi());
    loadCities();
    const onR = () => resize();
    window.addEventListener('resize', onR);
    return () => {
      window.removeEventListener('resize', onR);
      app?.canvas?.removeEventListener('wheel', onWheel);
      app?.destroy(true, { children: true });
    };
  });

  const resize = () => {
    if (!app || !el) return;
    cw = el.clientWidth;
    ch = el.clientHeight;
    app.renderer.resize(cw, ch);
    const c = clampPos(tgtX, tgtY, tgtScale);
    tgtX = c.x;
    tgtY = c.y;
    loadVisible();
  };

  const initPixi = async () => {
    cw = el.clientWidth;
    ch = el.clientHeight;
    app = new Application();
    await app.init({ width: cw, height: ch, backgroundColor: 0x1d1811, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
    el.appendChild(app.canvas);
    cont = new Container();
    cont.sortableChildren = true;
    cont.interactive = true;
    cont.hitArea = new Rectangle(-1e5, -1e5, 2e5, 2e5);
    app.stage.addChild(cont);
    easeMotion = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    centerCam($mapCenter.x, $mapCenter.y, true);
    setupInput();
    loadVisible();

    // Selection pulse + construction overlay animation
    app.ticker.add(() => {
      const t = performance.now() / 1000;

      animateCam(app.ticker.deltaMS);

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

        // Pulsing diamond fill — steady when done, pulsing while building
        const pulse = done ? 0.1 : 0.08 + 0.06 * Math.sin(t * 3);
        gfx.poly(DIAMOND_VERTS);
        gfx.fill({ color, alpha: pulse });

        // Progress ring
        const radius = HW * 0.42;
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + pct * Math.PI * 2;
        gfx.circle(0, 0, radius);
        gfx.stroke({ color: 0xffffff, width: 2.5, alpha: 0.1 });
        gfx.arc(0, 0, radius, startAngle, endAngle);
        gfx.stroke({ color, width: 2.5, alpha: 0.7 });
      }

      // Starvation — pulsing red territory border + caution icon on the center
      const sPulse = 0.5 + 0.5 * Math.sin(t * 4);
      for (const [, entry] of starvingGfx) {
        const { gfx, segs, isCenter } = entry;
        if (!gfx.visible) continue;
        gfx.clear();

        // Pulsing red border along the territory edges
        if (segs.length) {
          for (const s of segs) {
            gfx.moveTo(s[0], s[1]);
            gfx.lineTo(s[2], s[3]);
          }
          gfx.stroke({ color: 0xef4444, width: 2.5 + 1.5 * sPulse, alpha: 0.4 + 0.5 * sPulse });
        }

        // Caution icon sitting on the city/town center tile. Kept near the
        // tile center (small upward offset) so it reads as being on the center
        // building rather than drifting up onto the tile above it.
        if (isCenter) {
          const ay = -HH * 0.6;
          gfx.poly([0, ay - 11, -10, ay + 8, 10, ay + 8]);
          gfx.fill({ color: 0xef4444, alpha: 0.82 + 0.18 * sPulse });
          gfx.poly([0, ay - 11, -10, ay + 8, 10, ay + 8]);
          gfx.stroke({ color: 0xfee2e2, width: 1.2, alpha: 0.8 });
          gfx.rect(-1.1, ay - 4, 2.2, 6);
          gfx.rect(-1.1, ay + 4.5, 2.2, 2.2);
          gfx.fill({ color: 0xfff1f2, alpha: 0.95 });
        }
      }
    });
  };

  // ── tile rendering ──────────────────────────────────────
  const renderTile = (col: number, row: number) => {
    if (col < 0 || row < 0 || col >= $gameConfig.mapSize || row >= $gameConfig.mapSize) return;
    const k = tileKey(col, row);
    if (loaded.has(k)) return;

    const td = tileData.get(k);
    const { sx: px, sy: py } = tileToScreen(col, row);
    const tc = new Container();
    tc.x = px;
    tc.y = py;
    // Iso depth: back-to-front by (col+row); tall sprites anchored near the base
    // diamond so higher (col+row) tiles correctly overdraw the ones behind.
    tc.zIndex = (col + row) * 8;
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

    const spr = getTileSprite(kind, col, row);
    tc.addChild(spr);

    // Armies are lightweight overlays so the existing terrain/building art is
    // unchanged. A blue marker is owned, red is foreign; a small pennant means
    // at least one army on the tile is marching.
    if (!inFog && td?.armies?.length) {
      const marker = new Graphics();
      const owned = td.armies.every((army) => army.owner?.value === $userId);
      const color = owned ? 0x60a5fa : 0xf87171;
      marker.circle(15, -8, 7);
      marker.fill({ color: 0x101512, alpha: 0.92 });
      marker.circle(15, -8, 7);
      marker.stroke({ color, width: td.armies.length > 1 ? 3 : 2, alpha: 0.95 });
      marker.moveTo(15, -15);
      marker.lineTo(15, -25);
      marker.stroke({ color, width: 1.5, alpha: 0.95 });
      marker.poly([15, -25, 23, -22, 15, -19]);
      marker.fill({ color, alpha: 0.95 });
      if (td.armies.some((army) => army.destination)) {
        marker.moveTo(9, 2);
        marker.lineTo(18, 2);
        marker.lineTo(15, -1);
        marker.moveTo(18, 2);
        marker.lineTo(15, 5);
        marker.stroke({ color, width: 1.5, alpha: 0.9 });
      }
      tc.addChild(marker);
    }

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
        for (let i = 0; i < 4; i++) {
          const [dc, dr] = EDGE_TO_NEIGHBOR[i];
          const nd = tileData.get(tileKey(col + dc, row + dr));
          if (nd?.city?.cityId?.value === cityId?.value) continue;
          // This diamond edge is a boundary — draw it
          const vi = i * 2,
            vn = ((i + 1) % 4) * 2;
          g.moveTo(DIAMOND_VERTS[vi], DIAMOND_VERTS[vi + 1]);
          g.lineTo(DIAMOND_VERTS[vn], DIAMOND_VERTS[vn + 1]);
          g.stroke({ color: oc, width: 3, alpha: 0.8 });
          hasOverlay = true;
        }
      }

      // Visibility edge glow
      if (dist >= $gameConfig.visionRadius - 1) {
        g.poly(DIAMOND_VERTS);
        g.stroke({ color: 0x40a0b0, width: 1.5, alpha: 0.2 });
        hasOverlay = true;
      }

      if (hasOverlay) tc.addChild(g);

      // Starvation indicator — pulsing red around the territory border, plus a
      // caution icon on the city/town center. Added last so it draws on top.
      if (td?.city?.starving) {
        const cityId = td.city.cityId;
        const segs: number[][] = [];
        for (let i = 0; i < 4; i++) {
          const [dc, dr] = EDGE_TO_NEIGHBOR[i];
          if (tileData.get(tileKey(col + dc, row + dr))?.city?.cityId?.value === cityId?.value) continue;
          const vi = i * 2,
            vn = ((i + 1) % 4) * 2;
          segs.push([DIAMOND_VERTS[vi], DIAMOND_VERTS[vi + 1], DIAMOND_VERTS[vn], DIAMOND_VERTS[vn + 1]]);
        }
        const isCenter = td.building?.type === BuildingType.CITY_CENTER || td.building?.type === BuildingType.TOWN_CENTER;
        if (segs.length || isCenter) {
          const sg = new Graphics();
          tc.addChild(sg);
          starvingGfx.set(k, { gfx: sg, segs, isCenter });
        }
      }
    }
  };

  const loadVisible = () => {
    if (!cont) return;
    const s = cont.scale.x;
    // Map the 4 viewport corners into tile space; the affine image of a rect is
    // a parallelogram, so its tile-space AABB is the min/max over the corners.
    const corners = [
      [0, 0],
      [cw, 0],
      [0, ch],
      [cw, ch]
    ];
    let xMin = Infinity,
      xMax = -Infinity,
      yMin = Infinity,
      yMax = -Infinity;
    for (const [px, py] of corners) {
      const t = screenToTile((px - cont.x) / s, (py - cont.y) / s);
      xMin = Math.min(xMin, t.x);
      xMax = Math.max(xMax, t.x);
      yMin = Math.min(yMin, t.y);
      yMax = Math.max(yMax, t.y);
    }
    // Pad sides by 2; extend the bottom rows by 4 so tall sprites poking up from
    // below the viewport still render.
    const colMin = Math.floor(xMin) - 2,
      colMax = Math.ceil(xMax) + 2;
    const rowMin = Math.floor(yMin) - 2,
      rowMax = Math.ceil(yMax) + 4;
    // Feed the minimap's viewport rectangle (tile-space AABB of the view).
    viewTilesW = xMax - xMin;
    viewTilesH = yMax - yMin;
    for (let col = colMin; col <= colMax; col++) for (let row = rowMin; row <= rowMax; row++) renderTile(col, row);
  };

  // ── selection ───────────────────────────────────────────
  const drawSel = (col: number, row: number) => {
    if (selGfx) {
      cont.removeChild(selGfx);
      selGfx.destroy();
    }
    selGfx = new Graphics();
    const { sx: px, sy: py } = tileToScreen(col, row);
    selGfx.position.set(px, py);
    selGfx.poly(DIAMOND_VERTS);
    selGfx.fill({ color: 0xffd700, alpha: 0.15 });
    selGfx.poly(DIAMOND_VERTS);
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
      velX = velY = 0;
      lastMoveT = performance.now();
      lastMoveX = p.x;
      lastMoveY = p.y;
    });

    cont.on('pointermove', (e) => {
      if (!drag) return;
      const p = e.data.global;
      // Drag is 1:1 (no easing); keep the target locked to the rendered camera.
      const c = clampPos(csx + (p.x - dsx), csy + (p.y - dsy), cont.scale.x);
      cont.x = c.x;
      cont.y = c.y;
      tgtX = c.x;
      tgtY = c.y;
      // Track pointer velocity (px/sec) to seed release momentum.
      const nowT = performance.now();
      const dt = (nowT - lastMoveT) / 1000;
      if (dt > 0) {
        velX = (p.x - lastMoveX) / dt;
        velY = (p.y - lastMoveY) / dt;
      }
      lastMoveT = nowT;
      lastMoveX = p.x;
      lastMoveY = p.y;
      loadVisible();
      mapCenter.set(getCenter());
    });

    cont.on('pointerup', (e) => {
      if (!drag) return;
      drag = false;
      const p = e.data.global;
      const dx = p.x - dsx,
        dy = p.y - dsy;
      if (Math.sqrt(dx * dx + dy * dy) < CLICK_DIST) {
        velX = velY = 0;
        const mc = screenToTile((p.x - cont.x) / cont.scale.x, (p.y - cont.y) / cont.scale.y);
        if (mc.x >= 0 && mc.y >= 0 && mc.x < $gameConfig.mapSize && mc.y < $gameConfig.mapSize) {
          const t = tileData.get(tileKey(mc.x, mc.y));
          sel = { x: mc.x, y: mc.y, ...t };
          err = '';
          showBuild = false;
          drawSel(mc.x, mc.y);
        }
      } else if (!easeMotion || performance.now() - lastMoveT > 80) {
        // No flick (or motion easing off): stop where released.
        velX = velY = 0;
        mapCenter.set(getCenter());
      } else {
        // Flick: cap the throw speed; the ticker coasts the target from here.
        velX = Math.max(-4000, Math.min(4000, velX));
        velY = Math.max(-4000, Math.min(4000, velY));
      }
    });

    cont.on('pointerupoutside', () => {
      if (drag) mapCenter.set(getCenter());
      drag = false;
    });

    // Keep wheel input dedicated to zoom. Map movement is pointer drag or the
    // keyboard, so smooth-wheel mice can never be mistaken for trackpads.
    app.canvas.addEventListener('wheel', onWheel, { passive: false });
  };

  const onWheel = (e: WheelEvent) => {
    if (!cont) return;
    e.preventDefault();
    const rect = app.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const deltaPixels = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? e.deltaY * ch : e.deltaY;
    const sensitivity = e.ctrlKey ? 0.0006 : 0.0015;
    const rawFactor = Math.exp(-deltaPixels * sensitivity);
    const maxStep = e.ctrlKey ? 1.08 : 1.12;
    zoomAt(mx, my, Math.max(1 / maxStep, Math.min(maxStep, rawFactor)));
  };

  const logout = () => {
    clearSession();
    goto('/login');
  };

  // Center+select the next/previous owned city, wrapping around.
  const cycleCity = (dir: number) => {
    if (!ownedCities.length) return;
    cityCycleIdx = (cityCycleIdx + dir + ownedCities.length) % ownedCities.length;
    centerOnCity(ownedCities[cityCycleIdx]);
  };

  const onKeydown = (e: KeyboardEvent) => {
    // Don't hijack browser shortcuts (cmd/ctrl) or typing in form fields.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;

    const step = e.shiftKey ? PAN_STEP * 3 : PAN_STEP;
    switch (e.key) {
      case 'ArrowRight':
      case 'd':
      case 'D':
        panBy(-step, 0);
        break;
      case 'ArrowLeft':
      case 'a':
      case 'A':
        panBy(step, 0);
        break;
      case 'ArrowDown':
      case 's':
      case 'S':
        panBy(0, -step);
        break;
      case 'ArrowUp':
      case 'w':
      case 'W':
        panBy(0, step);
        break;
      case '=':
      case '+':
        zoomAt(cw / 2, ch / 2, 1.15);
        break;
      case '-':
      case '_':
        zoomAt(cw / 2, ch / 2, 1 / 1.15);
        break;
      case '0':
        if (cont) zoomAt(cw / 2, ch / 2, 1 / tgtScale);
        break;
      case 'c':
      case 'C': {
        const cap = ownedCities.find((x) => x.type === CityType.CITY) ?? ownedCities[0];
        if (cap) centerOnCity(cap);
        break;
      }
      case ']':
        cycleCity(1);
        break;
      case '[':
        cycleCity(-1);
        break;
      case '?':
      case 'h':
      case 'H':
        showHelp = !showHelp;
        break;
      case 'Escape':
        if (showHelp) showHelp = false;
        else deselect();
        break;
      default:
        return;
    }
    e.preventDefault();
  };
</script>

<svelte:head>
  <title>Game - city.io</title>
</svelte:head>

<!-- Keyboard shortcuts; close pinned menus when clicking outside them -->
<svelte:window
  on:keydown={onKeydown}
  on:click={(e) => {
    if (ratesOpen && ratesEl && !ratesEl.contains(e.target as Node)) ratesOpen = false;
    if (citiesOpen && citiesEl && !citiesEl.contains(e.target as Node)) citiesOpen = false;
  }}
/>

<!-- Population change chip: people icon + direction, so it's clearly tied to
     population. Growing = green ▲, declining = red ▼, steady = gray. -->
{#snippet popChip(rate: number)}
  {@const up = rate >= 0.5}
  {@const down = rate <= -0.5}
  <span class="inline-flex shrink-0 items-center gap-1 whitespace-nowrap {up ? 'text-emerald-400' : down ? 'text-red-400' : 'text-gray-500'}" title="Population change / hr">
    <svg viewBox="0 0 24 24" fill="currentColor" class="h-3 w-3 shrink-0"
      ><path
        d="M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0 1.5c-3.3 0-6 1.7-6 3.8V18h12v-1.7c0-2.1-2.7-3.8-6-3.8zm7.5-1.5a3 3 0 100-6 3 3 0 000 6zm.5 1.5c-.6 0-1.2.07-1.7.2 1.1.8 1.7 1.9 1.7 3.1V18h5v-1.5c0-1.9-2.3-3.5-5-3.5z"
      /></svg
    >
    <span class="tabular-nums"
      >{#if up}▲ {Math.abs(Math.round(rate)).toLocaleString()}/hr{:else if down}▼ {Math.abs(Math.round(rate)).toLocaleString()}/hr{:else}stable{/if}</span
    >
  </span>
{/snippet}

<div class="relative h-screen w-screen overflow-hidden bg-[#0e110f]">
  <!-- Canvas -->
  <div bind:this={el} class="absolute inset-0 cursor-grab active:cursor-grabbing"></div>

  <!-- Separate HUD clusters keep the map from feeling boxed in by one navbar. -->
  <div class="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-2 sm:inset-x-4 sm:top-4">
    <div class="hud-surface pointer-events-auto hidden h-12 min-w-10 items-center gap-2.5 px-3 sm:flex">
      <span class="h-2 w-2 shrink-0 rounded-sm bg-emerald-400"></span>
      <span class="hidden max-w-32 truncate text-xs font-medium text-[#d5dbd6] sm:block">{$username}</span>
    </div>

    <!-- Resources (hover for per-hour rates, click to pin) -->
    <div class="hud-surface group pointer-events-auto absolute left-0 sm:left-1/2 sm:-translate-x-1/2" bind:this={ratesEl}>
      <button type="button" class="flex h-12 items-center gap-4 px-3 text-left sm:gap-6 sm:px-4" on:click={() => (ratesOpen = !ratesOpen)} aria-expanded={ratesOpen}>
        <span class="flex min-w-[3.5rem] items-center gap-2.5">
          <span class="hidden h-6 w-6 items-center justify-center rounded-sm bg-amber-300/10 text-amber-200 sm:flex">
            <svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5"><circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="3" fill="#171c18" opacity="0.55" /></svg>
          </span>
          <span class="flex flex-col gap-1.5 leading-none">
            <span class="text-[8px] font-semibold uppercase tracking-[0.16em] text-[#737d75]">Gold</span>
            <span class="text-[13px] font-semibold tabular-nums text-amber-100">{$gold.toLocaleString()}</span>
          </span>
        </span>
        <span class="h-7 w-px bg-white/[0.08]"></span>
        <span class="flex min-w-[3.5rem] items-center gap-2.5">
          <span class="hidden h-6 w-6 items-center justify-center rounded-sm bg-emerald-300/10 text-emerald-300 sm:flex">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" class="h-4 w-4"
              ><path d="M4 13c0-3.2 2.4-5 6-5s6 1.8 6 5a1 1 0 01-1 1H5a1 1 0 01-1-1zM7.5 9.5v4M10 8.8V14M12.5 9.5v4" /></svg
            >
          </span>
          <span class="flex flex-col gap-1.5 leading-none">
            <span class="text-[8px] font-semibold uppercase tracking-[0.16em] text-[#737d75]">Food</span>
            <span class="text-[13px] font-semibold tabular-nums text-emerald-200">{$food.toLocaleString()}</span>
          </span>
        </span>
      </button>
      <div
        class="pointer-events-none absolute left-1/2 top-full w-56 -translate-x-1/2 pt-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 {ratesOpen
          ? 'opacity-100'
          : ''}"
      >
        <div class="inspector-panel p-3">
          <div class="panel-title mb-2">Production per hour</div>
          <div class="flex items-center justify-between gap-3 text-xs">
            <span class="text-[#8d968f]">Gold</span>
            <span class="tabular-nums text-amber-200">{fmtPerHour(goldPerHour)}</span>
          </div>
          <div class="mt-2 flex items-center justify-between gap-3 text-xs">
            <span class="text-[#8d968f]">Food</span>
            <span class="font-medium tabular-nums {netFoodPerHour < 0 ? 'text-red-400' : 'text-emerald-300'}">{fmtPerHour(netFoodPerHour)}</span>
          </div>
          <div class="mt-2 space-y-1 border-t border-white/[0.07] pt-2 text-[10px] tabular-nums text-[#717a73]">
            <div class="flex items-center justify-between gap-3"><span>Produced</span><span>{fmtPerHour(foodProdPerHour)}</span></div>
            <div class="flex items-center justify-between gap-3"><span>Upkeep</span><span>{fmtPerHour(-foodUpkeepPerHour)}</span></div>
          </div>
        </div>
      </div>
    </div>

    <div class="pointer-events-auto ml-auto flex items-center gap-2">
      {#if myCities.length > 0}
        <div class="relative" bind:this={citiesEl}>
          <button
            type="button"
            class="hud-surface flex h-12 items-center gap-2 px-3 text-xs font-medium text-[#c7cec8] transition-colors hover:text-white"
            on:click={() => (citiesOpen = !citiesOpen)}
            aria-expanded={citiesOpen}
          >
            <span class="text-sm font-semibold tabular-nums text-white">{myCities.length}</span>
            <span class="hidden text-[#7d877f] sm:inline">{myCities.length === 1 ? 'city' : 'cities'}</span>
            <svg viewBox="0 0 20 20" fill="currentColor" class="h-3 w-3 text-[#747d76] transition-transform duration-150 {citiesOpen ? 'rotate-180' : ''}">
              <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
            </svg>
          </button>
          {#if citiesOpen}
            <div class="inspector-panel absolute right-0 top-[calc(100%+0.5rem)] w-64 overflow-hidden p-1.5">
              <div class="panel-title px-2 pb-1.5 pt-1">Your cities</div>
              {#each myCities as rawCity}
                {@const city = liveCity(rawCity)}
                {@const prod = cityProd(city)}
                {@const foodNet = ratePerHour(city.netFoodFlow)}
                {@const popGrowth = ratePerHour(city.populationGrowth)}
                <button
                  class="group w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-white/[0.06]"
                  on:click={() => {
                    centerOnCity(city);
                    citiesOpen = false;
                  }}
                >
                  <div class="flex items-center gap-2">
                    <span class="h-1.5 w-1.5 rounded-sm {city.starving ? 'animate-pulse bg-red-400' : 'bg-emerald-400'}"></span>
                    <span class="min-w-0 flex-1 truncate text-xs font-medium text-[#d5dad6]">{city.name}</span>
                    {#if city.starving}<span class="text-[9px] font-medium uppercase tracking-wide text-red-400">Starving</span>{/if}
                  </div>
                  <div class="mt-1 flex items-center gap-3 pl-3.5 text-[10px] tabular-nums text-[#79827b]">
                    <span class="text-amber-200/80">{Math.round(prod.gold).toLocaleString()} gold/hr</span>
                    <span class={foodNet < 0 ? 'text-red-400' : 'text-emerald-300/80'}>{fmtPerHour(foodNet)} food/hr</span>
                    {@render popChip(popGrowth)}
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <button class="hud-surface flex h-12 w-11 items-center justify-center text-[#778078] transition-colors hover:text-white" title="Sign out" aria-label="Sign out" on:click={logout}>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" class="h-4 w-4"
          ><path d="M8 4H5.5A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8M12.5 6.5L16 10l-3.5 3.5M8 10h8" stroke-linecap="round" stroke-linejoin="round" /></svg
        >
      </button>
    </div>
  </div>

  <!-- The inspector only appears for an active selection, leaving the map open. -->
  <div class="pointer-events-none absolute bottom-4 right-3 top-20 flex w-[19rem] max-w-[calc(100vw-1.5rem)] flex-col sm:right-4">
    {#if sel}
      <div class="inspector-panel pointer-events-auto max-h-full overflow-y-auto" transition:fly={{ x: 16, duration: 200 }}>
        <div class="inspector-header flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="inspector-label mb-1">
              {#if sel.building}Structure{:else if sel.armies?.length}Forces{:else if sel.city}{cName(sel.city.type)}{:else}Terrain{/if}
            </div>
            <h2 class="truncate text-base font-semibold tracking-[-0.02em] text-[#f0f2f0]">
              {#if sel.building}
                {bName(sel.building.type)}
              {:else if sel.armies?.length}
                {sel.armies.length === 1 ? 'Army' : `${sel.armies.length} armies`}
              {:else if sel.city}
                {sel.city.name}
              {:else}
                Open ground
              {/if}
            </h2>
            <div class="mt-1 font-mono text-[9px] tabular-nums text-[#687169]">X {sel.x.toString().padStart(2, '0')} / Y {sel.y.toString().padStart(2, '0')}</div>
          </div>
          <button
            aria-label="Close"
            class="flex h-7 w-7 shrink-0 items-center justify-center border border-white/[0.07] text-[#707a72] transition-colors duration-150 hover:border-white/[0.14] hover:text-white"
            on:click={deselect}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {#if err}
          <div class="mx-4 mt-3 border-l-2 border-red-400 bg-red-500/[0.08] px-3 py-2 text-[11px] text-red-400">{err}</div>
        {/if}

        {#if sel.city}
          <section class="inspector-section">
            <div class="mb-3 flex items-center justify-between gap-3">
              <span class="inspector-label">Settlement</span>
              {#if sel.city.owner?.value === $userId}
                <span class="flex items-center gap-1.5 text-[10px] font-medium text-blue-300"><span class="h-1.5 w-1.5 bg-blue-400"></span>Yours</span>
              {:else if sel.city.owner}
                <span class="flex items-center gap-1.5 text-[10px] font-medium text-red-300"><span class="h-1.5 w-1.5 bg-red-400"></span>Foreign</span>
              {:else}
                <span class="flex items-center gap-1.5 text-[10px] font-medium text-[#8c958e]"><span class="h-1.5 w-1.5 bg-[#788179]"></span>Neutral</span>
              {/if}
            </div>

            {#if sel.building || sel.armies?.length}
              <div class="mb-3 truncate text-[13px] font-medium text-[#d6dbd7]">{sel.city.name}</div>
            {/if}

            <div class="grid grid-cols-2 gap-x-5 gap-y-3">
              <div>
                <div class="inspector-stat-label">Population</div>
                <div class="inspector-stat-value">{sel.city.population.toFixed(0)} <span class="text-[#636d65]">/ {sel.city.populationCap.toFixed(0)}</span></div>
              </div>
              <div>
                <div class="inspector-stat-label">Military</div>
                <div class="inspector-stat-value">{sel.city.militaryPopulation.toFixed(0)}</div>
              </div>
              <div>
                <div class="inspector-stat-label">Growth</div>
                <div class="mt-1 text-[11px]">{@render popChip(ratePerHour(sel.city.populationGrowth))}</div>
              </div>
              {#if sel.city.starving}
                <div>
                  <div class="inspector-stat-label">Status</div>
                  <div class="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-red-400"><span class="h-1.5 w-1.5 animate-pulse bg-red-400"></span>Starving</div>
                </div>
              {/if}
            </div>

            <!-- Food economy is owner-only intel; non-owners receive these unset -->
            {#if sel.city.owner?.value === $userId}
              {@const netFlow = ratePerHour(sel.city.netFoodFlow)}
              <div class="mt-4 border-t border-white/[0.07] pt-3">
                <div class="inspector-row">
                  <span>Food produced</span>
                  <span class="text-emerald-300">{Math.round(ratePerHour(sel.city.foodProduction)).toLocaleString()}/hr</span>
                </div>
                <div class="inspector-row">
                  <span>Food upkeep</span>
                  <span class="text-red-300/80">{fmtPerHour(-ratePerHour(sel.city.foodUpkeep))}/hr</span>
                </div>
                <div class="inspector-row mt-1 border-t border-white/[0.05] pt-2">
                  <span>{netFlow >= 0 ? 'Net surplus' : 'Pool draw'}</span>
                  <span class="font-semibold {netFlow >= 0 ? 'text-emerald-300' : 'text-red-400'}">{fmtPerHour(netFlow)}/hr</span>
                </div>
              </div>
            {/if}
          </section>
        {/if}

        {#if sel.armies?.length}
          <section class="inspector-section">
            <div class="mb-3 flex items-center justify-between">
              <span class="inspector-label">Forces on tile</span>
              <span class="text-[10px] font-medium tabular-nums text-[#9aa39c]">{sel.armies.reduce((sum, army) => sum + armySize(army), 0)} troops</span>
            </div>
            <div class="space-y-3">
              {#each sel.armies as army, index}
                <div class="border-l-2 pl-3 {army.owner?.value === $userId ? 'border-blue-400/70' : 'border-red-400/70'} {index > 0 ? 'pt-0.5' : ''}">
                  <div class="flex items-center justify-between gap-2 text-[10px]">
                    <span class={army.owner?.value === $userId ? 'font-semibold text-blue-300' : 'font-semibold text-red-300'}>{army.owner?.value === $userId ? 'Your army' : 'Foreign army'}</span>
                    <span class="text-[#778179]">{army.destination ? `To ${army.destination.x}, ${army.destination.y}` : 'Holding'}</span>
                  </div>
                  <p class="mt-1.5 text-[11px] leading-relaxed text-[#b3bab5]">
                    {army.troops
                      .filter((stack) => stack.count > 0)
                      .map((stack) => `${stack.count} ${troopName(stack.type)}`)
                      .join(', ') || 'No troops'}
                  </p>
                </div>
              {/each}
            </div>
          </section>
        {/if}

        <!-- Building information -->
        {#if sel.building}
          {@const isBuilding = sel.building.level === 0}
          {@const stats = isBuilding ? null : getLevelStats(sel.building.type, sel.building.level)}
          {@const nextStats = getLevelStats(sel.building.type, sel.building.level + 1)}
          <section class="inspector-section">
            <div class="flex items-center justify-between">
              <span class="inspector-label">Structure</span>
              {#if !isBuilding}
                <span class="text-[10px] font-semibold tabular-nums text-amber-200">Level {sel.building.level}</span>
              {/if}
            </div>
            {#if sel.building.constructionStart && sel.building.constructionEnd}
              {@const startMs = Number(sel.building.constructionStart.seconds) * 1000}
              {@const endMs = Number(sel.building.constructionEnd.seconds) * 1000}
              {@const totalMs = endMs - startMs}
              {@const elapsedMs = now - startMs}
              {@const remainMs = endMs - now}
              {@const pct = Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100))}
              <div class="mt-3 space-y-2">
                <div class="flex items-center justify-between text-[10px]">
                  <span class="font-medium text-amber-300/80">
                    {isBuilding ? 'Building' : `Upgrading to Lv ${sel.building.targetLevel}`}
                  </span>
                  <span class="font-medium tabular-nums text-amber-200">{remainMs > 0 ? fmtCountdown(remainMs) : 'Done'}</span>
                </div>
                <div class="h-1 overflow-hidden bg-white/[0.07]">
                  <div class="h-full transition-all duration-1000 ease-linear {remainMs <= 0 ? 'bg-emerald-400' : 'bg-amber-300'}" style="width: {pct.toFixed(1)}%"></div>
                </div>
              </div>
            {/if}
            {#if stats}
              <div class="mt-3 border-t border-white/[0.07] pt-2">
                {#if stats.production.length > 0}
                  <div class="inspector-row">
                    <span>Production</span>
                    <span class="text-emerald-300">{stats.production.map(fmtProd).join(', ')}</span>
                  </div>
                {/if}
                {#if stats.population > 0}
                  <div class="inspector-row">
                    <span>Population capacity</span>
                    <span class="text-blue-300">+{stats.population}</span>
                  </div>
                {/if}
              </div>
            {/if}
            {#if nextStats && sel.city?.owner?.value === $userId}
              <div class="mt-3 border-t border-white/[0.07] pt-3">
                <div class="inspector-label mb-1">Next level</div>
                <div class="inspector-row">
                  <span>Cost</span>
                  <span class="text-amber-200">{nextStats.cost.map(fmtRes).join(', ')}</span>
                </div>
                <div class="inspector-row">
                  <span>Build time</span>
                  <span>{fmtTime(nextStats.constructionTime)}</span>
                </div>
                {#if nextStats.production.length > 0}
                  <div class="inspector-row">
                    <span>Production</span>
                    <span>
                      {#if stats}
                        <span class="text-[#646e66]">{stats.production.map(fmtProdNum).join(', ')}</span>
                        <span class="mx-1 text-[#555e57]">&rarr;</span>
                      {/if}
                      <span class="text-emerald-300">{nextStats.production.map(fmtProdNum).join(', ')}</span>
                      <span class="text-[#717b73]">{prodUnit(nextStats.production)}</span>
                    </span>
                  </div>
                {/if}
                {#if nextStats.population > 0}
                  <div class="inspector-row">
                    <span>Population capacity</span>
                    <span>
                      {#if stats}
                        <span class="text-[#646e66]">+{stats.population}</span>
                        <span class="mx-1 text-[#555e57]">&rarr;</span>
                      {/if}
                      <span class="text-blue-300">+{nextStats.population}</span>
                    </span>
                  </div>
                {/if}
              </div>
            {/if}
          </section>
          {#if sel.city?.owner?.value === $userId}
            {@const upgrading = !!(sel.building.constructionStart && sel.building.constructionEnd && Number(sel.building.constructionEnd.seconds) * 1000 > now)}
            <div class="inspector-actions flex gap-2">
              <button
                class="game-action game-action-primary flex-1"
                disabled={busy || upgrading}
                on:click={() => sel?.building && doAction(() => buildingClient.upgradeBuilding({ buildingId: sel!.building!.buildingId }), 'Upgrade failed')}>{busy ? '...' : 'Upgrade'}</button
              >
              <button
                class="game-action game-action-danger flex-1"
                disabled={busy || upgrading}
                on:click={() => sel?.building && doAction(() => buildingClient.deleteBuilding({ buildingId: sel!.building!.buildingId }), 'Demolish failed')}>{busy ? '...' : 'Demolish'}</button
              >
            </div>
          {/if}
        {:else if sel.city?.owner?.value === $userId}
          {#if showBuild}
            {@const buildStats = getLevelStats(buildType, 1)}
            <section class="inspector-section">
              <div class="mb-3 flex items-center justify-between">
                <span class="inspector-label">Choose structure</span>
                <button class="text-[10px] font-medium text-[#818a83] transition-colors hover:text-white" on:click={() => (showBuild = false)}>Cancel</button>
              </div>
              <div class="grid grid-cols-2 border-l border-t border-white/[0.07]">
                {#each placeTypes as bt}
                  <button
                    class="border-b border-r border-white/[0.07] px-2 py-2.5 text-[11px] font-medium transition-colors
										{buildType === bt ? 'bg-emerald-300/10 text-emerald-200' : 'text-[#8f9891] hover:bg-white/[0.04] hover:text-white'}"
                    on:click={() => (buildType = bt)}>{bName(bt)}</button
                  >
                {/each}
              </div>
              {#if buildStats}
                <div class="mt-4 border-t border-white/[0.07] pt-2">
                  <div class="inspector-row">
                    <span>Cost</span>
                    <span class="text-amber-200">{buildStats.cost.map(fmtRes).join(', ')}</span>
                  </div>
                  <div class="inspector-row">
                    <span>Build time</span>
                    <span>{fmtTime(buildStats.constructionTime)}</span>
                  </div>
                  {#if buildStats.production.length > 0}
                    <div class="inspector-row">
                      <span>Produces</span>
                      <span class="text-emerald-300">{buildStats.production.map(fmtProd).join(', ')}</span>
                    </div>
                  {/if}
                  {#if buildStats.population > 0}
                    <div class="inspector-row">
                      <span>Population capacity</span>
                      <span class="text-blue-300">+{buildStats.population}</span>
                    </div>
                  {/if}
                </div>
              {/if}
            </section>
            <div class="inspector-actions">
              <button
                class="game-action game-action-primary w-full"
                disabled={busy}
                on:click={() => sel?.city && doAction(() => buildingClient.createBuilding({ cityId: sel!.city!.cityId, type: buildType, coords: { x: sel!.x, y: sel!.y } }), 'Build failed')}
                >{busy ? '...' : `Place ${bName(buildType)}`}</button
              >
            </div>
          {:else}
            <div class="inspector-actions">
              <button class="game-action game-action-primary w-full" on:click={() => (showBuild = true)}>Build structure</button>
            </div>
          {/if}
        {:else if !sel.city && !sel.armies?.length}
          <div class="px-4 py-8 text-center text-xs text-[#6f7971]">
            {myCities.length > 0 && getVisDist(sel.x, sel.y) > $gameConfig.visionRadius ? 'Beyond visibility range' : 'No structures on this tile'}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Bottom hint -->
  {#if !sel}
    <div class="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2" transition:fade={{ duration: 200 }}>
      <span class="rounded-full bg-black/40 px-3 py-1.5 text-[11px] font-medium text-white/60 backdrop-blur-sm">Select a tile to inspect</span>
    </div>
  {/if}

  <!-- Minimap -->
  <div class="pointer-events-auto absolute bottom-4 left-4">
    <MiniMap onPan={(col, row) => centerCam(col, row)} viewCols={viewTilesW} viewRows={viewTilesH} />
  </div>

  <!-- Keyboard shortcuts toggle -->
  <button
    class="hud-surface pointer-events-auto absolute bottom-4 left-[186px] flex h-8 w-8 items-center justify-center text-xs font-medium text-white/70 transition-colors hover:text-white"
    title="Keyboard shortcuts (?)"
    on:click={() => (showHelp = !showHelp)}>?</button
  >

  <!-- Keyboard shortcuts overlay -->
  {#if showHelp}
    <div
      class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/40"
      on:click={() => (showHelp = false)}
      on:keydown={() => {}}
      role="presentation"
      transition:fade={{ duration: 150 }}
    >
      <div class="panel w-72 p-5" on:click|stopPropagation on:keydown|stopPropagation role="presentation">
        <div class="panel-title mb-3 text-[11px]">Keyboard Shortcuts</div>
        <div class="space-y-1.5 text-xs text-stone-200">
          {#each [['Pan', 'Click + drag / WASD'], ['Pan faster', 'Shift + move'], ['Zoom', 'Wheel / + / −'], ['Reset zoom', '0'], ['Center capital', 'C'], ['Cycle cities', '[ / ]'], ['Deselect', 'Esc'], ['Toggle this help', '?']] as [label, keys]}
            <div class="flex items-center justify-between gap-4">
              <span class="text-gray-400">{label}</span>
              <kbd class="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-gray-300">{keys}</kbd>
            </div>
          {/each}
        </div>
        <div class="mt-3 border-t border-white/[0.06] pt-2 text-[10px] text-gray-600">Zoom centers on the cursor. Drag anywhere on the map to move.</div>
      </div>
    </div>
  {/if}
</div>
