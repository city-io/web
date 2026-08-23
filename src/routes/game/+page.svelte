<script lang="ts">
  import { armies, buildings, cities, mapCenter, tiles, username, gold, food, userId, gameConfig } from '$lib/stores';
  import { clearSession } from '$lib/session';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { Application, Container, Graphics, Rectangle, Text } from 'pixi.js';
  import { HW, HH, DIAMOND_VERTS, EDGE_TO_NEIGHBOR, tileToScreen, screenToTile, tileKey, mapBounds } from '$lib/game/iso';
  import { getStructureSprite, getTerrainSprite, getTerrainTransitionSprite, initSprites, type StructureKind, type TerrainKind, type TerrainNeighbors } from '$lib/game/sprites';
  import { TROOP_STATS, TROOP_TYPES, armyPathCost, armySize, armyTitle, createArmyMarker, findArmyPath, troopName, type ArmyPathStep } from '$lib/game/troops';
  import MiniMap from '$lib/components/MiniMap.svelte';
  import { ratePerHour, fmtPerHour, durationSeconds } from '$lib/game/rates';
  import type { City } from '$lib/gen/cityio/entity/v1/city_pb';
  import type { Building } from '$lib/gen/cityio/entity/v1/building_pb';
  import type { Army } from '$lib/gen/cityio/entity/v1/army_pb';
  import { BuildingType, CityType, TroopType } from '$lib/gen/cityio/entity/v1/common_pb';
  import { TerrainType, type Tile } from '$lib/gen/cityio/entity/v1/tile_pb';
  import type { TrainingOrder } from '$lib/gen/cityio/service/v1/army_pb';
  import type { BuildingConfig, BuildingLevelStats, ResourceRate } from '$lib/gen/cityio/service/v1/config_pb';
  import type { Duration, Timestamp } from '@bufbuild/protobuf/wkt';
  import { Code, ConnectError } from '@connectrpc/connect';
  import { armyClient, buildingClient, cityClient } from '$lib/api/client';

  // ── constants ──────────────────────────────────────────
  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 3;
  const CLICK_DIST = 5;

  // ── pixi state ──────────────────────────────────────────
  let app: Application;
  let cont: Container;
  let labelLayer: Container;
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
  let tileData = new Map<string, { tile?: Tile; city?: City; building?: Building; armies?: Army[] }>();
  let constructionGfx = new Map<string, { gfx: Graphics; startMs: number; endMs: number; cx: number; cy: number }>();
  let starvingGfx = new Map<string, { gfx: Graphics; segs: number[][]; isCenter: boolean }>();
  let selGfx: Graphics | null = null;

  // ── UI state ────────────────────────────────────────────
  let sel: { x: number; y: number; tile?: Tile; city?: City; building?: Building; armies?: Army[] } | null = null;
  let myCities: City[] = [];
  let buildType: BuildingType = BuildingType.HOUSE;
  const placeTypes = [BuildingType.HOUSE, BuildingType.FARM, BuildingType.MINE, BuildingType.BARRACKS];
  let busy = false;
  let err = '';
  let notice = '';
  let showBuild = false;
  let recruitType: (typeof TROOP_TYPES)[number] = TroopType.SOLDIER;
  let recruitCount = 1;
  let selectedArmyId: string | null = null;
  let moveArmyId: string | null = null;
  let trackedArmyId: string | null = null;
  let moveTarget: { x: number; y: number } | null = null;
  let moveHover: { x: number; y: number } | null = null;
  let moveRoute: ArmyPathStep[] | null = null;
  let moveRouteCost = 0;
  let moveGfx: Graphics | null = null;
  let trainingOrders: TrainingOrder[] = [];
  let trainingOrdersBarracksId: string | null = null;
  let trainingOrdersAvailable = true;
  let trainingOrdersLoading = false;
  let lastTrainingPoll = 0;

  // Compact top-bar menus keep secondary information off the map until needed.
  let ratesOpen = false;
  let ratesEl: HTMLDivElement;
  let citiesOpen = false;
  let citiesEl: HTMLDivElement;
  let armiesOpen = false;
  let armiesEl: HTMLDivElement;

  // Keyboard navigation
  let showHelp = false;
  let cityCycleIdx = -1;
  const PAN_STEP = 110;

  // Minimap viewport rectangle span (tile units), updated by loadVisible.
  let viewTilesW = 0;
  let viewTilesH = 0;
  let worldWidth = 0;
  let worldHeight = 0;

  $: worldWidth = $gameConfig.mapSize;
  $: worldHeight = $gameConfig.mapSize;

  const terrainAt = (col: number, row: number): TerrainType => {
    if (col < 0 || row < 0 || col >= worldWidth || row >= worldHeight) return TerrainType.GRASSLAND;
    return $tiles.get(tileKey(col, row))?.terrain ?? TerrainType.GRASSLAND;
  };

  const terrainKind = (value: TerrainType): TerrainKind => {
    switch (value) {
      case TerrainType.PLAINS:
        return 'plains';
      case TerrainType.FOREST:
        return 'forest';
      case TerrainType.HILLS:
        return 'hills';
      case TerrainType.MOUNTAINS:
        return 'mountains';
      case TerrainType.DESERT:
        return 'desert';
      case TerrainType.MARSH:
        return 'marsh';
      case TerrainType.WATER:
        return 'water';
      default:
        return 'grassland';
    }
  };

  const terrainInfo = (value: TerrainType): { name: string; note: string } => {
    switch (value) {
      case TerrainType.PLAINS:
        return { name: 'Plains', note: 'Broad, dry country with sparse grass and scrub.' };
      case TerrainType.FOREST:
        return { name: 'Forest', note: 'Dense woodland with little open ground.' };
      case TerrainType.HILLS:
        return { name: 'Hills', note: 'Rolling, uneven country broken by low ridges.' };
      case TerrainType.MOUNTAINS:
        return { name: 'Mountains', note: 'Steep high country dominated by exposed rock.' };
      case TerrainType.DESERT:
        return { name: 'Desert', note: 'Arid country shaped by wind and scarce water.' };
      case TerrainType.MARSH:
        return { name: 'Marsh', note: 'Waterlogged lowland with reeds and shallow pools.' };
      case TerrainType.WATER:
        return { name: 'Water', note: 'Open water beyond the shoreline.' };
      default:
        return { name: 'Grassland', note: 'Open, fertile country with low vegetation.' };
    }
  };

  const structureKind = (type: BuildingType): StructureKind => {
    if (type === BuildingType.FARM) return 'farm';
    if (type === BuildingType.MINE) return 'mine';
    if (type === BuildingType.BARRACKS) return 'barracks';
    if (type === BuildingType.CITY_CENTER) return 'city_center';
    if (type === BuildingType.TOWN_CENTER) return 'town_center';
    return 'house';
  };

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
  const barracksCapacity = (building: Building) => Math.max(0, building.level * 5);
  const trainablePopulation = (city?: City) => (city ? Math.max(0, Math.floor(city.population * 0.35 - city.militaryPopulation)) : 0);

  $: movingArmy = moveArmyId ? $armies.find((army) => army.armyId?.value === moveArmyId) : undefined;
  $: selectedArmy = selectedArmyId ? $armies.find((army) => army.armyId?.value === selectedArmyId) : undefined;
  $: ownedArmies = $armies.filter((army) => army.owner?.value === $userId).sort((a, b) => (a.armyId?.value ?? '').localeCompare(b.armyId?.value ?? ''));
  $: ownedArmyTroops = ownedArmies.reduce((total, army) => total + armySize(army), 0);
  $: selectedBarracksId = sel?.building?.type === BuildingType.BARRACKS && sel.city?.owner?.value === $userId ? (sel.building.buildingId?.value ?? null) : null;
  $: if (selectedBarracksId && trainingOrdersAvailable && (trainingOrdersBarracksId !== selectedBarracksId || now - lastTrainingPoll >= 3000)) {
    loadTrainingOrders(selectedBarracksId);
  }

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

  const timestampMs = (timestamp?: Timestamp): number => (timestamp ? Number(timestamp.seconds) * 1000 + timestamp.nanos / 1e6 : 0);

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
  $: if ($tiles || $cities || $buildings || $armies) {
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
    const tracked = trackedArmyId ? $armies.find((army) => army.armyId?.value === trackedArmyId) : undefined;
    if (tracked?.coords) {
      const x = tracked.coords.x;
      const y = tracked.coords.y;
      sel = { x, y, ...tileData.get(tileKey(x, y)) };
    } else if (trackedArmyId) {
      trackedArmyId = null;
      selectedArmyId = null;
      moveArmyId = null;
      moveTarget = null;
      moveHover = null;
    } else if (sel) {
      const t = tileData.get(tileKey(sel.x, sel.y));
      sel = { x: sel.x, y: sel.y, ...t };
    }
    scheduleRender();
  }

  // ── tile data ───────────────────────────────────────────
  const buildLookup = () => {
    tileData.clear();
    for (const [key, tile] of $tiles) tileData.set(key, { tile });
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
    for (const army of $armies) {
      if (army.owner?.value !== $userId || !army.coords) continue;
      min = Math.min(min, Math.max(Math.abs(army.coords.x - col), Math.abs(army.coords.y - row)));
    }
    return min;
  };

  const hasVisionSources = () => myCities.length > 0 || $armies.some((army) => army.owner?.value === $userId && army.coords);

  const getCenter = () => {
    if (!cont) return { x: 0, y: 0 };
    return screenToTile((-cont.x + cw / 2) / cont.scale.x, (-cont.y + ch / 2) / cont.scale.y);
  };

  // Clamp a container position to the iso map's screen-space AABB (pure).
  const clampPos = (x: number, y: number, s: number) => {
    const pad = 200;
    const b = mapBounds(worldWidth, worldHeight);
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
    trackedArmyId = null;
    selectedArmyId = null;
    cancelMoveMode();
    err = '';
    notice = '';
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
    for (const label of labelLayer?.removeChildren() ?? []) label.destroy({ children: true });
    constructionGfx.clear();
    starvingGfx.clear();
    if (selGfx) {
      selGfx.destroy();
      selGfx = null;
    }
    loadVisible();
    if (sel) drawSel(sel.x, sel.y);
    if (moveArmyId) drawMovePreview(moveTarget ?? moveHover);
  };

  const loadCities = async () => {
    try {
      myCities = (await cityClient.listCities({})).entities?.cities ?? [];
      rebuildTiles();
    } catch {
      /* */
    }
  };

  const errorText = (e: unknown, fallback: string): string => {
    if (e instanceof ConnectError) return e.rawMessage;
    return e instanceof Error ? e.message : fallback;
  };

  const doAction = async (fn: () => Promise<unknown>, msg: string) => {
    busy = true;
    err = '';
    notice = '';
    try {
      await fn();
    } catch (e: unknown) {
      err = errorText(e, msg);
    } finally {
      busy = false;
    }
  };

  const loadTrainingOrders = async (barracksId: string, reportError = false) => {
    if (trainingOrdersLoading) return;
    if (trainingOrdersBarracksId !== barracksId) {
      trainingOrders = [];
      trainingOrdersBarracksId = barracksId;
    }
    trainingOrdersLoading = true;
    lastTrainingPoll = Date.now();
    try {
      const response = await armyClient.listTrainingOrders({ barracksId: { value: barracksId } });
      if (selectedBarracksId === barracksId) trainingOrders = response.orders;
    } catch (e: unknown) {
      if (e instanceof ConnectError && e.code === Code.Unimplemented) {
        trainingOrdersAvailable = false;
        trainingOrders = [];
      } else if (reportError) {
        err = errorText(e, 'Could not load the training queue');
      }
    } finally {
      trainingOrdersLoading = false;
    }
  };

  const queueTroops = async () => {
    const barracks = sel?.building;
    if (!barracks || barracks.type !== BuildingType.BARRACKS) return;
    const capacity = barracksCapacity(barracks);
    const count = Math.max(1, Math.min(capacity, Math.floor(recruitCount)));
    const stat = TROOP_STATS[recruitType];
    recruitCount = count;
    busy = true;
    err = '';
    notice = '';
    try {
      const response = await armyClient.trainTroops({ barracksId: barracks.buildingId, type: recruitType, count });
      if (response.order) {
        const orderId = response.order.trainingOrderId?.value;
        trainingOrders = [...trainingOrders.filter((order) => order.trainingOrderId?.value !== orderId), response.order];
        trainingOrdersBarracksId = barracks.buildingId?.value ?? null;
      } else if (trainingOrdersAvailable && barracks.buildingId?.value) {
        void loadTrainingOrders(barracks.buildingId.value, true);
      }
      notice = `${count} ${troopName(recruitType, count)} queued. Training takes ${stat.trainSeconds}s once this order reaches the front.`;
    } catch (e: unknown) {
      err = errorText(e, 'Training order failed');
    } finally {
      busy = false;
    }
  };

  const mergeOwnedArmies = async (stack: Army[], targetId?: string) => {
    const owned = stack
      .filter((army) => army.owner?.value === $userId && army.armyId?.value)
      .sort((a, b) => Number(b.armyId?.value === targetId) - Number(a.armyId?.value === targetId) || armySize(b) - armySize(a));
    if (owned.length < 2) return;
    const target = owned[0];
    busy = true;
    err = '';
    notice = '';
    try {
      for (const source of owned.slice(1)) {
        await armyClient.mergeArmies({ targetArmyId: target.armyId, sourceArmyId: source.armyId });
      }
      trackedArmyId = target.armyId?.value ?? null;
      notice = `${owned.length} armies merged into one formation.`;
    } catch (e: unknown) {
      err = errorText(e, 'Army merge failed');
    } finally {
      busy = false;
    }
  };

  const clearMovePreview = () => {
    if (!moveGfx) return;
    cont?.removeChild(moveGfx);
    moveGfx.destroy();
    moveGfx = null;
  };

  const drawMovePreview = (destination: { x: number; y: number } | null) => {
    clearMovePreview();
    const army = moveArmyId ? $armies.find((candidate) => candidate.armyId?.value === moveArmyId) : undefined;
    moveRoute = null;
    moveRouteCost = 0;
    if (!cont || !army?.coords || !destination) return;

    moveRoute = findArmyPath($tiles, army.coords, destination);
    moveRouteCost = moveRoute ? armyPathCost($tiles, moveRoute) : 0;
    const points = [army.coords, ...(moveRoute ?? [])].map((step) => tileToScreen(step.x, step.y));

    const route = new Graphics();
    if (moveRoute) {
      for (const point of points.slice(1, -1)) {
        route.poly(DIAMOND_VERTS.map((value, index) => value * 0.72 + (index % 2 === 0 ? point.sx : point.sy)));
        route.fill({ color: 0x6ca7dc, alpha: 0.11 });
        route.poly(DIAMOND_VERTS.map((value, index) => value * 0.72 + (index % 2 === 0 ? point.sx : point.sy)));
        route.stroke({ color: 0x9cc9ee, width: 0.75, alpha: 0.32 });
      }
      const strokeRoute = (color: number, width: number, alpha: number) => {
        route.moveTo(points[0].sx, points[0].sy);
        for (const point of points.slice(1)) route.lineTo(point.sx, point.sy);
        route.stroke({ color, width, alpha });
      };
      strokeRoute(0x111611, 7, 0.85);
      strokeRoute(0x7eb5ec, 3, 1);
      route.circle(points[0].sx, points[0].sy, 5);
      route.fill({ color: 0x17202a, alpha: 0.95 });
      route.circle(points[0].sx, points[0].sy, 5);
      route.stroke({ color: 0xb9d9f2, width: 1.5, alpha: 1 });

      for (let index = 0; index < points.length - 1; index += 2) {
        const from = points[index];
        const to = points[index + 1];
        const dx = to.sx - from.sx;
        const dy = to.sy - from.sy;
        const length = Math.hypot(dx, dy) || 1;
        const nx = dx / length;
        const ny = dy / length;
        const px = -ny;
        const py = nx;
        const cx = (from.sx + to.sx) / 2;
        const cy = (from.sy + to.sy) / 2;
        route.poly([cx + nx * 5, cy + ny * 5, cx - nx * 4 + px * 3.5, cy - ny * 4 + py * 3.5, cx - nx * 4 - px * 3.5, cy - ny * 4 - py * 3.5]);
        route.fill({ color: 0xe2f1fb, alpha: 1 });
        route.poly([cx + nx * 5, cy + ny * 5, cx - nx * 4 + px * 3.5, cy - ny * 4 + py * 3.5, cx - nx * 4 - px * 3.5, cy - ny * 4 - py * 3.5]);
        route.stroke({ color: 0x17202a, width: 1, alpha: 0.9 });
      }
    }
    const target = tileToScreen(destination.x, destination.y);
    route.poly(DIAMOND_VERTS.map((value, index) => value + (index % 2 === 0 ? target.sx : target.sy)));
    route.fill({ color: moveRoute ? 0xf0d65a : 0xd96257, alpha: 0.13 });
    route.poly(DIAMOND_VERTS.map((value, index) => value + (index % 2 === 0 ? target.sx : target.sy)));
    route.stroke({ color: moveRoute ? 0xf0d65a : 0xd96257, width: 2, alpha: 0.95 });
    route.zIndex = 9e6;
    cont.addChild(route);
    moveGfx = route;
  };

  const clearMoveTarget = () => {
    moveTarget = null;
    moveHover = null;
    moveRoute = null;
    moveRouteCost = 0;
    clearMovePreview();
  };

  const cancelMoveMode = () => {
    moveArmyId = null;
    clearMoveTarget();
  };

  const focusArmy = (army: Army, center = true) => {
    const id = army.armyId?.value;
    if (!id || !army.coords) return;
    cancelMoveMode();
    selectedArmyId = id;
    trackedArmyId = id;
    const x = army.coords.x;
    const y = army.coords.y;
    sel = { x, y, ...tileData.get(tileKey(x, y)) };
    err = '';
    notice = '';
    showBuild = false;
    if (center) centerCam(x, y);
    drawSel(x, y);
    scheduleRender();
  };

  const prepareMove = (army: Army) => {
    const id = army.armyId?.value;
    if (!id || !army.coords || army.owner?.value !== $userId) return;
    clearMoveTarget();
    moveArmyId = id;
    err = '';
    notice = '';
  };

  const updateMoveHover = (screenX: number, screenY: number) => {
    if (!moveArmyId || !cont) return;
    const tile = screenToTile((screenX - cont.x) / cont.scale.x, (screenY - cont.y) / cont.scale.y);
    if (tile.x < 0 || tile.y < 0 || tile.x >= worldWidth || tile.y >= worldHeight) return;
    if (moveHover?.x === tile.x && moveHover?.y === tile.y) return;
    moveHover = tile;
    if (!moveTarget) drawMovePreview(tile);
  };

  const issueMove = async (destination: { x: number; y: number }) => {
    const army = moveArmyId ? $armies.find((candidate) => candidate.armyId?.value === moveArmyId) : undefined;
    if (!army?.armyId || !army.coords || !moveRoute || busy) return;
    busy = true;
    err = '';
    notice = '';
    try {
      await armyClient.moveArmy({ armyId: army.armyId, destination });
      notice = moveRoute.length === 0 ? 'Army ordered to hold its current position.' : `Marching to tile ${destination.x}, ${destination.y}.`;
      cancelMoveMode();
    } catch (e: unknown) {
      err = errorText(e, 'Movement order failed');
    } finally {
      busy = false;
    }
  };

  const haltArmy = async (army: Army) => {
    if (!army.armyId || !army.coords || army.owner?.value !== $userId) return;
    busy = true;
    err = '';
    notice = '';
    try {
      await armyClient.moveArmy({ armyId: army.armyId, destination: army.coords });
      trackedArmyId = army.armyId.value;
      notice = 'Army ordered to hold its current position.';
      cancelMoveMode();
    } catch (e: unknown) {
      err = errorText(e, 'Halt order failed');
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
      app?.canvas?.removeEventListener('contextmenu', onContextMenu);
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
    await app.init({ width: cw, height: ch, backgroundColor: 0x171c18, antialias: false, roundPixels: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
    el.appendChild(app.canvas);
    cont = new Container();
    cont.sortableChildren = true;
    cont.interactive = true;
    cont.hitArea = new Rectangle(-1e5, -1e5, 2e5, 2e5);
    app.stage.addChild(cont);
    labelLayer = new Container();
    labelLayer.zIndex = 5e6;
    cont.addChild(labelLayer);
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
  const addCityLabel = (city: City, px: number, py: number) => {
    const owned = city.owner?.value === $userId;
    const ownerColor = owned ? 0x336ca8 : city.owner ? 0x9b3f38 : 0x66685f;
    const wrapper = new Container();
    wrapper.position.set(px, py + HH + 3);

    const population = new Text({
      text: Math.max(0, Math.round(city.population)).toLocaleString(),
      roundPixels: true,
      style: {
        fontFamily: ['Tahoma', 'Verdana', 'Arial', 'sans-serif'],
        fontSize: 9,
        fontWeight: 'bold',
        fill: '#f5f2df',
        stroke: { color: '#151712', width: 2 }
      }
    });
    const badgeWidth = Math.max(14, Math.ceil(population.width) + 6);
    const badge = new Graphics();
    badge.rect(0, 0, badgeWidth, 13);
    badge.fill({ color: ownerColor, alpha: 1 });
    badge.rect(0, 0, badgeWidth, 13);
    badge.stroke({ color: 0x171912, width: 1.5, alpha: 1 });
    population.anchor.set(0.5);
    population.position.set(badgeWidth / 2, 6.5);

    const name = new Text({
      text: city.name,
      roundPixels: true,
      style: {
        fontFamily: ['Tahoma', 'Verdana', 'Arial', 'sans-serif'],
        fontSize: 11,
        fontWeight: 'bold',
        fill: owned ? '#f4e47c' : '#efeee2',
        stroke: { color: '#151712', width: 3 }
      }
    });
    name.position.set(badgeWidth + 4, -1);
    wrapper.addChild(badge, population, name);
    wrapper.pivot.x = (badgeWidth + 4 + name.width) / 2;
    labelLayer.addChild(wrapper);
  };

  const renderTile = (col: number, row: number) => {
    if (col < 0 || row < 0 || col >= worldWidth || row >= worldHeight) return;
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

    const dist = hasVisionSources() ? getVisDist(col, row) : 0;
    const inFog = dist > $gameConfig.visionRadius;

    const kind = inFog ? 'fog' : terrainKind(terrainAt(col, row));
    tc.addChild(getTerrainSprite(kind, col, row));
    if (!inFog) {
      const neighbors = EDGE_TO_NEIGHBOR.map(([dc, dr]) => {
        const neighborCol = col + dc;
        const neighborRow = row + dr;
        if (neighborCol < 0 || neighborRow < 0 || neighborCol >= worldWidth || neighborRow >= worldHeight) return null;
        if (hasVisionSources() && getVisDist(neighborCol, neighborRow) > $gameConfig.visionRadius) return 'fog';
        return terrainKind(terrainAt(neighborCol, neighborRow));
      }) as unknown as TerrainNeighbors;
      const transition = getTerrainTransitionSprite(kind, neighbors, col, row);
      if (transition) tc.addChild(transition);
    }
    if (!inFog && td?.building) tc.addChild(getStructureSprite(structureKind(td.building.type)));
    if (!inFog && td?.city && (td.building?.type === BuildingType.CITY_CENTER || td.building?.type === BuildingType.TOWN_CENTER)) addCityLabel(td.city, px, py);

    const visibleArmies = inFog ? td?.armies?.filter((army) => army.owner?.value === $userId) : td?.armies;
    if (visibleArmies?.length) {
      const army = visibleArmies.find((candidate) => candidate.armyId?.value === selectedArmyId) ?? [...visibleArmies].sort((a, b) => armySize(b) - armySize(a))[0];
      const marker = createArmyMarker(army, $userId, army.armyId?.value === selectedArmyId);
      marker.eventMode = 'static';
      marker.cursor = 'pointer';
      marker.on('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        focusArmy(army, false);
      });
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
          const x1 = DIAMOND_VERTS[vi],
            y1 = DIAMOND_VERTS[vi + 1],
            x2 = DIAMOND_VERTS[vn],
            y2 = DIAMOND_VERTS[vn + 1];
          g.moveTo(x1, y1);
          g.lineTo(x2, y2);
          g.stroke({ color: 0x10120e, width: 3, alpha: 0.8 });
          g.moveTo(x1, y1);
          g.lineTo(x2, y2);
          g.stroke({ color: oc, width: 1.25, alpha: 0.9 });
          hasOverlay = true;
        }
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
    selGfx.stroke({ color: 0xffdf32, width: 2, alpha: 0.95 });
    selGfx.zIndex = 1e7;
    cont.addChild(selGfx);
  };

  const deselect = () => {
    cancelMoveMode();
    trackedArmyId = null;
    selectedArmyId = null;
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
      if (e.button !== 0) return;
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
      const p = e.data.global;
      if (moveArmyId && !drag) updateMoveHover(p.x, p.y);
      if (!drag) return;
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
        if (mc.x >= 0 && mc.y >= 0 && mc.x < worldWidth && mc.y < worldHeight) {
          cancelMoveMode();
          const t = tileData.get(tileKey(mc.x, mc.y));
          if (t?.armies?.length === 1 && !t.building) {
            focusArmy(t.armies[0], false);
          } else {
            trackedArmyId = null;
            selectedArmyId = null;
            sel = { x: mc.x, y: mc.y, ...t };
            err = '';
            notice = '';
            showBuild = false;
            recruitCount = 1;
            drawSel(mc.x, mc.y);
          }
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
      if (moveArmyId) updateMoveHover(p.x, p.y);
    });

    cont.on('pointerupoutside', () => {
      if (drag) mapCenter.set(getCenter());
      drag = false;
    });

    // Keep wheel input dedicated to zoom. Map movement is pointer drag or the
    // keyboard, so smooth-wheel mice can never be mistaken for trackpads.
    app.canvas.addEventListener('wheel', onWheel, { passive: false });
    app.canvas.addEventListener('contextmenu', onContextMenu);
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

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const army = selectedArmyId ? $armies.find((candidate) => candidate.armyId?.value === selectedArmyId) : undefined;
    if (!army?.armyId?.value || !army.coords || army.owner?.value !== $userId) return;
    if (busy || !cont) return;
    const rect = app.canvas.getBoundingClientRect();
    const tile = screenToTile((e.clientX - rect.left - cont.x) / cont.scale.x, (e.clientY - rect.top - cont.y) / cont.scale.y);
    if (tile.x < 0 || tile.y < 0 || tile.x >= worldWidth || tile.y >= worldHeight) return;
    moveArmyId = army.armyId.value;
    moveTarget = tile;
    moveHover = tile;
    err = '';
    notice = '';
    drawMovePreview(tile);
    if (!moveRoute) {
      err = 'That destination cannot be reached by a land army.';
      return;
    }
    void issueMove(tile);
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
      case 'm':
      case 'M': {
        const army = selectedArmy?.owner?.value === $userId ? selectedArmy : sel?.armies?.find((candidate) => candidate.owner?.value === $userId);
        if (army) prepareMove(army);
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
        if (moveArmyId) cancelMoveMode();
        else if (showHelp) showHelp = false;
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
    if (armiesOpen && armiesEl && !armiesEl.contains(e.target as Node)) armiesOpen = false;
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
  <div bind:this={el} class="absolute inset-0 {moveArmyId ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}"></div>

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
            <span class="text-[11px] text-[#969d97]">Gold</span>
            <span class="text-[15px] font-semibold tabular-nums text-amber-100">{$gold.toLocaleString()}</span>
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
            <span class="text-[11px] text-[#969d97]">Food</span>
            <span class="text-[15px] font-semibold tabular-nums text-emerald-200">{$food.toLocaleString()}</span>
          </span>
        </span>
      </button>
      <div
        class="pointer-events-none absolute left-1/2 top-full w-56 -translate-x-1/2 pt-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 {ratesOpen
          ? 'opacity-100'
          : ''}"
      >
        <div class="game-popover p-3">
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
      <div class="relative" bind:this={armiesEl}>
        <button
          type="button"
          class="hud-surface flex h-12 items-center gap-2.5 px-3 text-xs font-medium text-[#c7cec8] transition-colors hover:text-white"
          on:click={() => (armiesOpen = !armiesOpen)}
          aria-expanded={armiesOpen}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" class="h-4 w-4 text-blue-300">
            <path d="M5 17V3m1 1h9l-2.5 3L15 10H6" stroke-linejoin="round" />
          </svg>
          <span class="text-sm font-semibold tabular-nums text-white">{ownedArmies.length}</span>
          <span class="hidden text-[#7d877f] sm:inline">{ownedArmies.length === 1 ? 'army' : 'armies'}</span>
          <svg viewBox="0 0 20 20" fill="currentColor" class="h-3 w-3 text-[#747d76] transition-transform duration-150 {armiesOpen ? 'rotate-180' : ''}">
            <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
          </svg>
        </button>
        {#if armiesOpen}
          <div class="game-popover absolute right-0 top-[calc(100%+0.5rem)] w-72 overflow-hidden p-1.5">
            <div class="flex items-center justify-between px-2 pb-1.5 pt-1">
              <span class="panel-title">Your armies</span>
              <span class="text-[10px] tabular-nums text-[#7d867f]">{ownedArmyTroops.toLocaleString()} troops</span>
            </div>
            <div class="max-h-[min(60vh,24rem)] overflow-y-auto">
              {#each ownedArmies as army}
                <div class="border-t border-white/[0.06] {army.armyId?.value === selectedArmyId ? 'bg-blue-300/[0.07]' : ''}">
                  <button
                    class="w-full min-w-0 px-2 py-2 text-left transition-colors hover:bg-white/[0.05]"
                    on:click={() => {
                      focusArmy(army);
                      armiesOpen = false;
                    }}
                  >
                    <span class="flex items-center justify-between gap-3">
                      <span class="truncate text-xs font-semibold text-[#d9ddd8]">{armyTitle(army)}</span>
                      <span class="text-xs font-semibold tabular-nums text-blue-200">{armySize(army)}</span>
                    </span>
                    <span class="mt-1 flex items-center justify-between gap-3 text-[10px] text-[#7c857e]">
                      <span>Tile {army.coords?.x ?? '—'}, {army.coords?.y ?? '—'}</span>
                      <span class={army.destination ? 'text-amber-200/80' : ''}>{army.destination ? `To ${army.destination.x}, ${army.destination.y}` : 'Holding'}</span>
                    </span>
                  </button>
                </div>
              {:else}
                <div class="border-t border-white/[0.06] px-3 py-4 text-[11px] leading-relaxed text-[#7d867f]">No active armies. Train troops from one of your barracks.</div>
              {/each}
            </div>
          </div>
        {/if}
      </div>

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
            <div class="game-popover absolute right-0 top-[calc(100%+0.5rem)] w-64 overflow-hidden p-1.5">
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
                    {#if city.starving}<span class="text-[11px] font-medium text-red-400">Starving</span>{/if}
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

  <!-- Selection details live in a bottom command dock instead of a map-obscuring sidebar. -->
  <div class="pointer-events-none absolute bottom-3 left-1/2 z-10 w-[calc(100vw-1.5rem)] max-w-[1000px] -translate-x-1/2 sm:bottom-4">
    {#if sel}
      {@const selectedInFog = hasVisionSources() && getVisDist(sel.x, sel.y) > $gameConfig.visionRadius}
      {@const selectedTerrain = selectedInFog ? { name: 'Unexplored', note: 'Terrain has not been surveyed.' } : terrainInfo(terrainAt(sel.x, sel.y))}
      <div class="inspector-panel pointer-events-auto" transition:fly={{ y: 16, duration: 180 }}>
        <div class="inspector-header flex items-center justify-between gap-4">
          <div class="min-w-0">
            <h2 class="truncate text-base font-semibold text-[#f0f2e8]">
              {#if selectedArmy}
                {armyTitle(selectedArmy)}
              {:else if sel.building}
                {bName(sel.building.type)}
              {:else if sel.armies?.length}
                {sel.armies.length === 1 ? 'Army' : `${sel.armies.length} armies`}
              {:else if sel.city}
                {sel.city.name}
              {:else}
                {selectedTerrain.name}
              {/if}
            </h2>
            {#if selectedArmy}
              <div class="mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px] text-[#b0b2a5]">
                <span class={selectedArmy.owner?.value === $userId ? 'font-medium text-blue-200' : 'font-medium text-red-200'}
                  >{selectedArmy.owner?.value === $userId ? 'Your army' : 'Foreign army'}</span
                >
                · Tile {sel.x}, {sel.y}
              </div>
            {:else}
              <div class="mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px] text-[#b0b2a5]">
                {#if sel.city}{sel.city.name} · {cName(sel.city.type)} ·
                {/if}<span class="font-medium text-[#d4d5c8]">{selectedTerrain.name}</span> · Tile {sel.x}, {sel.y}
              </div>
              <p class="mt-1 truncate text-[11px] text-[#8f9387]">{selectedTerrain.note}</p>
            {/if}
          </div>
          <button
            aria-label="Close"
            class="flex h-7 w-7 shrink-0 items-center justify-center border border-white/[0.12] text-[#c6c8bb] transition-colors duration-150 hover:border-white/30 hover:text-white"
            on:click={deselect}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {#if err}
          <div class="border-b border-red-400/30 bg-red-500/[0.08] px-4 py-2 text-xs text-red-300">{err}</div>
        {/if}
        {#if notice}
          <div class="border-b border-emerald-300/20 bg-emerald-300/[0.07] px-4 py-2 text-xs text-emerald-200">{notice}</div>
        {/if}
        {#if moveArmyId && movingArmy}
          {@const previewTarget = moveTarget ?? moveHover}
          {@const steps = moveRoute?.length ?? 0}
          <div class="flex flex-wrap items-center gap-3 border-b border-blue-300/20 bg-blue-300/[0.07] px-4 py-2.5">
            <div class="min-w-0 flex-1">
              <div class="text-xs font-semibold {previewTarget && !moveRoute ? 'text-red-200' : 'text-blue-200'}">
                {busy ? 'Issuing movement order…' : previewTarget ? (moveRoute ? `Route to ${previewTarget.x}, ${previewTarget.y}` : 'That tile is unreachable') : 'Move army'}
              </div>
              <div class="mt-0.5 text-[11px] text-[#9ba9b1]">
                {previewTarget
                  ? moveRoute
                    ? `${steps} ${steps === 1 ? 'tile' : 'tiles'} · about ${fmtCountdown(moveRouteCost * 1000)} across this terrain`
                    : 'Land armies cannot cross water or cut through a blocked corner.'
                  : 'Hover to preview a route, then right-click the destination. Left-drag still pans.'}
              </div>
            </div>
            <span class="text-[10px] text-[#7e8981]">Esc cancels</span>
          </div>
        {/if}

        <div class="inspector-body">
          {#if selectedArmy}
            {@const selectedArmyOwned = selectedArmy.owner?.value === $userId}
            {@const selectedArmySize = armySize(selectedArmy)}
            {@const selectedStack = sel.armies?.filter((army) => army.owner?.value === $userId) ?? []}
            <section class="inspector-section">
              <div class="grid grid-cols-3 gap-5">
                <div>
                  <div class="inspector-stat-label">Strength</div>
                  <div class="inspector-stat-value">{selectedArmySize.toLocaleString()} <span class="text-[#68716a]">troops</span></div>
                </div>
                <div>
                  <div class="inspector-stat-label">Position</div>
                  <div class="inspector-stat-value">{selectedArmy.coords?.x ?? '—'}, {selectedArmy.coords?.y ?? '—'}</div>
                </div>
                <div>
                  <div class="inspector-stat-label">Orders</div>
                  <div class="mt-1 text-xs font-medium {selectedArmy.destination ? 'text-amber-200' : 'text-[#aab2ac]'}">
                    {selectedArmy.destination ? `March to ${selectedArmy.destination.x}, ${selectedArmy.destination.y}` : 'Hold position'}
                  </div>
                </div>
              </div>
              <div class="mt-3 border-t border-white/[0.07] pt-3">
                <div class="inspector-label mb-2">Composition</div>
                <div class="flex flex-wrap gap-x-5 gap-y-1.5 text-[11px]">
                  {#each selectedArmy.troops.filter((stack) => stack.count > 0) as stack}
                    <span class="text-[#969f98]"><strong class="mr-1 font-semibold tabular-nums text-[#e0e2d8]">{stack.count}</strong>{troopName(stack.type, stack.count)}</span>
                  {/each}
                </div>
              </div>
            </section>
            {#if selectedArmyOwned}
              <div class="inspector-actions">
                <button class="game-action game-action-primary" disabled={busy || moveArmyId === selectedArmyId} on:click={() => prepareMove(selectedArmy)}>
                  {selectedArmy.destination ? 'Redirect army' : 'Move army'}
                </button>
                {#if selectedArmy.destination}
                  <button class="game-action game-action-secondary" disabled={busy} on:click={() => haltArmy(selectedArmy)}>Halt</button>
                {/if}
                {#if selectedStack.length > 1}
                  <button class="game-action game-action-secondary" disabled={busy} on:click={() => mergeOwnedArmies(selectedStack, selectedArmyId ?? undefined)}>Merge stack</button>
                {/if}
                <div class="mt-1 border-t border-white/[0.06] pt-2 text-[10px] leading-relaxed text-[#747d76]">Right-click the map to move immediately.</div>
              </div>
            {/if}
          {/if}

          {#if !selectedArmy && sel.city}
            <section class="inspector-section">
              <div class="mb-3 flex items-center justify-between gap-3">
                <span class="inspector-label">City resources</span>
                {#if sel.city.owner?.value === $userId}
                  <span class="flex items-center gap-1.5 text-xs font-medium text-blue-300"><span class="h-1.5 w-1.5 bg-blue-400"></span>Yours</span>
                {:else if sel.city.owner}
                  <span class="flex items-center gap-1.5 text-xs font-medium text-red-300"><span class="h-1.5 w-1.5 bg-red-400"></span>Foreign</span>
                {:else}
                  <span class="flex items-center gap-1.5 text-xs font-medium text-[#8c958e]"><span class="h-1.5 w-1.5 bg-[#788179]"></span>Neutral</span>
                {/if}
              </div>

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
                    <div class="mt-1 flex items-center gap-1.5 text-xs font-medium text-red-400"><span class="h-1.5 w-1.5 animate-pulse bg-red-400"></span>Starving</div>
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

          {#if !selectedArmy && sel.armies?.length}
            <section class="inspector-section">
              <div class="mb-3 flex items-center justify-between">
                <span class="inspector-label">Armies on this tile</span>
                <span class="text-xs font-medium tabular-nums text-[#9aa39c]">{sel.armies.reduce((sum, army) => sum + armySize(army), 0)} troops</span>
              </div>
              <div class="space-y-2">
                {#each sel.armies as army}
                  {@const owned = army.owner?.value === $userId}
                  {@const size = armySize(army)}
                  <button
                    class="w-full border border-white/[0.07] bg-black/[0.08] px-3 py-2.5 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.04]"
                    on:click={() => focusArmy(army, false)}
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="flex min-w-0 items-center gap-2">
                        <span class="h-2 w-2 shrink-0 {owned ? 'bg-blue-400' : 'bg-red-400'}"></span>
                        <span class="truncate text-xs font-semibold {owned ? 'text-blue-200' : 'text-red-200'}">{armyTitle(army)}</span>
                      </div>
                      <span class="text-xs font-semibold tabular-nums text-[#e2e3d8]">{size}</span>
                    </div>
                    <p class="mt-1.5 text-[11px] leading-relaxed text-[#aeb5b0]">
                      {army.troops
                        .filter((stack) => stack.count > 0)
                        .map((stack) => `${stack.count} ${troopName(stack.type, stack.count)}`)
                        .join(', ') || 'No troops'}
                    </p>
                    <div class="mt-2 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-2 text-[10px]">
                      <span class={army.destination ? 'text-amber-200/80' : 'text-[#79827b]'}>{army.destination ? `Marching to ${army.destination.x}, ${army.destination.y}` : 'Holding position'}</span
                      >
                      <span class="font-semibold text-[#aeb7b0]">Manage army →</span>
                    </div>
                  </button>
                {/each}
              </div>
            </section>
          {/if}

          <!-- Building information -->
          {#if !selectedArmy && sel.building}
            {@const isBuilding = sel.building.level === 0}
            {@const stats = isBuilding ? null : getLevelStats(sel.building.type, sel.building.level)}
            {@const nextStats = getLevelStats(sel.building.type, sel.building.level + 1)}
            {@const upgrading = !!(sel.building.constructionStart && sel.building.constructionEnd && Number(sel.building.constructionEnd.seconds) * 1000 > now)}
            {@const isBarracks = sel.building.type === BuildingType.BARRACKS}
            {@const recruitStat = TROOP_STATS[recruitType]}
            {@const trainingCapacity = isBarracks ? barracksCapacity(sel.building) : 0}
            {@const availablePopulation = trainablePopulation(sel.city)}
            {@const batchCount = Number.isFinite(recruitCount) ? Math.floor(recruitCount) : 1}
            {@const trainingCost = batchCount * recruitStat.gold}
            {@const trainingPopulation = batchCount * recruitStat.population}
            {@const canTrain =
              isBarracks && !isBuilding && !upgrading && batchCount >= 1 && batchCount <= trainingCapacity && BigInt(trainingCost) <= $gold && trainingPopulation <= availablePopulation}
            <section class="inspector-section">
              <div class="flex items-center justify-between">
                <span class="inspector-label">Improvement</span>
                {#if !isBuilding}
                  <span class="text-xs font-semibold tabular-nums text-amber-200">Level {sel.building.level}</span>
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
                  <div class="inspector-label mb-1">Upgrade</div>
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
            {#if isBarracks && sel.city?.owner?.value === $userId && !isBuilding}
              <section class="inspector-section">
                <div class="mb-3 flex items-center justify-between gap-3">
                  <span class="inspector-label">Recruit troops</span>
                  <span class="text-[10px] tabular-nums text-[#818a83]">Batch limit {trainingCapacity}</span>
                </div>
                <div class="grid grid-cols-2 border-l border-t border-white/[0.07]">
                  {#each TROOP_TYPES as type}
                    {@const option = TROOP_STATS[type]}
                    <button
                      class="border-b border-r border-white/[0.07] px-2 py-2 text-left transition-colors {recruitType === type
                        ? 'bg-blue-300/10 text-blue-100'
                        : 'text-[#929b94] hover:bg-white/[0.04] hover:text-white'}"
                      on:click={() => (recruitType = type)}
                    >
                      <span class="block text-[11px] font-semibold">{option.name}</span>
                      <span class="mt-0.5 block text-[9px] tabular-nums text-[#7f887f]">{option.gold} gold each</span>
                    </button>
                  {/each}
                </div>
                <div class="mt-3 flex items-center justify-between gap-3">
                  <span class="text-[11px] text-[#8f978f]">Batch size</span>
                  <div class="flex items-center border border-white/[0.1] bg-black/15">
                    <button
                      class="h-7 w-7 text-sm text-[#aeb6af] hover:bg-white/[0.06] hover:text-white"
                      on:click={() => (recruitCount = Math.max(1, (recruitCount || 1) - 1))}
                      aria-label="Decrease troop count">−</button
                    >
                    <input
                      class="h-7 w-11 border-x border-white/[0.08] bg-transparent text-center text-xs font-semibold tabular-nums text-white outline-none"
                      type="number"
                      min="1"
                      max={trainingCapacity}
                      bind:value={recruitCount}
                      on:change={() => (recruitCount = Math.max(1, Math.min(trainingCapacity, Math.floor(recruitCount || 1))))}
                    />
                    <button
                      class="h-7 w-7 text-sm text-[#aeb6af] hover:bg-white/[0.06] hover:text-white"
                      on:click={() => (recruitCount = Math.min(trainingCapacity, (recruitCount || 1) + 1))}
                      aria-label="Increase troop count">+</button
                    >
                  </div>
                </div>
                <div class="mt-3 border-t border-white/[0.07] pt-2">
                  <div class="inspector-row">
                    <span>Order cost</span>
                    <span class={BigInt(trainingCost) <= $gold ? 'text-amber-200' : 'text-red-300'}>{trainingCost.toLocaleString()} gold</span>
                  </div>
                  <div class="inspector-row">
                    <span>Population</span>
                    <span class={trainingPopulation <= availablePopulation ? 'text-blue-200' : 'text-red-300'}
                      >{trainingPopulation} <span class="text-[#6f7770]">/ {availablePopulation} available</span></span
                    >
                  </div>
                  <div class="inspector-row">
                    <span>Training</span>
                    <span>{recruitStat.trainSeconds}s per order</span>
                  </div>
                  <div class="inspector-row">
                    <span>Army upkeep</span>
                    <span class="text-emerald-200/80">{(batchCount * recruitStat.foodPerHour).toLocaleString()} food/hr</span>
                  </div>
                </div>
                {#if trainingOrdersAvailable && trainingOrdersBarracksId === selectedBarracksId}
                  <div class="mt-3 border-t border-white/[0.07] pt-3">
                    <div class="mb-2 flex items-center justify-between gap-3">
                      <span class="inspector-label">Training queue</span>
                      {#if trainingOrders.length > 0}
                        <span class="text-[10px] tabular-nums text-[#818a83]">{trainingOrders.length} {trainingOrders.length === 1 ? 'order' : 'orders'}</span>
                      {/if}
                    </div>
                    {#if trainingOrdersLoading && trainingOrders.length === 0}
                      <div class="text-[10px] text-[#737c75]">Reading barracks orders…</div>
                    {:else if trainingOrders.length === 0}
                      <div class="border border-dashed border-white/[0.09] px-3 py-2 text-[10px] text-[#747d76]">No troops are waiting to train.</div>
                    {:else}
                      <div class="space-y-1.5">
                        {#each trainingOrders.slice(0, 3) as order, index (order.trainingOrderId?.value)}
                          {@const startsAt = timestampMs(order.startedAt)}
                          {@const completesAt = timestampMs(order.completesAt)}
                          {@const active = startsAt > 0 && completesAt > 0}
                          {@const progress = active ? Math.max(0, Math.min(100, ((now - startsAt) / Math.max(1, completesAt - startsAt)) * 100)) : 0}
                          <div class="border border-white/[0.08] bg-black/10 px-2.5 py-2">
                            <div class="flex items-center justify-between gap-3 text-[10px]">
                              <span class="font-semibold text-[#c2c9c2]">{order.count} {troopName(order.type, order.count)}</span>
                              <span class={active ? 'tabular-nums text-blue-200' : 'text-[#7c857e]'}>
                                {active ? fmtCountdown(completesAt - now) : `Waiting · ${index + 1}`}
                              </span>
                            </div>
                            {#if active}
                              <div class="mt-2 h-0.5 overflow-hidden bg-white/[0.07]">
                                <div class="h-full bg-blue-300/80 transition-[width] duration-500" style={`width: ${progress}%`}></div>
                              </div>
                            {/if}
                          </div>
                        {/each}
                      </div>
                      {#if trainingOrders.length > 3}
                        <div class="mt-2 text-[9px] tabular-nums text-[#707971]">+{trainingOrders.length - 3} more in queue</div>
                      {/if}
                    {/if}
                  </div>
                {/if}
              </section>
            {/if}
            {#if sel.city?.owner?.value === $userId}
              <div class="inspector-actions">
                {#if isBarracks && !isBuilding}
                  <button class="game-action game-action-primary" disabled={busy || !canTrain} on:click={queueTroops}>
                    {busy ? 'Working...' : `Train ${batchCount} ${troopName(recruitType, batchCount)}`}
                  </button>
                {/if}
                <button
                  class="game-action game-action-primary"
                  disabled={busy || upgrading}
                  on:click={() => sel?.building && doAction(() => buildingClient.upgradeBuilding({ buildingId: sel!.building!.buildingId }), 'Upgrade failed')}>{busy ? '...' : 'Upgrade'}</button
                >
                <button
                  class="game-action game-action-danger"
                  disabled={busy || upgrading}
                  on:click={() => sel?.building && doAction(() => buildingClient.deleteBuilding({ buildingId: sel!.building!.buildingId }), 'Demolish failed')}>{busy ? '...' : 'Demolish'}</button
                >
              </div>
            {/if}
          {:else if !selectedArmy && sel.city?.owner?.value === $userId}
            {#if showBuild}
              {@const buildStats = getLevelStats(buildType, 1)}
              <section class="inspector-section">
                <div class="mb-3 flex items-center justify-between">
                  <span class="inspector-label">City improvements</span>
                  <button class="text-xs font-medium text-[#9ba097] transition-colors hover:text-white" on:click={() => (showBuild = false)}>Cancel</button>
                </div>
                <div class="grid grid-cols-2 border-l border-t border-white/[0.07]">
                  {#each placeTypes as bt}
                    <button
                      class="border-b border-r border-white/[0.07] px-2 py-2.5 text-xs font-medium transition-colors
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
          {:else if !selectedArmy && !sel.city && !sel.armies?.length}
            <div class="inspector-empty px-5 py-8 text-sm text-[#85897d]">
              {selectedInFog ? 'Beyond visibility range' : 'No structures on this tile'}
            </div>
          {/if}
        </div>
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
  <div class="pointer-events-auto absolute bottom-4 left-4 {sel ? 'hidden' : ''}">
    <MiniMap onPan={(col, row) => centerCam(col, row)} viewCols={viewTilesW} viewRows={viewTilesH} />
  </div>

  <!-- Keyboard shortcuts toggle -->
  <button
    class="hud-surface pointer-events-auto absolute bottom-4 left-[186px] h-8 w-8 items-center justify-center text-xs font-medium text-white/70 transition-colors hover:text-white {sel
      ? 'hidden'
      : 'flex'}"
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
          {#each [['Pan', 'Click + drag / WASD'], ['Pan faster', 'Shift + move'], ['Zoom', 'Wheel / + / −'], ['Reset zoom', '0'], ['Center capital', 'C'], ['Cycle cities', '[ / ]'], ['Select army', 'Click formation / card'], ['Preview movement', 'Move button / M'], ['Issue movement', 'Right-click map'], ['Cancel move / deselect', 'Esc'], ['Toggle this help', '?']] as [label, keys]}
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
