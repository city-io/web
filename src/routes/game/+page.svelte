<script lang="ts">
  import { armies, armyOrders, battles, buildings, cities, mailboxMessages, mapCenter, tiles, tileVisibility, username, gold, food, userId, gameConfig } from '$lib/stores';
  import { clearSession } from '$lib/session';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { Application, Container, Graphics, Rectangle, Text } from 'pixi.js';
  import { HW, HH, DIAMOND_VERTS, EDGE_TO_NEIGHBOR, tileToScreen, screenToTile, tileKey, mapBounds } from '$lib/game/iso';
  import { getStructureSprite, getTerrainSprite, getTerrainTransitionSprite, initSprites, type StructureKind, type TerrainKind, type TerrainNeighbors } from '$lib/game/sprites';
  import { TROOP_STATS, TROOP_TYPES, armySize, armyTitle, createArmyMarker, troopName, type ArmyPathStep } from '$lib/game/troops';
  import MiniMap from '$lib/components/MiniMap.svelte';
  import { ratePerHour, fmtPerHour, durationSeconds } from '$lib/game/rates';
  import type { City } from '$lib/gen/cityio/entity/v1/city_pb';
  import type { Building } from '$lib/gen/cityio/entity/v1/building_pb';
  import { ArmyCompositionVisibility, type Army } from '$lib/gen/cityio/entity/v1/army_pb';
  import type { ArmyOrder } from '$lib/gen/cityio/entity/v1/army_order_pb';
  import type { BattleSide } from '$lib/gen/cityio/entity/v1/battle_pb';
  import {
    BattleReportEngagement,
    BattleReportOutcome,
    BattleReportResolution,
    BattleReportRole,
    type BattleReport,
    type BattleReportArmy,
    type BattleReportLoss,
    type BattleReportSide as ReportSide,
    type MailboxMessage
  } from '$lib/gen/cityio/entity/v1/mailbox_pb';
  import { BuildingType, CityType, TroopType } from '$lib/gen/cityio/entity/v1/common_pb';
  import { TerrainType, type Tile } from '$lib/gen/cityio/entity/v1/tile_pb';
  import { TileVisibilityState } from '$lib/gen/cityio/service/v1/state_pb';
  import type { TrainingOrder } from '$lib/gen/cityio/service/v1/army_pb';
  import type { BuildingConfig, BuildingLevelStats, ResourceRate } from '$lib/gen/cityio/service/v1/config_pb';
  import type { Duration, Timestamp } from '@bufbuild/protobuf/wkt';
  import { Code, ConnectError } from '@connectrpc/connect';
  import { armyClient, buildingClient, cityClient, mailboxClient } from '$lib/api/client';

  // ── constants ──────────────────────────────────────────
  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 3;
  const CLICK_DIST = 5;
  const DOUBLE_CLICK_MS = 350;
  // Set this above zero if movement orders should have a deliberate client-side submit delay.
  const MOVE_ORDER_SUBMIT_DELAY_MS = 0;
  type MovePreviewResult = 'loaded' | 'failed' | 'superseded';
  type ArmyOrderIntent = 'move' | 'attack' | 'siege' | 'retreat';

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
  let lastTileClickKey: string | null = null;
  let lastTileClickAt = 0;
  let easeMotion = true;

  // tiles
  let loaded = new Map<string, Container>();
  let tileData = new Map<string, { tile?: Tile; city?: City; building?: Building; armies?: Army[] }>();
  let constructionGfx = new Map<string, { gfx: Graphics; startMs: number; endMs: number; cx: number; cy: number }>();
  let starvingGfx = new Map<string, { gfx: Graphics; segs: number[][]; isCenter: boolean }>();
  let trainingGfx = new Map<string, { gfx: Graphics; startMs: number; endMs: number }>();
  let selGfx: Graphics | null = null;

  // ── UI state ────────────────────────────────────────────
  let sel: { x: number; y: number; tile?: Tile; city?: City; building?: Building; armies?: Army[] } | null = null;
  let buildType: BuildingType = BuildingType.HOUSE;
  const placeTypes = [BuildingType.HOUSE, BuildingType.FARM, BuildingType.MINE, BuildingType.BARRACKS];
  let busy = false;
  let err = '';
  let notice = '';
  let showBuild = false;
  let showCityManagement = false;
  let showBattlePanel = false;
  let cityManagementView: 'city' | 'building' = 'city';
  let recruitType: (typeof TROOP_TYPES)[number] = TroopType.SOLDIER;
  let recruitCount = 1;
  let selectedArmyId: string | null = null;
  let splitArmyFormId: string | null = null;
  let showSplit = false;
  let splitCounts: Partial<Record<TroopType, number>> = {};
  let moveArmyId: string | null = null;
  let trackedArmyId: string | null = null;
  let moveTarget: { x: number; y: number } | null = null;
  let moveHover: { x: number; y: number } | null = null;
  let moveRoute: ArmyPathStep[] | null = null;
  let moveHiddenSegmentEnd: ArmyPathStep | null = null;
  let moveRouteComplete = true;
  let moveRouteLoading = false;
  let moveRouteError = '';
  let moveRouteDurationMs = 0;
  let movePreviewDestination: { x: number; y: number } | null = null;
  let moveOrderActive = false;
  let moveDestinationObserved = false;
  let moveOrderIntent: ArmyOrderIntent = 'move';
  let moveGfx: Graphics | null = null;
  let moveConfirmationGfx: Graphics | null = null;
  let moveConfirmationPending = false;
  let moveConfirmationPreview: Promise<MovePreviewResult> | null = null;
  let movePreviewRequest = 0;
  let trainingOrdersAvailable = true;
  let trainingQueues = new Map<string, TrainingOrder[]>();
  let trainingOverviewLoading = false;
  let lastTrainingOverviewPoll = 0;
  let trainingNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  let policyDraftCityId: string | null = null;
  let militiaDraft = 10;
  let militiaTargetDraft = 25;
  let taxDraft = 10;
  let policyDraftDirty = false;
  let policySaving = false;
  let activeGameTooltip: { title: string; detail: string; x: number; y: number; below: boolean } | null = null;
  let selectedMailboxMessageId: string | null = null;

  const showGameTooltip = (event: MouseEvent | FocusEvent, title: string, detail: string) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const halfWidth = 88;
    const edgeGap = 10;
    const below = rect.top < 90;
    activeGameTooltip = {
      title,
      detail,
      x: Math.max(edgeGap + halfWidth, Math.min(window.innerWidth - edgeGap - halfWidth, rect.left + rect.width / 2)),
      y: below ? rect.bottom + 9 : rect.top - 9,
      below
    };
  };

  const hideGameTooltip = () => {
    activeGameTooltip = null;
  };

  const setMilitiaDraftFromTarget = (event: Event, capacity: number, minPercent: number, maxPercent: number) => {
    const input = event.currentTarget as HTMLInputElement;
    const target = input.valueAsNumber;
    if (!Number.isFinite(target) || capacity <= 0) {
      input.value = militiaTargetDraft.toString();
      return;
    }
    const minTarget = Math.ceil((capacity * minPercent) / 100);
    const maxTarget = Math.floor((capacity * maxPercent) / 100);
    militiaTargetDraft = Math.max(minTarget, Math.min(maxTarget, Math.round(target)));
    militiaDraft = (militiaTargetDraft / capacity) * 100;
    input.value = militiaTargetDraft.toString();
    policyDraftDirty = true;
  };

  const setMilitiaDraftFromPercent = (event: Event, capacity: number, minPercent: number, maxPercent: number) => {
    const input = event.currentTarget as HTMLInputElement;
    const percent = input.valueAsNumber;
    if (!Number.isFinite(percent) || capacity <= 0) {
      input.value = Number(militiaDraft.toFixed(2)).toString();
      return;
    }
    const boundedPercent = Math.max(minPercent, Math.min(maxPercent, percent));
    militiaTargetDraft = Math.round((capacity * boundedPercent) / 100);
    militiaDraft = (militiaTargetDraft / capacity) * 100;
    policyDraftDirty = true;
  };

  // Resource details stay compact; entity management lives in the right rail.
  let ratesOpen = false;
  let ratesEl: HTMLDivElement;
  let managementOpen = false;
  let managementTab: 'armies' | 'cities' | 'training' | 'inbox' = 'armies';
  const toggleManagementTab = (tab: typeof managementTab) => {
    if (managementOpen && managementTab === tab) {
      managementOpen = false;
      return;
    }
    managementTab = tab;
    managementOpen = true;
  };

  const isSettlementCenter = (building?: Building) => building?.type === BuildingType.CITY_CENTER || building?.type === BuildingType.TOWN_CENTER;

  const openSelectedManagement = () => {
    if (!sel?.building) return;
    const selectedType = sel?.building?.type;
    cityManagementView = selectedType && selectedType !== BuildingType.CITY_CENTER && selectedType !== BuildingType.TOWN_CENTER ? 'building' : 'city';
    showCityManagement = true;
  };

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
  onDestroy(() => {
    clearInterval(tick);
    if (trainingNoticeTimer) clearTimeout(trainingNoticeTimer);
  });

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
  const residents = (city: City) => Math.max(0, Math.floor(city.population));
  const housingCapacity = (city: City) => Math.max(0, Math.floor(city.populationCap));
  const taxpayerPopulation = (city: City) => Math.min(residents(city), Math.max(0, Math.floor(city.taxablePopulation)));
  const militiaPopulation = (city: City) => residents(city) - taxpayerPopulation(city);
  const demographicsKnown = (city?: City) => !!city?.demographicsVisible;
  const trainablePopulation = (city?: City) => (city ? Math.max(0, Math.floor(city.recruitablePopulation)) : 0);
  const troopPopulationCost = (type: TroopType, count: number) => (TROOP_STATS[type as keyof typeof TROOP_STATS]?.population ?? 0) * count;
  const queuePopulationCost = (orders: TrainingOrder[]) => orders.reduce((total, order) => total + troopPopulationCost(order.type, order.count), 0);
  const armyPersonnel = (army: Army) => army.troops.reduce((total, stack) => total + troopPopulationCost(stack.type, stack.count ?? 0), 0);
  const armyFoodUpkeep = (army: Army) => army.troops.reduce((total, stack) => total + (TROOP_STATS[stack.type as keyof typeof TROOP_STATS]?.foodPerHour ?? 0) * (stack.count ?? 0), 0);
  const troopStackTotal = (stacks: { count?: number }[]) => stacks.reduce((total, stack) => total + (stack.count ?? 0), 0);
  const troopStackCount = (stacks: { type: TroopType; count?: number }[], type: TroopType) => stacks.find((stack) => stack.type === type)?.count ?? 0;
  const reportArmyLosses = (army: BattleReportArmy) => troopStackTotal(army.startingTroops) - troopStackTotal(army.survivingTroops);
  const reportSideStart = (side?: ReportSide) => (side?.armies ?? []).reduce((total, army) => total + troopStackTotal(army.startingTroops), Number(side?.startingMilitia ?? 0n));
  const reportSideSurvivors = (side?: ReportSide) => (side?.armies ?? []).reduce((total, army) => total + troopStackTotal(army.survivingTroops), Number(side?.survivingMilitia ?? 0n));
  const reportLossTotal = (losses: BattleReportLoss[]) => losses.reduce((total, loss) => total + troopStackTotal(loss.troops) + Number(loss.militia), 0);
  const reportLossDescription = (loss: BattleReportLoss) =>
    [...loss.troops.map((stack) => `${stack.count ?? 0} ${troopName(stack.type, stack.count)}`), ...(loss.militia > 0n ? [`${loss.militia.toString()} militia`] : [])].join(' · ');
  const reportOutcomeLabel = (outcome: BattleReportOutcome) => (outcome === BattleReportOutcome.VICTORY ? 'Victory' : outcome === BattleReportOutcome.DEFEAT ? 'Defeat' : 'Draw');
  const reportResolutionLabel = (resolution: BattleReportResolution) =>
    resolution === BattleReportResolution.RETREAT ? 'Retreat' : resolution === BattleReportResolution.MUTUAL_DESTRUCTION ? 'Mutual destruction' : 'Elimination';
  const reportRoleLabel = (role: BattleReportRole) => (role === BattleReportRole.ATTACKER ? 'Attacking side' : 'Defending side');
  const reportDate = (timestamp?: Timestamp) => (timestamp ? new Date(timestampMs(timestamp)).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Unknown time');
  const reportDuration = (report: BattleReport) => Math.max(0, timestampMs(report.endedAt) - timestampMs(report.startedAt));
  const shortId = (value?: string) => (value ? value.slice(0, 8) : 'unknown');
  const battleSideArmies = (side?: BattleSide): Army[] =>
    (side?.armyIds ?? []).flatMap((armyId) => {
      const army = $armies.find((candidate) => candidate.armyId?.value === armyId.value);
      return army ? [army] : [];
    });

  $: movingArmy = moveArmyId ? $armies.find((army) => army.armyId?.value === moveArmyId) : undefined;
  $: selectedArmy = selectedArmyId ? $armies.find((army) => army.armyId?.value === selectedArmyId) : undefined;
  $: if (selectedArmyId !== splitArmyFormId) {
    splitArmyFormId = selectedArmyId;
    showSplit = false;
    splitCounts = {};
  }
  $: splitTotal = Object.values(splitCounts).reduce((total, count) => total + (count ?? 0), 0);
  $: orderById = new Map($armyOrders.map((order) => [order.armyOrderId?.value, order]));
  const orderForArmy = (army?: Army): ArmyOrder | undefined => (army?.orderId?.value ? orderById.get(army.orderId.value) : undefined);
  const orderDestination = (order?: ArmyOrder) => {
    if (!order) return undefined;
    switch (order.objective.case) {
      case 'move':
        return order.objective.value.destination;
      case 'attackArmy':
        return order.objective.value.lastKnownCoords;
      case 'conquerSettlement':
        return order.objective.value.destination;
      case 'retreat':
        return order.objective.value.destination;
    }
  };
  const orderIntent = (order?: ArmyOrder): ArmyOrderIntent => {
    if (!order) return 'move';
    switch (order.objective.case) {
      case 'attackArmy':
        return 'attack';
      case 'conquerSettlement':
        return 'siege';
      case 'retreat':
        return 'retreat';
      default:
        return 'move';
    }
  };
  const intentLabel = (intent: ArmyOrderIntent) => (intent === 'attack' ? 'Attack' : intent === 'siege' ? 'Siege' : intent === 'retreat' ? 'Retreat' : 'Move');
  const orderLabel = (order?: ArmyOrder) => {
    if (!order) return 'Hold';
    return order.objective.case === 'conquerSettlement' && order.objective.value.captureStartedAt ? 'Occupy' : intentLabel(orderIntent(order));
  };
  const orderToneText = (intent: ArmyOrderIntent) => (intent === 'attack' ? 'text-red-200' : intent === 'siege' ? 'text-amber-200' : intent === 'retreat' ? 'text-cyan-200' : 'text-blue-200');
  const orderToneSurface = (intent: ArmyOrderIntent) =>
    intent === 'attack'
      ? 'border-red-300/25 bg-red-300/[0.07]'
      : intent === 'siege'
        ? 'border-amber-300/25 bg-amber-300/[0.07]'
        : intent === 'retreat'
          ? 'border-cyan-300/25 bg-cyan-300/[0.07]'
          : 'border-blue-300/25 bg-blue-300/[0.07]';
  const cityForOrder = (order?: ArmyOrder): City | undefined => {
    const cityId = order?.objective.case === 'conquerSettlement' ? order.objective.value.cityId?.value : order?.objective.case === 'retreat' ? order.objective.value.settlementId?.value : undefined;
    return cityId ? $cities.find((city) => city.cityId?.value === cityId) : undefined;
  };
  const armyForAttackOrder = (order?: ArmyOrder): Army | undefined => {
    const armyId = order?.objective.case === 'attackArmy' ? order.objective.value.targetArmyId?.value : undefined;
    return armyId ? $armies.find((army) => army.armyId?.value === armyId) : undefined;
  };
  const orderStatus = (order?: ArmyOrder, inBattle = false) => {
    if (!order) return 'Holding position';
    const destination = orderDestination(order);
    const coords = destination ? ` at ${destination.x}, ${destination.y}` : '';
    switch (order.objective.case) {
      case 'attackArmy': {
        const target = armyForAttackOrder(order);
        return inBattle ? `Attacking ${target ? armyTitle(target) : 'enemy army'}` : `Pursuing ${target ? armyTitle(target) : 'enemy army'}${coords}`;
      }
      case 'conquerSettlement': {
        const settlement = cityForOrder(order);
        const name = settlement?.name ?? 'settlement';
        if (inBattle) return `Siege battle for ${name}`;
        return order.objective.value.captureStartedAt ? `Occupying ${name}` : `Marching to besiege ${name}${coords}`;
      }
      case 'retreat': {
        const settlement = cityForOrder(order);
        return `Retreating to ${settlement?.name ?? `settlement${coords}`}`;
      }
      default:
        return `Moving to tile ${destination?.x ?? '—'}, ${destination?.y ?? '—'}`;
    }
  };
  const cancelOrderLabel = (order?: ArmyOrder) => {
    switch (orderIntent(order)) {
      case 'attack':
        return 'Cancel attack';
      case 'siege':
        return 'Cancel siege';
      case 'retreat':
        return 'Cancel retreat';
      default:
        return 'Halt movement';
    }
  };
  const previewOrderStatus = (intent: ArmyOrderIntent, destination: { x: number; y: number }) => {
    const destinationState = tileData.get(tileKey(destination.x, destination.y));
    switch (intent) {
      case 'attack': {
        const target = destinationState?.armies?.find((army) => army.owner?.value && army.owner.value !== $userId);
        return `Attack ${target ? armyTitle(target) : 'enemy army'} at ${destination.x}, ${destination.y}`;
      }
      case 'siege':
        return `Besiege ${destinationState?.city?.name ?? 'settlement'} at ${destination.x}, ${destination.y}`;
      case 'retreat':
        return `Retreat to ${destinationState?.city?.name ?? `tile ${destination.x}, ${destination.y}`}`;
      default:
        return `Move to tile ${destination.x}, ${destination.y}`;
    }
  };
  $: selectedOrder = orderForArmy(selectedArmy);
  $: selectedBattle = selectedArmy?.battleId?.value ? $battles.find((battle) => battle.battleId?.value === selectedArmy?.battleId?.value) : undefined;
  $: if (!selectedBattle) showBattlePanel = false;
  $: ownedArmies = $armies.filter((army) => army.owner?.value === $userId).sort((a, b) => (a.armyId?.value ?? '').localeCompare(b.armyId?.value ?? ''));
  $: ownedArmyTroops = ownedArmies.reduce((total, army) => total + armySize(army), 0);
  $: ownedOrderCount = ownedArmies.filter((army) => orderForArmy(army)).length;
  $: ownedCityIds = new Set($cities.filter((city) => city.owner?.value === $userId).map((city) => city.cityId?.value));
  $: ownedBarracks = $buildings.filter((building) => building.type === BuildingType.BARRACKS && ownedCityIds.has(building.cityId?.value));
  $: queuedTrainingCount = [...trainingQueues.values()].reduce((total, queue) => total + currentTrainingQueue(queue).length, 0);
  $: sortedMailboxMessages = [...$mailboxMessages].sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt));
  $: unreadMailboxCount = $mailboxMessages.filter((message) => !message.readAt).length;
  $: selectedMailboxMessage = selectedMailboxMessageId ? $mailboxMessages.find((message) => message.mailboxMessageId?.value === selectedMailboxMessageId) : undefined;
  $: selectedBarracksId = sel?.building?.type === BuildingType.BARRACKS && sel.city?.owner?.value === $userId ? (sel.building.buildingId?.value ?? null) : null;
  $: selectedTrainingOrders = selectedBarracksId ? currentTrainingQueue(trainingQueues.get(selectedBarracksId) ?? []) : [];
  $: selectedPolicyCityId = sel?.city?.owner?.value === $userId ? (sel?.city?.cityId?.value ?? null) : null;
  $: if (selectedPolicyCityId && selectedPolicyCityId !== policyDraftCityId) {
    policyDraftCityId = selectedPolicyCityId;
    militiaDraft = sel?.city?.militiaPercent ?? $gameConfig.populationPolicy?.defaultMilitiaPercent ?? 10;
    militiaTargetDraft = sel?.city?.militiaTarget ?? 0;
    taxDraft = sel?.city?.taxRatePercent ?? $gameConfig.populationPolicy?.defaultTaxRatePercent ?? 10;
    policyDraftDirty = false;
  } else if (selectedPolicyCityId && !policyDraftDirty) {
    militiaDraft = sel?.city?.militiaPercent ?? militiaDraft;
    militiaTargetDraft = sel?.city?.militiaTarget ?? militiaTargetDraft;
    taxDraft = sel?.city?.taxRatePercent ?? taxDraft;
  }
  $: if (ownedBarracks.length && trainingOrdersAvailable && now - lastTrainingOverviewPoll >= 3000) {
    loadTrainingOverview();
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
  $: goldPerHour = ownedCities.reduce((s, c) => s + (prodByCity.get(c.cityId?.value ?? '')?.gold ?? 0) + ratePerHour(c.taxIncome), 0);
  $: foodProdPerHour = ownedCities.reduce((s, c) => s + ratePerHour(c.foodProduction), 0);
  $: foodUpkeepPerHour = ownedCities.reduce((s, c) => s + ratePerHour(c.foodUpkeep), 0);
  $: netFoodPerHour = foodProdPerHour - foodUpkeepPerHour;

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

  const currentTrainingQueue = (orders: TrainingOrder[]): TrainingOrder[] => orders.filter((order) => !order.completesAt || timestampMs(order.completesAt) > now);

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
  $: if ($tiles || $tileVisibility || $cities || $buildings || $armies || $armyOrders || $battles) {
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
      if (moveOrderActive && moveArmyId === tracked.armyId?.value && moveTarget) {
        const order = orderForArmy(tracked);
        if (x === moveTarget.x && y === moveTarget.y) {
          cancelMoveMode();
        } else if (orderDestination(order)) {
          const destination = orderDestination(order)!;
          moveDestinationObserved = true;
          moveTarget = { x: destination.x, y: destination.y };
          moveHover = moveTarget;
          void drawMovePreview(moveTarget, order);
        } else if (moveDestinationObserved) {
          cancelMoveMode();
        }
      }
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
    const cityById = new Map($cities.map((city) => [city.cityId?.value, city]));
    for (const [key, data] of tileData) {
      const city = cityById.get(data.tile?.cityId?.value);
      if (city) tileData.set(key, { ...data, city });
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
  const visibilityAt = (col: number, row: number): TileVisibilityState => $tileVisibility.get(tileKey(col, row)) ?? TileVisibilityState.UNEXPLORED;
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
    showCityManagement = false;
    drawSel(col, row);
  };

  const openMailboxMessage = async (message: MailboxMessage) => {
    const id = message.mailboxMessageId?.value;
    if (!id) return;
    selectedMailboxMessageId = id;
    if (message.readAt) return;
    try {
      const response = await mailboxClient.markMailboxMessageRead({ mailboxMessageId: message.mailboxMessageId });
      if (response.message) {
        mailboxMessages.update((previous) => previous.map((candidate) => (candidate.mailboxMessageId?.value === id ? response.message! : candidate)));
      }
    } catch {
      // Reading the durable message still works if the acknowledgement must be retried.
    }
  };

  const focusBattleReport = (report: BattleReport) => {
    if (!report.tileId) return;
    const { x, y } = report.tileId;
    centerCam(x, y);
    sel = { x, y, ...tileData.get(tileKey(x, y)) };
    trackedArmyId = null;
    selectedArmyId = null;
    cancelMoveMode();
    showCityManagement = false;
    managementOpen = false;
    selectedMailboxMessageId = null;
    drawSel(x, y);
  };

  const focusBuilding = (building: Building) => {
    if (!building.coords) return;
    const { x, y } = building.coords;
    centerCam(x, y);
    sel = { x, y, ...tileData.get(tileKey(x, y)) };
    trackedArmyId = null;
    selectedArmyId = null;
    cancelMoveMode();
    err = '';
    notice = '';
    showBuild = false;
    showCityManagement = false;
    drawSel(x, y);
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
    trainingGfx.clear();
    if (selGfx) {
      selGfx.destroy();
      selGfx = null;
    }
    loadVisible();
    if (sel) drawSel(sel.x, sel.y);
    if (moveArmyId) drawMovePreview(moveTarget ?? moveHover, moveOrderActive ? orderForArmy(movingArmy) : undefined);
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

  const saveCityPolicy = async () => {
    const city = sel?.city;
    const cityId = city?.cityId?.value;
    if (!city || !cityId || city.owner?.value !== $userId) return;
    policySaving = true;
    err = '';
    notice = '';
    try {
      const response = await cityClient.updateCityPolicy({
        cityId: city.cityId,
        militiaTarget: militiaTargetDraft,
        taxRatePercent: taxDraft
      });
      if (response.city) {
        cities.update((all) => all.map((candidate) => (candidate.cityId?.value === cityId ? response.city! : candidate)));
        if (sel) sel = { ...sel, city: response.city };
      }
      policyDraftDirty = false;
      notice = 'City policy updated';
    } catch (e: unknown) {
      err = errorText(e, 'Policy update failed');
    } finally {
      policySaving = false;
    }
  };

  const loadTrainingOverview = async () => {
    if (trainingOverviewLoading) return;
    trainingOverviewLoading = true;
    lastTrainingOverviewPoll = Date.now();
    try {
      const entries = await Promise.all(
        ownedBarracks.flatMap((barracks) => {
          const id = barracks.buildingId?.value;
          return id ? [armyClient.listTrainingOrders({ barracksId: { value: id } }).then((response) => [id, response.orders] as const)] : [];
        })
      );
      const nextQueues = new Map(entries);
      const signature = (queues: Map<string, TrainingOrder[]>) =>
        [...queues]
          .map(
            ([id, orders]) =>
              `${id}:${orders.map((order) => `${order.trainingOrderId?.value}:${order.type}:${order.count}:${timestampMs(order.startedAt)}:${timestampMs(order.completesAt)}`).join(',')}`
          )
          .sort()
          .join('|');
      const changed = signature(trainingQueues) !== signature(nextQueues);
      trainingQueues = nextQueues;
      if (changed) scheduleRender();
    } catch (e: unknown) {
      if (e instanceof ConnectError && e.code === Code.Unimplemented) trainingOrdersAvailable = false;
    } finally {
      trainingOverviewLoading = false;
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
        const barracksId = barracks.buildingId?.value;
        if (barracksId) {
          const queue = currentTrainingQueue(trainingQueues.get(barracksId) ?? []);
          trainingQueues = new Map(trainingQueues).set(barracksId, [...queue.filter((order) => order.trainingOrderId?.value !== orderId), response.order]);
        }
      } else {
        lastTrainingOverviewPoll = 0;
      }
      const populationCost = count * stat.population;
      const trainingNotice = `${count} ${troopName(recruitType, count)} queued · ${populationCost} ${populationCost === 1 ? 'resident' : 'residents'} mobilized · ${fmtCountdown(count * stat.trainSeconds * 1000)}`;
      notice = trainingNotice;
      if (trainingNoticeTimer) clearTimeout(trainingNoticeTimer);
      trainingNoticeTimer = setTimeout(() => {
        if (notice === trainingNotice) notice = '';
        trainingNoticeTimer = null;
      }, 4000);
      scheduleRender();
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

  const clearMoveConfirmation = () => {
    if (!moveConfirmationGfx) return;
    cont?.removeChild(moveConfirmationGfx);
    moveConfirmationGfx.destroy();
    moveConfirmationGfx = null;
  };

  const moveIntentAtDestination = (destination: { x: number; y: number }, order?: ArmyOrder): ArmyOrderIntent => {
    if (order) return orderIntent(order);
    const destinationState = tileData.get(tileKey(destination.x, destination.y));
    if (destinationState?.armies?.some((army) => army.owner?.value && army.owner.value !== $userId)) return 'attack';
    if (destinationState?.city?.owner?.value !== $userId && isSettlementCenter(destinationState?.building)) return 'siege';
    return 'move';
  };

  const routeVisuals = (intent: ArmyOrderIntent) => {
    switch (intent) {
      case 'attack':
        return { route: 0xf87171, direction: 0xfecaca, endpoint: 0xef4444, width: 4 };
      case 'siege':
        return { route: 0xe7ad48, direction: 0xfde68a, endpoint: 0xf59e0b, width: 4 };
      case 'retreat':
        return { route: 0x67d5d2, direction: 0xcffafe, endpoint: 0x22d3c5, width: 3 };
      default:
        return { route: 0x7eb5ec, direction: 0xe2f1fb, endpoint: 0x60a5d9, width: 3 };
    }
  };

  const drawDashedRouteSegment = (graphics: Graphics, from: { sx: number; sy: number }, to: { sx: number; sy: number }, color: number, width: number) => {
    const distance = Math.hypot(to.sx - from.sx, to.sy - from.sy);
    if (!distance) return;
    for (let offset = 0; offset < distance; offset += 10) {
      const start = offset / distance;
      const end = Math.min(offset + 6, distance) / distance;
      graphics.moveTo(from.sx + (to.sx - from.sx) * start, from.sy + (to.sy - from.sy) * start);
      graphics.lineTo(from.sx + (to.sx - from.sx) * end, from.sy + (to.sy - from.sy) * end);
      graphics.stroke({ color, width, alpha: 1 });
    }
  };

  const drawMoveConfirmation = (destination: { x: number; y: number }) => {
    clearMoveConfirmation();
    if (!cont) return;
    moveOrderIntent = moveIntentAtDestination(destination);
    const color = routeVisuals(moveOrderIntent).endpoint;
    const target = tileToScreen(destination.x, destination.y);
    const indicator = new Graphics();
    indicator.position.set(target.sx, target.sy);
    indicator.poly(DIAMOND_VERTS);
    indicator.fill({ color, alpha: 0.18 });
    indicator.poly(DIAMOND_VERTS);
    indicator.stroke({ color, width: 3, alpha: 1 });
    indicator.zIndex = 9e6 + 1;
    cont.addChild(indicator);
    moveConfirmationGfx = indicator;
  };

  const drawMovePreview = async (destination: { x: number; y: number } | null, streamedOrder?: ArmyOrder): Promise<MovePreviewResult> => {
    const army = moveArmyId ? $armies.find((candidate) => candidate.armyId?.value === moveArmyId) : undefined;
    moveRouteError = '';
    if (!cont || !army?.armyId || !army.coords || !destination) return 'failed';
    const intent = moveIntentAtDestination(destination, streamedOrder);
    moveOrderIntent = intent;

    const refreshing = movePreviewDestination?.x === destination.x && movePreviewDestination.y === destination.y && moveRoute !== null;
    if (!refreshing) {
      clearMovePreview();
      moveRoute = null;
      moveHiddenSegmentEnd = null;
      moveRouteComplete = true;
      moveRouteDurationMs = 0;
      movePreviewDestination = null;
    }

    const request = ++movePreviewRequest;
    moveRouteLoading = !refreshing;
    let routeProjection = streamedOrder?.remainingRoute;
    let estimatedDuration = streamedOrder?.estimatedRemainingDuration;
    if (!streamedOrder) {
      try {
        const preview = await armyClient.previewArmyRoute({ armyId: army.armyId, destination });
        routeProjection = preview.route;
        estimatedDuration = preview.estimatedDuration;
      } catch (e: unknown) {
        if (request === movePreviewRequest) {
          moveRouteLoading = false;
          if (!refreshing) moveRouteError = errorText(e, 'The route preview could not be loaded');
        }
        return refreshing ? 'loaded' : 'failed';
      }
    }
    if (request !== movePreviewRequest || moveArmyId !== army.armyId.value) return 'superseded';
    moveRouteLoading = false;
    moveRouteError = '';
    moveRoute = (routeProjection?.knownSteps ?? []).flatMap((step) => (step.coords ? [{ x: step.coords.x, y: step.coords.y }] : []));
    moveHiddenSegmentEnd = routeProjection?.hiddenSegmentEnd ? { x: routeProjection.hiddenSegmentEnd.x, y: routeProjection.hiddenSegmentEnd.y } : null;
    const routeEnd = moveHiddenSegmentEnd ?? moveRoute.at(-1);
    moveRouteComplete = (army.coords.x === destination.x && army.coords.y === destination.y) || (routeEnd?.x === destination.x && routeEnd?.y === destination.y);
    moveRouteDurationMs = durationSeconds(estimatedDuration) * 1000;
    const points = [army.coords, ...(moveRoute ?? [])].map((step) => tileToScreen(step.x, step.y));

    const route = new Graphics();
    const visuals = routeVisuals(intent);
    const routeColor = visuals.route;
    const directionColor = visuals.direction;
    if (moveRoute) {
      for (let index = 1; index < points.length; index++) {
        const point = points[index];
        const step = moveRoute[index - 1];
        if (step.x === destination.x && step.y === destination.y) continue;
        route.poly(DIAMOND_VERTS.map((value, index) => value * 0.72 + (index % 2 === 0 ? point.sx : point.sy)));
        route.fill({ color: routeColor, alpha: 0.1 });
        route.poly(DIAMOND_VERTS.map((value, index) => value * 0.72 + (index % 2 === 0 ? point.sx : point.sy)));
        route.stroke({ color: routeColor, width: 0.75, alpha: 0.34 });
      }
      for (let index = 1; index < points.length; index++) {
        const from = points[index - 1];
        const to = points[index];
        route.moveTo(from.sx, from.sy);
        route.lineTo(to.sx, to.sy);
        route.stroke({ color: 0x111611, width: 7, alpha: 0.85 });
        if (intent === 'retreat') drawDashedRouteSegment(route, from, to, routeColor, visuals.width);
        else {
          route.moveTo(from.sx, from.sy);
          route.lineTo(to.sx, to.sy);
          route.stroke({ color: routeColor, width: visuals.width, alpha: 1 });
        }
      }
      if (moveHiddenSegmentEnd) {
        const from = points.at(-1) ?? tileToScreen(army.coords.x, army.coords.y);
        const to = tileToScreen(moveHiddenSegmentEnd.x, moveHiddenSegmentEnd.y);
        route.moveTo(from.sx, from.sy);
        route.lineTo(to.sx, to.sy);
        route.stroke({ color: 0x111611, width: 7, alpha: 0.85 });
        const distance = Math.hypot(to.sx - from.sx, to.sy - from.sy);
        for (let offset = 4; offset < distance; offset += 7) {
          const ratio = offset / distance;
          route.circle(from.sx + (to.sx - from.sx) * ratio, from.sy + (to.sy - from.sy) * ratio, 1.5);
          route.fill({ color: routeColor, alpha: 0.85 });
        }
      }
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
        route.fill({ color: directionColor, alpha: 1 });
        route.poly([cx + nx * 5, cy + ny * 5, cx - nx * 4 + px * 3.5, cy - ny * 4 + py * 3.5, cx - nx * 4 - px * 3.5, cy - ny * 4 - py * 3.5]);
        route.stroke({ color: 0x17202a, width: 1, alpha: 0.9 });
      }
    }
    const target = tileToScreen(destination.x, destination.y);
    const endpointColor = visuals.endpoint;
    route.poly(DIAMOND_VERTS.map((value, index) => value + (index % 2 === 0 ? target.sx : target.sy)));
    route.fill({ color: endpointColor, alpha: 0.14 });
    route.poly(DIAMOND_VERTS.map((value, index) => value + (index % 2 === 0 ? target.sx : target.sy)));
    route.stroke({ color: endpointColor, width: 2, alpha: 0.95 });
    if (intent === 'attack') {
      route.moveTo(target.sx - 7, target.sy - 7);
      route.lineTo(target.sx + 7, target.sy + 7);
      route.moveTo(target.sx + 7, target.sy - 7);
      route.lineTo(target.sx - 7, target.sy + 7);
      route.stroke({ color: endpointColor, width: 2.5, alpha: 1 });
    } else if (intent === 'siege') {
      route.rect(target.sx - 7, target.sy - 7, 14, 14);
      route.stroke({ color: endpointColor, width: 2.5, alpha: 1 });
      route.circle(target.sx, target.sy, 2.5);
      route.fill({ color: endpointColor, alpha: 1 });
    } else if (intent === 'retreat') {
      route.circle(target.sx, target.sy, 8);
      route.stroke({ color: endpointColor, width: 2.5, alpha: 1 });
    }
    if (intent === 'move' && moveRouteComplete && !moveHiddenSegmentEnd && points.length > 1) {
      const from = points.at(-2)!;
      const dx = target.sx - from.sx;
      const dy = target.sy - from.sy;
      const length = Math.hypot(dx, dy) || 1;
      const nx = dx / length;
      const ny = dy / length;
      const px = -ny;
      const py = nx;
      const baseX = target.sx - nx * 14;
      const baseY = target.sy - ny * 14;
      route.poly([target.sx + nx * 2, target.sy + ny * 2, baseX + px * 8, baseY + py * 8, baseX - px * 8, baseY - py * 8]);
      route.fill({ color: 0x111611, alpha: 0.96 });
      const innerBaseX = target.sx - nx * 11;
      const innerBaseY = target.sy - ny * 11;
      route.poly([target.sx, target.sy, innerBaseX + px * 5, innerBaseY + py * 5, innerBaseX - px * 5, innerBaseY - py * 5]);
      route.fill({ color: routeColor, alpha: 1 });
    }
    route.zIndex = 9e6;
    clearMovePreview();
    cont.addChild(route);
    moveGfx = route;
    movePreviewDestination = { ...destination };
    return 'loaded';
  };

  const clearMoveTarget = () => {
    moveTarget = null;
    moveHover = null;
    moveRoute = null;
    moveHiddenSegmentEnd = null;
    moveRouteComplete = true;
    moveRouteLoading = false;
    moveRouteDurationMs = 0;
    movePreviewDestination = null;
    moveOrderActive = false;
    moveDestinationObserved = false;
    moveOrderIntent = 'move';
    moveConfirmationPending = false;
    moveConfirmationPreview = null;
    movePreviewRequest++;
    clearMovePreview();
    clearMoveConfirmation();
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
    showCityManagement = false;
    showBattlePanel = false;
    if (center) centerCam(x, y);
    drawSel(x, y);
    const order = orderForArmy(army);
    const destination = orderDestination(order);
    if (destination) {
      moveArmyId = id;
      moveTarget = { x: destination.x, y: destination.y };
      moveHover = moveTarget;
      moveOrderActive = true;
      moveDestinationObserved = true;
      void drawMovePreview(moveTarget, order);
    }
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
    if (!army?.armyId || !army.coords || busy) return;
    moveConfirmationPending = false;
    moveConfirmationPreview = null;
    clearMoveConfirmation();
    busy = true;
    err = '';
    notice = '';
    try {
      await new Promise((resolve) => setTimeout(resolve, MOVE_ORDER_SUBMIT_DELAY_MS));
      const destinationState = tileData.get(tileKey(destination.x, destination.y));
      const hostile = destinationState?.armies?.find((candidate) => candidate.owner?.value && candidate.owner.value !== $userId);
      const settlement = destinationState?.city;
      const settlementCenter = settlement?.start && destination.x === settlement.start.x + Math.floor(settlement.size / 2) && destination.y === settlement.start.y + Math.floor(settlement.size / 2);
      if (hostile?.armyId) {
        await armyClient.attackArmy({ armyId: army.armyId, targetArmyId: hostile.armyId });
      } else if (settlement?.cityId && settlement.owner?.value !== $userId && settlementCenter) {
        await armyClient.conquerSettlement({ armyId: army.armyId, cityId: settlement.cityId });
      } else {
        await armyClient.moveArmy({ armyId: army.armyId, destination });
      }
      if (destination.x === army.coords.x && destination.y === army.coords.y) {
        notice = 'Army ordered to hold its current position.';
        cancelMoveMode();
      } else {
        notice = hostile
          ? `Attack order issued: pursue ${armyTitle(hostile)}.`
          : settlement && settlementCenter
            ? `Siege order issued: advance on ${settlement.name}.`
            : moveRoute
              ? moveRouteComplete
                ? `Move order issued: march to tile ${destination.x}, ${destination.y}.`
                : `Move order issued: advance as far as known land permits toward ${destination.x}, ${destination.y}.`
              : `Move order issued for tile ${destination.x}, ${destination.y}.`;
        moveTarget = { ...destination };
        moveHover = moveTarget;
        moveOrderActive = true;
        moveDestinationObserved = false;
      }
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
      if (army.battleId) await armyClient.retreatArmy({ armyId: army.armyId });
      else await armyClient.moveArmy({ armyId: army.armyId, destination: army.coords });
      trackedArmyId = army.armyId.value;
      notice = army.battleId ? 'Army ordered to retreat.' : 'Army ordered to hold its current position.';
      if (army.battleId) showBattlePanel = false;
      cancelMoveMode();
    } catch (e: unknown) {
      err = errorText(e, 'Halt order failed');
    } finally {
      busy = false;
    }
  };

  const selectSplitComposition = (type: TroopType, count: number) => {
    showSplit = true;
    splitCounts = { [type]: count };
  };

  const splitArmy = async (army: Army) => {
    if (!army.armyId || army.owner?.value !== $userId || army.battleId || busy) return;
    const troops = army.troops.flatMap((stack) => {
      const count = splitCounts[stack.type] ?? 0;
      return count > 0 ? [{ type: stack.type, count }] : [];
    });
    if (splitTotal <= 0 || splitTotal >= armySize(army)) {
      err = 'Choose at least one troop while leaving at least one in the source army.';
      return;
    }
    busy = true;
    err = '';
    notice = '';
    try {
      const detachedCount = splitTotal;
      const response = await armyClient.splitArmy({ armyId: army.armyId, troops });
      const incoming = response.entities?.armies ?? [];
      if (incoming.length) {
        armies.update((previous) => {
          const byId = new Map(previous.map((candidate) => [candidate.armyId?.value, candidate]));
          for (const candidate of incoming) byId.set(candidate.armyId?.value, candidate);
          return [...byId.values()];
        });
      }
      const detached = incoming.find((candidate) => candidate.armyId?.value === response.armyId?.value);
      showSplit = false;
      splitCounts = {};
      notice = `Created a new army with ${detachedCount.toLocaleString()} troops.`;
      if (detached) focusArmy(detached, false);
    } catch (e: unknown) {
      err = errorText(e, 'Army split failed');
    } finally {
      busy = false;
    }
  };

  // ── pixi init ───────────────────────────────────────────
  onMount(() => {
    buildLookup();
    initSprites().then(() => initPixi());
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

      for (const [, entry] of trainingGfx) {
        const { gfx, startMs, endMs } = entry;
        const active = startMs > 0 && endMs > startMs;
        if (active && nowMs >= endMs) {
          gfx.parent.visible = false;
          continue;
        }
        const pct = active ? Math.max(0, Math.min(1, (nowMs - startMs) / (endMs - startMs))) : 0;
        gfx.clear();
        gfx.rect(-17, 7, 34, 2);
        gfx.fill({ color: 0x0f191c, alpha: 1 });
        gfx.rect(-17, 7, 34 * pct, 2);
        gfx.fill({ color: 0x7fc4b5, alpha: 1 });
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
      text: demographicsKnown(city) ? residents(city).toLocaleString() : '?',
      roundPixels: true,
      resolution: 4,
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
      resolution: 4,
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

  const addTrainingMarker = (building: Building, tile: Container, key: string) => {
    const id = building.buildingId?.value;
    const queue = id ? currentTrainingQueue(trainingQueues.get(id) ?? []) : [];
    const active = queue[0];
    if (!active) return;

    const marker = new Container();
    marker.position.set(20, -42);
    marker.zIndex = 3e6;
    marker.eventMode = 'static';
    marker.cursor = 'pointer';
    marker.on('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      focusBuilding(building);
    });

    const plate = new Graphics();
    plate.rect(-17, -7, 34, 14);
    plate.fill({ color: 0x1b292b, alpha: 0.98 });
    plate.rect(-17, -7, 34, 14);
    plate.stroke({ color: 0x6f8d8b, width: 1, alpha: 1 });

    const glyph = new Graphics();
    if (active.type === TroopType.ARCHER) {
      glyph.arc(-11, 0, 4.5, -Math.PI / 2, Math.PI / 2);
      glyph.moveTo(-11, -4.5);
      glyph.lineTo(-11, 4.5);
      glyph.moveTo(-14, 0);
      glyph.lineTo(-5, 0);
      glyph.moveTo(-7, -2);
      glyph.lineTo(-5, 0);
      glyph.lineTo(-7, 2);
    } else if (active.type === TroopType.CAVALRY) {
      glyph.moveTo(-15, 6);
      glyph.lineTo(-14, 1);
      glyph.lineTo(-11, -3);
      glyph.lineTo(-12, -6);
      glyph.lineTo(-7, -4);
      glyph.lineTo(-4, -7);
      glyph.lineTo(-3, -1);
      glyph.lineTo(0, 1);
      glyph.lineTo(-2, 4);
      glyph.lineTo(-8, 4.5);
      glyph.lineTo(-11, 6);
      glyph.closePath();
      glyph.moveTo(-10, -3);
      glyph.lineTo(-5, 0);
      glyph.moveTo(-14, 1);
      glyph.lineTo(-11, 2.5);
      glyph.circle(-3.5, 0.5, 0.7);
      glyph.fill({ color: 0xb8cbc5, alpha: 1 });
    } else if (active.type === TroopType.ARTILLERY) {
      glyph.circle(-13, 3, 2.5);
      glyph.circle(-5, 3, 2.5);
      glyph.circle(-13, 3, 0.7);
      glyph.circle(-5, 3, 0.7);
      glyph.moveTo(-16, 0.5);
      glyph.lineTo(-2, 0.5);
      glyph.moveTo(-12, 0.5);
      glyph.lineTo(-7, -4.5);
      glyph.lineTo(-2, -6);
      glyph.lineTo(-1, -3.5);
      glyph.lineTo(-7, -1);
    } else {
      glyph.moveTo(-10, -6);
      glyph.lineTo(-7, -3);
      glyph.lineTo(-8.5, 2);
      glyph.lineTo(-11.5, 2);
      glyph.lineTo(-13, -3);
      glyph.closePath();
      glyph.fill({ color: 0xffffff, alpha: 1 });
      glyph.moveTo(-15, 2);
      glyph.lineTo(-5, 2);
      glyph.moveTo(-10, 2);
      glyph.lineTo(-10, 6);
      glyph.moveTo(-12, 6);
      glyph.lineTo(-8, 6);
    }
    glyph.stroke({ color: 0xb8cbc5, width: 1.35, alpha: 1 });

    const label = new Text({
      text: active.count.toLocaleString(),
      roundPixels: true,
      resolution: 4,
      style: {
        fontFamily: ['Tahoma', 'Verdana', 'Arial', 'sans-serif'],
        fontSize: 9,
        fontWeight: 'bold',
        fill: '#ffffff',
        stroke: { color: '#0b1110', width: 1.5 }
      }
    });
    label.anchor.set(0.5);
    label.position.x = 4;

    const progress = new Graphics();
    marker.addChild(plate, glyph, label, progress);
    tile.addChild(marker);
    trainingGfx.set(key, { gfx: progress, startMs: timestampMs(active.startedAt), endMs: timestampMs(active.completesAt) });
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

    const visibility = visibilityAt(col, row);
    const visible = visibility === TileVisibilityState.VISIBLE;
    const explored = visibility === TileVisibilityState.EXPLORED;
    const kind = visibility === TileVisibilityState.UNEXPLORED ? 'fog' : terrainKind(terrainAt(col, row));
    tc.addChild(getTerrainSprite(kind, col, row));
    if (visibility !== TileVisibilityState.UNEXPLORED) {
      const neighbors = EDGE_TO_NEIGHBOR.map(([dc, dr]) => {
        const neighborCol = col + dc;
        const neighborRow = row + dr;
        if (neighborCol < 0 || neighborRow < 0 || neighborCol >= worldWidth || neighborRow >= worldHeight) return null;
        if (visibilityAt(neighborCol, neighborRow) === TileVisibilityState.UNEXPLORED) return 'fog';
        return terrainKind(terrainAt(neighborCol, neighborRow));
      }) as unknown as TerrainNeighbors;
      const transition = getTerrainTransitionSprite(kind, neighbors, col, row);
      if (transition) tc.addChild(transition);
    }
    if (explored) {
      const memoryFog = new Graphics();
      memoryFog.poly(DIAMOND_VERTS);
      memoryFog.fill({ color: 0x101613, alpha: 0.52 });
      memoryFog.zIndex = 9e5;
      tc.addChild(memoryFog);
    }
    if (visible && td?.building) tc.addChild(getStructureSprite(structureKind(td.building.type)));
    if (visible && td?.city && (td.building?.type === BuildingType.CITY_CENTER || td.building?.type === BuildingType.TOWN_CENTER)) addCityLabel(td.city, px, py);

    const visibleArmies = visible ? td?.armies : undefined;
    if (visibleArmies?.length) {
      const army = visibleArmies.find((candidate) => candidate.armyId?.value === selectedArmyId) ?? [...visibleArmies].sort((a, b) => armySize(b) - armySize(a))[0];
      const marker = createArmyMarker(army, $userId, army.armyId?.value === selectedArmyId);
      if (visibleArmies.length > 1) {
        const badge = new Container();
        badge.position.set(14, -14);
        const plate = new Graphics();
        plate.rect(-7, -6, 15, 12);
        plate.fill({ color: 0x18282c, alpha: 0.98 });
        plate.rect(-7, -6, 15, 12);
        plate.stroke({ color: 0x8ba3a5, width: 1, alpha: 1 });
        const count = new Text({
          text: `×${visibleArmies.length}`,
          roundPixels: true,
          resolution: 4,
          style: {
            fontFamily: ['Tahoma', 'Verdana', 'Arial', 'sans-serif'],
            fontSize: 8,
            fontWeight: 'bold',
            fill: '#ffffff',
            stroke: { color: '#0b1110', width: 1.25 }
          }
        });
        count.anchor.set(0.5);
        badge.addChild(plate, count);
        marker.addChild(badge);
      }
      marker.eventMode = 'static';
      marker.cursor = 'pointer';
      marker.on('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        if (visibleArmies.length === 1) {
          focusArmy(army, false);
          return;
        }
        cancelMoveMode();
        trackedArmyId = null;
        selectedArmyId = null;
        sel = { x: col, y: row, ...tileData.get(k) };
        err = '';
        notice = '';
        showBuild = false;
        showCityManagement = false;
        drawSel(col, row);
      });
      tc.addChild(marker);
    }

    if (visible && td?.building?.type === BuildingType.BARRACKS) addTrainingMarker(td.building, tc, k);

    // Construction-in-progress overlay
    if (visible && td?.building?.constructionStart && td?.building?.constructionEnd) {
      const startMs = Number(td.building.constructionStart.seconds) * 1000;
      const endMs = Number(td.building.constructionEnd.seconds) * 1000;
      if (endMs > Date.now()) {
        const cg = new Graphics();
        cg.zIndex = 1e6;
        tc.addChild(cg);
        constructionGfx.set(k, { gfx: cg, startMs, endMs, cx: px, cy: py });
      }
    }

    if (visible) {
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
    showCityManagement = false;
    showBattlePanel = false;
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
          const clickedKey = tileKey(mc.x, mc.y);
          const clickedAt = performance.now();
          const t = tileData.get(clickedKey);
          const doubleClicked = lastTileClickKey === clickedKey && clickedAt - lastTileClickAt <= DOUBLE_CLICK_MS;
          const openBuildingManagement = !!t?.building && doubleClicked;
          const openConstruction = !t?.building && !t?.armies?.length && t?.city?.owner?.value === $userId && doubleClicked;
          lastTileClickKey = clickedKey;
          lastTileClickAt = clickedAt;
          if (t?.armies?.length === 1 && !t.building) {
            focusArmy(t.armies[0], false);
          } else {
            trackedArmyId = null;
            selectedArmyId = null;
            sel = { x: mc.x, y: mc.y, ...t };
            err = '';
            notice = '';
            showBuild = openConstruction;
            showCityManagement = false;
            recruitCount = 1;
            drawSel(mc.x, mc.y);
            if (openBuildingManagement) openSelectedManagement();
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

  const onContextMenu = async (e: MouseEvent) => {
    e.preventDefault();
    const army = selectedArmyId ? $armies.find((candidate) => candidate.armyId?.value === selectedArmyId) : undefined;
    if (!army?.armyId?.value || !army.coords || army.owner?.value !== $userId) return;
    if (busy || !cont) return;
    const rect = app.canvas.getBoundingClientRect();
    const tile = screenToTile((e.clientX - rect.left - cont.x) / cont.scale.x, (e.clientY - rect.top - cont.y) / cont.scale.y);
    if (tile.x < 0 || tile.y < 0 || tile.x >= worldWidth || tile.y >= worldHeight) return;

    if (moveConfirmationPending) {
      if (moveTarget?.x !== tile.x || moveTarget.y !== tile.y) {
        cancelMoveMode();
        notice = 'Movement order cancelled.';
        return;
      }
      const pendingPreview = moveConfirmationPreview;
      if (pendingPreview) await pendingPreview;
      if (!moveConfirmationPending || moveTarget?.x !== tile.x || moveTarget.y !== tile.y) return;
      await issueMove(tile);
      return;
    }

    moveArmyId = army.armyId.value;
    moveTarget = tile;
    moveHover = tile;
    moveOrderActive = false;
    moveConfirmationPending = true;
    err = '';
    notice = '';
    drawMoveConfirmation(tile);
    const preview = drawMovePreview(tile);
    moveConfirmationPreview = preview;
    const previewResult = await preview;
    if (moveConfirmationPreview === preview) moveConfirmationPreview = null;
    if (!moveConfirmationPending || moveTarget?.x !== tile.x || moveTarget.y !== tile.y) return;
    if (previewResult === 'failed') notice = `${moveRouteError || 'Route preview unavailable'}. Right-click the tile again to let the server validate it.`;
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
        else if (selectedMailboxMessageId) selectedMailboxMessageId = null;
        else if (showHelp) showHelp = false;
        else if (showBattlePanel) showBattlePanel = false;
        else if (showCityManagement) showCityManagement = false;
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
  }}
/>

{#if activeGameTooltip}
  <div
    class="pointer-events-none fixed z-[100] w-44 border border-[#61777b] bg-[#172427]/95 px-2.5 py-2 text-left shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-sm"
    style={`left: ${activeGameTooltip.x}px; top: ${activeGameTooltip.y}px; transform: translate(-50%, ${activeGameTooltip.below ? '0' : '-100%'});`}
    transition:fade={{ duration: 100 }}
  >
    <strong class="block text-[10px] font-bold text-[#edf3f1]">{activeGameTooltip.title}</strong>
    <span class="mt-0.5 block text-[9px] font-normal leading-relaxed text-[#9baaa9]">{activeGameTooltip.detail}</span>
    <span
      class="absolute left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-[#61777b] bg-[#172427] {activeGameTooltip.below
        ? 'bottom-full translate-y-1/2 border-l border-t'
        : 'top-full -translate-y-1/2 border-b border-r'}"
    ></span>
  </div>
{/if}

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

{#snippet reportSideRecord(label: string, side: ReportSide | undefined, attacking: boolean)}
  {@const starting = reportSideStart(side)}
  {@const surviving = reportSideSurvivors(side)}
  <section class="border border-white/[0.09] bg-black/[0.1]">
    <div class="flex items-start justify-between gap-3 border-b border-white/[0.07] px-2.5 py-2">
      <div>
        <strong class="block text-[10px] uppercase tracking-[0.1em] {attacking ? 'text-red-200' : 'text-blue-200'}">{label}</strong>
        <span class="text-[8px] text-[#78837c]">
          {(side?.commanders ?? []).map((commander) => (commander.userId?.value === $userId ? 'You' : commander.username || shortId(commander.userId?.value))).join(', ') ||
            `${side?.userIds.length ?? 0} commanders`}
          · {side?.armies.length ?? 0} formations
        </span>
      </div>
      <div class="text-right text-[9px] tabular-nums text-[#aeb7b0]"><strong class="block text-xs text-[#eee9d8]">{starting} → {surviving}</strong>{Math.max(0, starting - surviving)} lost</div>
    </div>
    {#if side?.settlement}
      <div class="border-b border-white/[0.06] bg-amber-200/[0.035] px-2.5 py-1.5 text-[9px] text-[#8e9891]">
        <div class="flex items-center justify-between gap-2">
          <strong class="truncate text-amber-100">{side.settlement.name}</strong>
          <span class="shrink-0 tabular-nums">Residents {Math.floor(side.settlement.startingPopulation).toLocaleString()} → {Math.floor(side.settlement.endingPopulation).toLocaleString()}</span>
        </div>
        <div class="mt-0.5 flex items-center justify-between gap-2 text-[8px]">
          <span>Defended settlement {shortId(side.settlement.cityId?.value)}</span>
          <span class="tabular-nums text-amber-100">Militia {side.startingMilitia.toString()} → {side.survivingMilitia.toString()}</span>
        </div>
      </div>
    {/if}
    <div class="space-y-1.5 p-2">
      {#each side?.armies ?? [] as army}
        <div class="border border-white/[0.07] bg-white/[0.025] px-2 py-1.5">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <strong class="block truncate text-[9px] text-[#dce3dc]">Army {shortId(army.armyId?.value)}</strong>
              <span class="block truncate text-[8px] text-[#717d76]">Commander {army.ownerId?.value === $userId ? 'you' : shortId(army.ownerId?.value)}</span>
            </div>
            <span class="text-right text-[8px] font-bold uppercase tracking-wide {army.destroyed ? 'text-red-300' : army.retreated ? 'text-cyan-200' : 'text-emerald-200'}">
              {army.destroyed ? 'Destroyed' : army.retreated ? 'Retreated' : 'Survived'}
            </span>
          </div>
          <div class="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 border-t border-white/[0.05] pt-1 text-[8px] tabular-nums text-[#8e9992]">
            {#each army.startingTroops as stack}
              {@const survivorCount = troopStackCount(army.survivingTroops, stack.type)}
              <span>{troopName(stack.type, stack.count)} <strong class={survivorCount < (stack.count ?? 0) ? 'text-red-200' : 'text-[#c7cec7]'}>{stack.count ?? 0} → {survivorCount}</strong></span>
            {/each}
          </div>
          <div class="mt-1 text-[8px] tabular-nums text-[#68736d]">{troopStackTotal(army.startingTroops)} deployed · {reportArmyLosses(army)} casualties</div>
        </div>
      {:else}
        <div class="px-2 py-2 text-center text-[8px] text-[#68736d]">No field armies</div>
      {/each}
    </div>
  </section>
{/snippet}

{#snippet reportRoundLosses(losses: BattleReportLoss[])}
  {#each losses as loss}
    <div class="mt-0.5 flex items-start justify-between gap-2 text-[8px] text-[#77827b]">
      <span>{loss.militiaCityId ? `Militia ${shortId(loss.militiaCityId.value)}` : `Army ${shortId(loss.armyId?.value)}`}</span>
      <span class="text-right tabular-nums text-red-200/80">{reportLossDescription(loss)}</span>
    </div>
  {/each}
{/snippet}

{#snippet populationSegment(label: string, count: number, detail: string, color: string, width: number)}
  <span
    class="relative block h-full"
    style={`width: ${width}%; background-color: ${color}`}
    role="img"
    aria-label={`${count.toLocaleString()} ${label}. ${detail}`}
    on:mouseenter={(event) => showGameTooltip(event, `${count.toLocaleString()} ${label}`, detail)}
    on:mouseleave={hideGameTooltip}
  ></span>
{/snippet}

{#snippet populationUse(city: City)}
  {@const totalResidents = residents(city)}
  {@const totalCapacity = housingCapacity(city)}
  {@const displayedCapacity = Math.max(totalCapacity, totalResidents)}
  {@const openHousing = Math.max(0, totalCapacity - totalResidents)}
  {@const taxpayerResidents = taxpayerPopulation(city)}
  {@const militiaResidents = totalResidents - taxpayerResidents}
  {@const recruitableResidents = Math.min(taxpayerResidents, trainablePopulation(city))}
  {@const coreResidents = taxpayerResidents - recruitableResidents}
  <div class="border border-[#465a5f] bg-black/[0.08] px-3 py-2.5">
    <div class="flex items-end justify-between gap-3">
      <div>
        <div class="inspector-label">Population use</div>
        <div class="mt-0.5 text-[9px] text-[#758486]">Resident roles and remaining housing capacity.</div>
      </div>
      <div class="text-right">
        <div class="text-[9px] uppercase tracking-wide text-[#718083]">All residents</div>
        <strong class="block text-base tabular-nums text-[#eef1e8]">{totalResidents.toLocaleString()} / {totalCapacity.toLocaleString()}</strong>
      </div>
    </div>

    <div class="mt-2 flex h-2 bg-white/[0.06]">
      {@render populationSegment(
        'taxpayers',
        taxpayerResidents,
        'Residents who pay tax: core civilians plus recruitable residents.',
        '#c8ac6d',
        displayedCapacity > 0 ? (taxpayerResidents / displayedCapacity) * 100 : 0
      )}
      {@render populationSegment(
        'militia',
        militiaResidents,
        'Local defenders who consume food but do not pay tax.',
        '#78a9b5',
        displayedCapacity > 0 ? (militiaResidents / displayedCapacity) * 100 : 0
      )}
      {@render populationSegment('open housing', openHousing, 'Capacity available for future population growth.', '#303c3c', displayedCapacity > 0 ? (openHousing / displayedCapacity) * 100 : 0)}
    </div>

    <div class="mt-2 grid grid-cols-[minmax(0,2fr)_minmax(7rem,1fr)] gap-2">
      <div class="border border-amber-100/15 bg-amber-100/[0.035] px-2.5 py-2">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-[9px] font-bold uppercase tracking-wide text-amber-100/80">Taxpayers</div>
            <div class="mt-0.5 text-[8px] text-[#7d8580]">Core civilians + recruitable residents</div>
          </div>
          <strong class="text-sm tabular-nums text-amber-100">{taxpayerResidents.toLocaleString()}</strong>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-3 border-l border-white/[0.09] pl-2.5">
          <div>
            <div class="inspector-stat-label">Core civilians</div>
            <div class="inspector-stat-value">{coreResidents.toLocaleString()}</div>
          </div>
          <div>
            <div class="inspector-stat-label">Recruitable</div>
            <div class="inspector-stat-value text-emerald-200">{recruitableResidents.toLocaleString()}</div>
          </div>
        </div>
        <div class="mt-1.5 flex h-1.5 bg-white/[0.06]">
          {@render populationSegment(
            'core civilians',
            coreResidents,
            'Core civilians pay tax and cannot be recruited.',
            '#7f8e77',
            taxpayerResidents > 0 ? (coreResidents / taxpayerResidents) * 100 : 0
          )}
          {@render populationSegment(
            'recruitable residents',
            recruitableResidents,
            'Taxpayers currently available to transfer into troop training.',
            '#77bfa6',
            taxpayerResidents > 0 ? (recruitableResidents / taxpayerResidents) * 100 : 0
          )}
        </div>
      </div>
      <div class="border border-blue-200/15 bg-blue-200/[0.045] px-2.5 py-2">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-[9px] font-bold uppercase tracking-wide text-blue-200/80">Militia</div>
            <div class="mt-0.5 text-[8px] leading-relaxed text-[#7d898b]">Local defenders; no tax</div>
          </div>
          <strong class="text-sm tabular-nums text-blue-200">{militiaResidents.toLocaleString()}</strong>
        </div>
      </div>
    </div>

    <div class="mt-2 space-y-0.5 border-t border-white/[0.06] pt-1.5 text-[8px] tabular-nums text-[#718083]">
      <div>{coreResidents.toLocaleString()} core civilians + {recruitableResidents.toLocaleString()} recruitable = {taxpayerResidents.toLocaleString()} taxpayers</div>
      <div>{taxpayerResidents.toLocaleString()} taxpayers + {militiaResidents.toLocaleString()} militia = {totalResidents.toLocaleString()} residents</div>
      <div>{totalResidents.toLocaleString()} residents + {openHousing.toLocaleString()} open housing = {totalCapacity.toLocaleString()} capacity</div>
    </div>
  </div>
{/snippet}

{#snippet resourceGlyph(kind: 'gold' | 'food')}
  {#if kind === 'gold'}
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
      <circle cx="12" cy="12" r="8" fill="currentColor" opacity=".18" />
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 8.5v7M9.5 10.5h3.8a1.7 1.7 0 0 1 0 3.4H9.5" />
    </svg>
  {:else}
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3.5 15.2C4.4 10.7 9.7 5 14.1 3.8c3.2-.9 6.7 2.1 6.2 5.3-.7 4.5-6.7 10.1-11.2 11.1-3.1.7-6.2-1.9-5.6-5Z" fill="currentColor" opacity=".14" />
      <path d="M3.5 15.2C4.4 10.7 9.7 5 14.1 3.8c3.2-.9 6.7 2.1 6.2 5.3-.7 4.5-6.7 10.1-11.2 11.1-3.1.7-6.2-1.9-5.6-5Z" />
      <path d="M8.1 9.3c.8 1.1 1.9 1.8 3.2 2.1M11.2 6.5c.9 1.2 2 1.9 3.3 2.2M14.8 4.1c.7 1.2 1.8 2 3.1 2.4" />
    </svg>
  {/if}
{/snippet}

{#snippet managementGlyph(tab: 'armies' | 'cities' | 'training' | 'inbox')}
  {#if tab === 'armies'}
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
      <path d="M12 3 20 6v5c0 5-3.2 8.3-8 10-4.8-1.7-8-5-8-10V6l8-3Z" fill="currentColor" opacity=".12" />
      <path d="M12 3 20 6v5c0 5-3.2 8.3-8 10-4.8-1.7-8-5-8-10V6l8-3Z" />
      <path d="M8 12h8M9 9.5c1.8-2 4.2-2 6 0V15H9V9.5Z" />
    </svg>
  {:else if tab === 'cities'}
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="miter">
      <path d="M3 21h18M5 21V9h4v12M9 21V5h6v16M15 21V10h4v11" />
      <path d="M5 9V6h4v3M9 5V2h6v3M15 10V7h4v3M11 21v-5h2v5" />
    </svg>
  {:else if tab === 'training'}
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
      <path d="M5 12c0-4.5 3-8 7-8s7 3.5 7 8H5ZM7 12v3h10v-3M6 18h12M9 15v3M15 15v3" fill="currentColor" opacity=".12" />
      <path d="M5 12c0-4.5 3-8 7-8s7 3.5 7 8H5ZM7 12v3h10v-3M6 18h12M9 15v3M15 15v3" />
      <path d="M18 4v5M15.5 6.5h5" />
    </svg>
  {:else}
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
      <path d="M4 5h16v14H4V5Z" fill="currentColor" opacity=".1" />
      <path d="M4 5h16v14H4V5Zm0 2 8 6 8-6" />
    </svg>
  {/if}
{/snippet}

{#snippet troopGlyph(type: TroopType)}
  {@const tier = 'I'}
  <span class="unit-token {type === TroopType.SOLDIER ? 'unit-token-soldier' : ''}">
    <svg viewBox="0 0 36 36" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      {#if type === TroopType.SOLDIER}
        <path d="m18 4 4 4-2.5 15h-3L14 8l4-4Z" fill="currentColor" stroke-width="1.9" />
        <path d="M10 23h16M18 23v8M14.5 31h7" stroke-width="2" />
      {:else if type === TroopType.ARCHER}
        <path d="M10 6c13 4 13 20 0 24M10 6v24M8 18h20M25 15l4 3-4 3" stroke-width="1.8" />
        <path d="m10 18 7-7M10 18l7 7" stroke-width="1.2" opacity=".65" />
      {:else if type === TroopType.CAVALRY}
        <path d="M8 31h21v-4h-4l2-5 4-4-3-5-1-8-4 5-7-4 2 7c-5 3.8-7.2 9-8 14L8 31Z" fill="currentColor" opacity=".2" stroke-width="1.8" />
        <path d="M10 27h15M18 13l7 4M15 17l3 2-4 2M23 10l4 4M25 22h2" stroke-width="1.6" />
        <circle cx="26.7" cy="16.8" r="1.1" fill="currentColor" stroke="none" />
      {:else}
        <circle cx="10" cy="27" r="4" stroke-width="1.8" /><circle cx="25" cy="27" r="4" stroke-width="1.8" />
        <circle cx="10" cy="27" r="1" fill="currentColor" stroke="none" /><circle cx="25" cy="27" r="1" fill="currentColor" stroke="none" />
        <path d="M6 23h22M11 23l9-10 9-3 1.5 4-10 4-4 5M17 17l5 6" fill="currentColor" opacity=".14" stroke-width="1.8" />
      {/if}
    </svg>
    <span class="unit-tier">{tier}</span>
  </span>
{/snippet}

{#snippet structureGlyph(type: BuildingType, level: number)}
  <span class="structure-token">
    <svg viewBox="0 0 42 42" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
      {#if type === BuildingType.FARM}
        <path d="M8 34V17l13-8 13 8v17H8Z" fill="currentColor" opacity=".12" />
        <path d="m6 18 15-10 15 10M9 17v17h24V17M15 34V23h12v11" />
        <path d="M15 25h12M19 23v11M23 23v11" opacity=".7" />
      {:else if type === BuildingType.MINE}
        <path d="M7 18h28l-4 11H11L7 18Z" fill="currentColor" opacity=".14" />
        <path d="M7 18h28l-4 11H11L7 18ZM10 29h22M7 34h29" />
        <path d="M11 18c.5-3 2.4-5 5-5 1.2 0 2.3.4 3.2 1.1C20 10.5 22.4 8 26 8c4.2 0 7 3.4 7 7.5V18" />
        <circle cx="14" cy="33" r="2.5" fill="currentColor" opacity=".22" />
        <circle cx="29" cy="33" r="2.5" fill="currentColor" opacity=".22" />
        <circle cx="14" cy="33" r="2.5" /><circle cx="29" cy="33" r="2.5" />
      {:else if type === BuildingType.BARRACKS}
        <path d="M7 34V15h28v19H7Z" fill="currentColor" opacity=".12" />
        <path d="M7 34V15h28v19M5 15h32M11 15V9h6v6M25 15V9h6v6M17 34V24h8v10M11 21h4M27 21h4" />
      {:else}
        <path d="M8 34V18L21 8l13 10v16H8Z" fill="currentColor" opacity=".12" />
        <path d="m6 19 15-12 15 12M9 18v16h24V18M17 34V23h8v11" />
      {/if}
    </svg>
    <span class="structure-level" title={`Level ${level}`}>{level || '…'}</span>
  </span>
{/snippet}

{#snippet battleSidePanel(label: string, side: BattleSide | undefined, attackers: boolean)}
  {@const sideArmies = battleSideArmies(side)}
  {@const exactArmies = sideArmies.filter((army) => army.compositionVisibility === ArmyCompositionVisibility.EXACT)}
  {@const knownUnits = exactArmies.reduce((total, army) => total + armySize(army), 0)}
  {@const knownPersonnel = exactArmies.reduce((total, army) => total + armyPersonnel(army), 0)}
  {@const concealedStrength = (side?.armyIds.length ?? 0) - exactArmies.length}
  {@const yourSide = side?.userIds.some((id) => id.value === $userId)}
  <section class="battle-side {attackers ? 'battle-side-attackers' : 'battle-side-defenders'}">
    <div class="flex items-start justify-between gap-3 border-b border-white/[0.08] px-3 py-2.5">
      <div>
        <div class="text-[10px] font-bold uppercase tracking-[0.12em] {attackers ? 'text-red-200' : 'text-blue-200'}">{label}</div>
        <div class="mt-0.5 text-[9px] text-[#87918b]">
          {side?.armyIds.length ?? 0}
          {(side?.armyIds.length ?? 0) === 1 ? 'formation' : 'formations'} · {side?.userIds.length ?? 0}
          {(side?.userIds.length ?? 0) === 1 ? 'commander' : 'commanders'}
        </div>
      </div>
      {#if yourSide}<span class="border border-amber-200/20 bg-amber-200/[0.07] px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.08em] text-amber-100">Your side</span>{/if}
    </div>

    <div class="grid grid-cols-2 gap-px border-b border-white/[0.08] bg-white/[0.06]">
      <div class="bg-[#1d292b] px-3 py-2">
        <div class="text-[8px] uppercase tracking-[0.08em] text-[#75817b]">{concealedStrength ? 'Known units' : 'Units'}</div>
        <strong class="mt-0.5 block text-lg tabular-nums text-[#edf0e6]">{exactArmies.length ? knownUnits.toLocaleString() : 'Unknown'}</strong>
      </div>
      <div class="bg-[#1d292b] px-3 py-2">
        <div class="text-[8px] uppercase tracking-[0.08em] text-[#75817b]">{concealedStrength ? 'Known personnel' : 'Personnel'}</div>
        <strong class="mt-0.5 block text-lg tabular-nums text-[#edf0e6]">{exactArmies.length ? knownPersonnel.toLocaleString() : 'Unknown'}</strong>
      </div>
    </div>

    {#if side?.militiaCount}
      <div class="border-b border-white/[0.08] bg-amber-200/[0.04] px-3 py-2 text-[10px]">
        <span class="text-[#8e9891]">Settlement militia</span>
        <strong class="float-right tabular-nums text-amber-100">{side.militiaCount.toLocaleString()}</strong>
      </div>
    {/if}

    <div class="space-y-1.5 p-2.5">
      {#each side?.armyIds ?? [] as armyId}
        {@const army = sideArmies.find((candidate) => candidate.armyId?.value === armyId.value)}
        {#if army}
          <div class="border border-white/[0.08] bg-black/[0.1] px-2.5 py-2">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <strong class="block truncate text-[11px] text-[#e8ece5]">{armyTitle(army)}</strong>
                <span class="mt-0.5 block text-[8px] uppercase tracking-[0.08em] {army.owner?.value === $userId ? 'text-blue-200' : 'text-[#79857f]'}">
                  {army.owner?.value === $userId ? 'Your army' : 'Foreign army'}
                </span>
              </div>
              <div class="shrink-0 text-right">
                <strong class="block text-sm tabular-nums text-[#f2eee0]">{army.compositionVisibility === ArmyCompositionVisibility.EXACT ? armySize(army).toLocaleString() : '?'}</strong>
                <span class="text-[8px] uppercase tracking-wide text-[#68736d]">units</span>
              </div>
            </div>
            {#if army.compositionVisibility !== ArmyCompositionVisibility.HIDDEN}
              <div class="mt-2 flex flex-wrap gap-1 border-t border-white/[0.06] pt-1.5">
                {#each army.troops.filter((stack) => (stack.count ?? 1) > 0) as stack}
                  <span class="border border-white/[0.08] bg-white/[0.035] px-1.5 py-0.5 text-[8px] text-[#9fa9a3]">
                    {army.compositionVisibility === ArmyCompositionVisibility.EXACT ? `${stack.count} ` : ''}{troopName(stack.type, stack.count)}
                  </span>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <div class="border border-dashed border-white/[0.1] px-2.5 py-3 text-center text-[9px] text-[#69746e]">Formation details concealed</div>
        {/if}
      {:else}
        <div class="px-2.5 py-5 text-center text-[9px] text-[#69746e]">No field armies disclosed</div>
      {/each}
    </div>
  </section>
{/snippet}

<div class="game-ui relative h-screen w-screen overflow-hidden bg-[#0e110f]">
  <!-- Canvas -->
  <div bind:this={el} class="absolute inset-0 {drag ? 'cursor-map-drag' : moveConfirmationPending ? 'cursor-army-confirm' : moveArmyId ? 'cursor-army-move' : 'cursor-map-pan'}"></div>

  <!-- Separate HUD clusters keep the map from feeling boxed in by one navbar. -->
  <div class="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-2 sm:inset-x-4 sm:top-4">
    <div class="hud-surface pointer-events-auto flex h-12 min-w-10 items-center">
      <div class="flex min-w-0 items-center gap-2.5 px-3">
        <span class="h-2 w-2 shrink-0 rounded-sm bg-emerald-400"></span>
        <span class="hidden max-w-32 truncate text-xs font-medium text-[#d5dbd6] sm:block">{$username}</span>
      </div>
      <button
        class="flex h-12 w-10 items-center justify-center border-l border-white/[0.08] text-[#778078] transition-colors hover:text-white"
        title="Sign out"
        aria-label="Sign out"
        on:click={logout}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" class="h-4 w-4"
          ><path d="M8 4H5.5A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8M12.5 6.5L16 10l-3.5 3.5M8 10h8" stroke-linecap="round" stroke-linejoin="round" /></svg
        >
      </button>
    </div>

    <!-- Resources (hover for per-hour rates, click to pin) -->
    <div class="hud-surface group pointer-events-auto absolute left-1/2 -translate-x-1/2" bind:this={ratesEl}>
      <button type="button" class="flex h-12 items-center text-left" on:click={() => (ratesOpen = !ratesOpen)} aria-expanded={ratesOpen} aria-label="Treasury and food stores">
        <span class="resource-counter">
          <span class="resource-medallion text-[#d9bd58]">{@render resourceGlyph('gold')}</span>
          <span class="leading-none">
            <strong class="block text-[13px] font-bold tabular-nums text-[#f5e5a4] sm:text-[15px]">{$gold.toLocaleString()}</strong>
            <span class="resource-rate text-[#c7aa58]">{fmtPerHour(goldPerHour)}/hr</span>
          </span>
        </span>
        <span class="h-8 w-px bg-[#52666c]"></span>
        <span class="resource-counter">
          <span class="resource-medallion text-[#afc778]">{@render resourceGlyph('food')}</span>
          <span class="leading-none">
            <strong class="block text-[13px] font-bold tabular-nums text-[#e5ddad] sm:text-[15px]">{$food.toLocaleString()}</strong>
            <span class="resource-rate {netFoodPerHour < 0 ? 'text-red-300' : 'text-[#a9bd77]'}">{fmtPerHour(netFoodPerHour)}/hr</span>
          </span>
        </span>
      </button>
      <div
        class="pointer-events-none absolute left-1/2 top-full w-56 -translate-x-1/2 pt-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 {ratesOpen
          ? 'opacity-100'
          : ''}"
      >
        <div class="game-popover p-3">
          <div class="inspector-label mb-2">Realm stores</div>
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

    <div class="hud-surface pointer-events-auto ml-auto flex h-10 items-stretch overflow-visible">
      {#each [['armies', ownedArmies.length], ['cities', ownedCities.length], ['training', queuedTrainingCount], ['inbox', unreadMailboxCount]] as [tab, count]}
        <button
          type="button"
          class="hud-tool {managementOpen && managementTab === tab ? 'hud-tool-active' : ''}"
          on:click={() => toggleManagementTab(tab as typeof managementTab)}
          aria-label={`${tab === 'armies' ? 'Armies' : tab === 'cities' ? 'Cities' : tab === 'training' ? 'Training' : 'Inbox'}: ${count}`}
          aria-expanded={managementOpen && managementTab === tab}
        >
          {@render managementGlyph(tab as typeof managementTab)}
          <span class="hud-count">{count}</span>
          <span class="hud-tooltip">{tab === 'armies' ? 'Armies' : tab === 'cities' ? 'Cities' : tab === 'training' ? 'Training' : 'Inbox'} · {count}</span>
        </button>
      {/each}
    </div>
  </div>

  {#if managementOpen}
    <aside
      class="game-popover pointer-events-auto absolute bottom-20 right-3 top-20 z-10 flex w-[min(21rem,calc(100vw-1.5rem))] flex-col overflow-hidden sm:right-4"
      transition:fly={{ x: 18, duration: 180 }}
    >
      <div class="border-b border-white/[0.08] px-3 pb-2 pt-3">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-sm font-bold text-[#e9e4cc]">{managementTab === 'armies' ? 'Armies' : managementTab === 'cities' ? 'Cities' : managementTab === 'training' ? 'Training' : 'Inbox'}</div>
            <div class="mt-0.5 text-[10px] text-[#858578]">
              {managementTab === 'armies'
                ? `${ownedArmyTroops.toLocaleString()} units · ${ownedOrderCount} active`
                : managementTab === 'cities'
                  ? `${ownedCities.length} settlements under your rule`
                  : managementTab === 'training'
                    ? queuedTrainingCount
                      ? `${queuedTrainingCount} ${queuedTrainingCount === 1 ? 'batch' : 'batches'} in training`
                      : 'Barracks ready'
                    : unreadMailboxCount
                      ? `${unreadMailboxCount} unread ${unreadMailboxCount === 1 ? 'message' : 'messages'}`
                      : `${sortedMailboxMessages.length} archived ${sortedMailboxMessages.length === 1 ? 'message' : 'messages'}`}
            </div>
          </div>
          <button class="flex h-7 w-7 items-center justify-center text-[#788179] transition-colors hover:text-white" aria-label="Close command panel" on:click={() => (managementOpen = false)}
            >×</button
          >
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-2">
        {#if managementTab === 'armies'}
          <div class="flex items-center justify-between px-1 pb-2 text-[10px] text-[#778078]">
            <span>{ownedArmies.length ? `${ownedArmyTroops.toLocaleString()} troops under command` : 'No field armies'}</span>
            <span>{ownedOrderCount} active</span>
          </div>
          {#each ownedArmies as army}
            {@const order = orderForArmy(army)}
            {@const intent = orderIntent(order)}
            {@const destination = orderDestination(order)}
            {@const endpoint = order?.remainingRoute?.hiddenSegmentEnd ?? order?.remainingRoute?.knownSteps.at(-1)?.coords}
            {@const partial = destination && endpoint && (destination.x !== endpoint.x || destination.y !== endpoint.y)}
            <button
              class="mb-1.5 w-full border px-3 py-2.5 text-left transition-colors {army.armyId?.value === selectedArmyId
                ? 'border-blue-300/30 bg-blue-300/[0.09]'
                : 'border-white/[0.07] bg-black/[0.08] hover:border-white/[0.14] hover:bg-white/[0.04]'}"
              on:click={() => focusArmy(army)}
            >
              <div class="flex items-center justify-between gap-3">
                <span class="truncate text-xs font-semibold text-[#dce1dc]">{armyTitle(army)}</span>
                <span class="text-xs font-semibold tabular-nums text-blue-200">{armySize(army).toLocaleString()}</span>
              </div>
              <div class="mt-1 flex items-center justify-between gap-3 text-[10px] text-[#79827b]">
                <span>Tile {army.coords?.x ?? '—'}, {army.coords?.y ?? '—'}</span>
                {#if order}
                  <span class="border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] {orderToneSurface(intent)} {orderToneText(intent)}">{orderLabel(order)}</span>
                {:else}<span>{army.orderId ? 'Order details restricted' : 'Holding'}</span>{/if}
              </div>
              {#if order}
                <div class="mt-2 border-t border-white/[0.06] pt-2 text-[10px]">
                  <div class="truncate font-semibold {orderToneText(intent)}">{orderStatus(order, !!army.battleId)}</div>
                  <div class="mt-1 flex items-center justify-between gap-3 text-[9px] text-[#7f8982]">
                    <span>{partial ? 'Best known approach' : `${order.remainingRoute?.knownSteps.length ?? 0} route tiles${order.remainingRoute?.hiddenSegmentEnd ? ' · through fog' : ''}`}</span>
                    {#if order.estimatedRemainingDuration}<span class="tabular-nums text-[#9ba49d]">~{fmtCountdown(durationSeconds(order.estimatedRemainingDuration) * 1000)}</span>{/if}
                  </div>
                </div>
              {/if}
            </button>
          {:else}
            <div class="px-3 py-8 text-center text-[11px] leading-relaxed text-[#737c75]">Train troops at a barracks to create an army.</div>
          {/each}
        {:else if managementTab === 'cities'}
          {#each ownedCities as city}
            {@const prod = cityProd(city)}
            {@const foodNet = ratePerHour(city.netFoodFlow)}
            <button
              class="mb-1.5 w-full border border-white/[0.07] bg-black/[0.08] px-3 py-2.5 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.04]"
              on:click={() => centerOnCity(city)}
            >
              <div class="flex items-center gap-2">
                <span class="h-1.5 w-1.5 {city.starving ? 'animate-pulse bg-red-400' : 'bg-emerald-400'}"></span>
                <span class="min-w-0 flex-1 truncate text-xs font-semibold text-[#dce1dc]">{city.name}</span>
                <span class="text-[10px] tabular-nums text-[#89928b]">{residents(city).toLocaleString()} residents</span>
              </div>
              <div class="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 border-t border-white/[0.06] pt-2 text-[10px] tabular-nums">
                <span class="text-amber-200/80">{Math.round(prod.gold + ratePerHour(city.taxIncome)).toLocaleString()} gold/hr</span>
                <span class={foodNet < 0 ? 'text-red-400' : 'text-emerald-300/80'}>{fmtPerHour(foodNet)} food/hr</span>
                <span class="text-blue-200/80">{trainablePopulation(city).toLocaleString()} recruitable</span>
                <span class="text-[#929c96]">{militiaPopulation(city).toLocaleString()} militia</span>
              </div>
            </button>
          {/each}
        {:else if managementTab === 'training'}
          <div class="flex items-center justify-between px-1 pb-2 text-[10px] text-[#778078]">
            <span>{ownedBarracks.length} {ownedBarracks.length === 1 ? 'barracks' : 'barracks'}</span>
            {#if trainingOverviewLoading}<span>Refreshing…</span>{/if}
          </div>
          {#each ownedBarracks as barracks}
            {@const queue = currentTrainingQueue(trainingQueues.get(barracks.buildingId?.value ?? '') ?? [])}
            {@const committedPopulation = queuePopulationCost(queue)}
            {@const active = queue[0]}
            {@const startsAt = timestampMs(active?.startedAt)}
            {@const completesAt = timestampMs(active?.completesAt)}
            {@const activeProgress = active && startsAt > 0 && completesAt > startsAt ? Math.max(0, Math.min(100, ((now - startsAt) / (completesAt - startsAt)) * 100)) : 0}
            <button
              class="mb-1.5 w-full border border-white/[0.07] bg-black/[0.08] px-3 py-2.5 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.04]"
              on:click={() => focusBuilding(barracks)}
            >
              <div class="flex items-center justify-between gap-3">
                <span class="text-xs font-semibold text-[#dce1dc]">Barracks · level {barracks.level}</span>
                <span class="text-[10px] text-[#879089]">{queue.length ? `${queue.length} ${queue.length === 1 ? 'batch' : 'batches'}` : 'Ready'}</span>
              </div>
              <div class="mt-1 text-[10px] text-[#7b847d]">Tile {barracks.coords?.x ?? '—'}, {barracks.coords?.y ?? '—'}</div>
              {#if active}
                <div class="mt-2 border-t border-white/[0.06] pt-2">
                  <div class="flex items-center justify-between gap-3 text-[10px]">
                    <span class="flex items-center gap-2 text-blue-200/80">
                      <span class="training-order-icon">{@render troopGlyph(active.type)}</span>
                      Training {active.count}
                      {troopName(active.type, active.count)}
                    </span>
                    <span class="tabular-nums text-[#9ba49d]">{completesAt ? fmtCountdown(completesAt - now) : 'Waiting'}</span>
                  </div>
                  {#if completesAt > startsAt}
                    <div class="mt-2 h-0.5 overflow-hidden bg-white/[0.07]">
                      <div class="h-full bg-blue-300/80 transition-[width] duration-500" style={`width: ${activeProgress}%`}></div>
                    </div>
                  {/if}
                  {#if queue.length > 1}
                    <div class="mt-1.5 text-[9px] tabular-nums text-[#707971]">+{queue.length - 1} {queue.length === 2 ? 'batch' : 'batches'} waiting</div>
                  {/if}
                  <div class="mt-1 text-[9px] tabular-nums text-blue-200/60">
                    {committedPopulation.toLocaleString()}
                    {committedPopulation === 1 ? 'resident' : 'residents'} already mobilized
                  </div>
                </div>
              {:else}
                <div class="mt-2 border-t border-white/[0.06] pt-2 text-[10px] text-[#68716a]">Ready · select to train troops</div>
              {/if}
            </button>
          {:else}
            <div class="px-3 py-8 text-center text-[11px] leading-relaxed text-[#737c75]">Build a barracks in one of your cities to train troops.</div>
          {/each}
        {:else}
          <div class="flex items-center justify-between px-1 pb-2 text-[10px] text-[#778078]">
            <span>{sortedMailboxMessages.length} {sortedMailboxMessages.length === 1 ? 'message' : 'messages'}</span>
            <span>{unreadMailboxCount} unread</span>
          </div>
          {#each sortedMailboxMessages as message}
            {@const report = message.content.case === 'battleReport' ? message.content.value : undefined}
            <div class="mb-1.5 border {message.readAt ? 'border-white/[0.07] bg-black/[0.08]' : 'border-amber-200/20 bg-amber-200/[0.045]'}">
              <button class="w-full px-3 py-2.5 text-left" on:click={() => openMailboxMessage(message)} aria-haspopup="dialog">
                <div class="flex items-start gap-2.5">
                  <span class="mt-1 h-1.5 w-1.5 shrink-0 {message.readAt ? 'bg-[#59635d]' : 'bg-amber-300'}"></span>
                  <div class="min-w-0 flex-1">
                    {#if report}
                      <div class="flex items-center justify-between gap-2">
                        <strong
                          class="truncate text-[11px] {report.outcome === BattleReportOutcome.VICTORY
                            ? 'text-emerald-200'
                            : report.outcome === BattleReportOutcome.DEFEAT
                              ? 'text-red-200'
                              : 'text-amber-100'}"
                        >
                          {reportOutcomeLabel(report.outcome)} · {report.engagement === BattleReportEngagement.SETTLEMENT_SIEGE ? 'Siege report' : 'Battle report'}
                        </strong>
                        <span class="shrink-0 text-[8px] uppercase tracking-wide text-[#7b857e]">{reportRoleLabel(report.role)}</span>
                      </div>
                      <div class="mt-1 text-[9px] text-[#838d86]">
                        Tile {report.tileId?.x ?? '—'}, {report.tileId?.y ?? '—'} · {report.rounds.length} combat {report.rounds.length === 1 ? 'round' : 'rounds'}
                      </div>
                    {:else}
                      <strong class="text-[11px] text-[#dce1dc]">System message</strong>
                    {/if}
                    <div class="mt-1 text-[8px] text-[#626d66]">{reportDate(message.createdAt)}</div>
                  </div>
                  <span class="text-[#68736d]">›</span>
                </div>
              </button>
            </div>
          {:else}
            <div class="px-3 py-8 text-center text-[11px] leading-relaxed text-[#737c75]">Your inbox is empty. Battle reports and future realm notices will be archived here.</div>
          {/each}
        {/if}
      </div>
    </aside>
  {/if}

  {#if selectedMailboxMessage}
    {@const report = selectedMailboxMessage.content.case === 'battleReport' ? selectedMailboxMessage.content.value : undefined}
    <div
      class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-3 sm:p-8"
      on:pointerdown|self={() => (selectedMailboxMessageId = null)}
      transition:fade={{ duration: 140 }}
    >
      <div class="mail-dialog inspector-panel" role="dialog" aria-modal="true" aria-label={report ? `${reportOutcomeLabel(report.outcome)} battle report` : 'Mailbox message'}>
        <header class="mail-dialog-header">
          <span class="selection-crest h-10 w-10 text-amber-100" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
              <path d="M3 6h18v13H3V6Z" /><path d="m4 7 8 7 8-7" />
            </svg>
          </span>
          <div class="min-w-0 flex-1">
            {#if report}
              <div class="text-[9px] font-bold uppercase tracking-[0.14em] text-[#c3b77d]">
                {report.engagement === BattleReportEngagement.SETTLEMENT_SIEGE ? 'Siege report' : 'Battle report'} · {reportRoleLabel(report.role)}
              </div>
              <h2
                class="mt-0.5 truncate text-lg font-bold {report.outcome === BattleReportOutcome.VICTORY
                  ? 'text-emerald-200'
                  : report.outcome === BattleReportOutcome.DEFEAT
                    ? 'text-red-200'
                    : 'text-amber-100'}"
              >
                {reportOutcomeLabel(report.outcome)} at tile {report.tileId?.x ?? '—'}, {report.tileId?.y ?? '—'}
              </h2>
            {:else}
              <div class="text-[9px] font-bold uppercase tracking-[0.14em] text-[#c3b77d]">Realm dispatch</div>
              <h2 class="mt-0.5 text-lg font-bold text-[#edf1e8]">System message</h2>
            {/if}
            <div class="mt-0.5 text-[9px] text-[#8a958e]">Received {reportDate(selectedMailboxMessage.createdAt)}</div>
          </div>
          <button class="battle-dialog-close" aria-label="Close message" on:click={() => (selectedMailboxMessageId = null)}>×</button>
        </header>

        <div class="mail-dialog-body">
          {#if report}
            <div class="grid grid-cols-2 gap-px bg-white/[0.06] text-[9px] sm:grid-cols-4">
              <div class="bg-[#1c282a] p-3">
                <span class="block uppercase tracking-wide text-[#68756e]">Resolution</span><strong class="mt-1 block text-[11px] text-[#dfe4dc]">{reportResolutionLabel(report.resolution)}</strong>
              </div>
              <div class="bg-[#1c282a] p-3">
                <span class="block uppercase tracking-wide text-[#68756e]">Duration</span><strong class="mt-1 block text-[11px] text-[#dfe4dc]">{fmtCountdown(reportDuration(report))}</strong>
              </div>
              <div class="bg-[#1c282a] p-3">
                <span class="block uppercase tracking-wide text-[#68756e]">Started</span><strong class="mt-1 block text-[10px] text-[#bdc6be]">{reportDate(report.startedAt)}</strong>
              </div>
              <div class="bg-[#1c282a] p-3">
                <span class="block uppercase tracking-wide text-[#68756e]">Ended</span><strong class="mt-1 block text-[10px] text-[#bdc6be]">{reportDate(report.endedAt)}</strong>
              </div>
            </div>
            <div class="grid gap-3 p-3 md:grid-cols-2">
              {@render reportSideRecord('Attackers', report.attackers, true)}
              {@render reportSideRecord('Defenders', report.defenders, false)}
            </div>
            <section class="mx-3 mb-3 border border-white/[0.09] bg-black/[0.1]">
              <div class="border-b border-white/[0.07] px-3 py-2 text-[9px] font-bold uppercase tracking-[0.1em] text-[#aab5ad]">Round log</div>
              <div class="divide-y divide-white/[0.06]">
                {#each report.rounds as round}
                  <div class="px-3 py-2.5">
                    <div class="flex items-center justify-between gap-2 text-[9px]">
                      <strong class="text-[#d6ded7]">Round {round.number}</strong>
                      <span class="text-[#69756e]">{reportDate(round.occurredAt)}</span>
                    </div>
                    <div class="mt-1 grid grid-cols-2 gap-3 text-[9px] tabular-nums">
                      <span class="text-red-200/80">Attack power {Math.round(round.attackerPower).toLocaleString()} · {reportLossTotal(round.attackerLosses)} lost</span>
                      <span class="text-right text-blue-200/80">Defense power {Math.round(round.defenderPower).toLocaleString()} · {reportLossTotal(round.defenderLosses)} lost</span>
                    </div>
                    {@render reportRoundLosses(round.attackerLosses)}
                    {@render reportRoundLosses(round.defenderLosses)}
                  </div>
                {:else}
                  <div class="px-3 py-4 text-center text-[9px] text-[#68736d]">Resolved before the first combat exchange.</div>
                {/each}
              </div>
            </section>
          {:else}
            <div class="px-5 py-10 text-center text-sm text-[#858f88]">This dispatch has no additional details.</div>
          {/if}
        </div>

        <footer class="mail-dialog-footer">
          <span>{report ? `Report ${shortId(report.battleId?.value)} · permanently archived` : 'Permanently archived'}</span>
          <div class="flex gap-2">
            <button class="game-action game-action-secondary !w-auto" on:click={() => (selectedMailboxMessageId = null)}>Close</button>
            {#if report}<button class="game-action game-action-primary !w-auto" on:click={() => focusBattleReport(report)}>Center battle site</button>{/if}
          </div>
        </footer>
      </div>
    </div>
  {/if}

  <!-- Tile selection stays compact; city management expands explicitly into a focused dialog. -->
  <div
    class={showCityManagement && sel?.city && !selectedArmy
      ? 'pointer-events-auto absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-3 sm:p-8'
      : `pointer-events-none absolute bottom-3 left-1/2 z-10 w-[calc(100vw-1.5rem)] max-w-[800px] -translate-x-1/2 sm:bottom-4 ${
          !selectedArmy && !sel?.armies?.length && !showBuild ? 'sm:max-w-[460px]' : ''
        } ${managementOpen ? 'lg:left-4 lg:right-[22rem] lg:mx-auto lg:w-[calc(100%-23rem)] lg:translate-x-0' : ''}`}
    on:pointerdown|self={() => {
      if (showCityManagement && sel?.city && !selectedArmy) showCityManagement = false;
    }}
  >
    {#if sel}
      {@const selectedVisibility = visibilityAt(sel.x, sel.y)}
      {@const selectedUnknown = selectedVisibility === TileVisibilityState.UNEXPLORED}
      {@const selectedTerrain = selectedUnknown ? { name: 'Unexplored', note: 'Terrain has not been surveyed.' } : terrainInfo(terrainAt(sel.x, sel.y))}
      {@const selectedSettlementCenter = isSettlementCenter(sel.building)}
      <div
        class="inspector-panel pointer-events-auto {showCityManagement && sel.city && !selectedArmy ? 'city-dialog' : ''}"
        role={showCityManagement && sel.city && !selectedArmy ? 'dialog' : undefined}
        aria-modal={showCityManagement && sel.city && !selectedArmy ? 'true' : undefined}
        aria-label={showCityManagement && sel.city && !selectedArmy
          ? cityManagementView === 'building' && sel.building
            ? `${bName(sel.building.type)} management`
            : sel.city.owner?.value === $userId
              ? `${sel.city.name} management`
              : `${sel.city.name} details`
          : undefined}
        transition:fly={{ y: 16, duration: 180 }}
      >
        <div class="inspector-header flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="selection-crest">
              {#if selectedArmy || sel.armies?.length}
                {@render managementGlyph('armies')}
              {:else if sel.building}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
                  <path d="M4 20V10l8-6 8 6v10M2 20h20M9 20v-7h6v7" />
                </svg>
              {:else if sel.city}
                {@render managementGlyph('cities')}
              {:else}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m12 4 9 8-9 8-9-8 9-8Z" /></svg>
              {/if}
            </span>
            <div class="min-w-0">
              <h2 class="truncate text-[14px] font-bold text-[#eef4f2]">
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
                <div class="mt-0.5 flex flex-wrap items-center gap-x-1 text-[10px] text-[#aaa997]">
                  <span class={selectedArmy.owner?.value === $userId ? 'font-medium text-blue-200' : 'font-medium text-red-200'}
                    >{selectedArmy.owner?.value === $userId ? 'Your army' : 'Foreign army'}</span
                  >
                  · Tile {sel.x}, {sel.y}
                </div>
              {:else}
                <div class="mt-0.5 flex min-w-0 items-center gap-x-1 truncate text-[10px] text-[#aaa997]">
                  {#if sel.city}{showCityManagement
                      ? cityManagementView === 'building'
                        ? 'Building Management'
                        : sel.city.owner?.value === $userId
                          ? `${cName(sel.city.type)} Management`
                          : `${cName(sel.city.type)} Details`
                      : cName(sel.city.type)} ·
                  {/if}<span class="font-medium text-[#d8e4e2]">{selectedTerrain.name}</span> · Tile {sel.x}, {sel.y}
                  <span class="hidden text-[#828275] md:inline">· {selectedTerrain.note}</span>
                </div>
              {/if}
            </div>
          </div>
          <button
            aria-label="Close"
            class="flex h-7 w-7 shrink-0 items-center justify-center border border-white/[0.12] text-[#c6c8bb] transition-colors duration-150 hover:border-white/30 hover:text-white"
            on:click={() => (showCityManagement ? (showCityManagement = false) : deselect())}
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
          {@const includesUnknown = !!moveHiddenSegmentEnd}
          {@const activeMoveOrder = moveOrderActive ? orderForArmy(movingArmy) : undefined}
          {@const currentIntent = activeMoveOrder ? orderIntent(activeMoveOrder) : moveOrderIntent}
          {@const currentOrderStatus = activeMoveOrder
            ? orderStatus(activeMoveOrder, !!movingArmy.battleId)
            : previewTarget
              ? previewOrderStatus(currentIntent, previewTarget)
              : 'Choose a destination'}
          <div class="flex flex-wrap items-center gap-2.5 border-b px-3 py-1.5 {orderToneSurface(currentIntent)}">
            <span class="selection-crest h-7 w-7 {orderToneText(currentIntent)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                {#if currentIntent === 'attack'}
                  <path d="m5 19 4-1 10-10-3-3L6 15l-1 4ZM13 6l5 5M5 5l14 14" />
                {:else if currentIntent === 'siege'}
                  <path d="M5 20V9h14v11M3 20h18M7 9V5h3v4M14 9V5h3v4M10 20v-6h4v6" />
                {:else if currentIntent === 'retreat'}
                  <path d="M20 7H9a5 5 0 0 0 0 10h8M8 3 4 7l4 4" />
                {:else}
                  <circle cx="5" cy="18" r="2" /><circle cx="19" cy="6" r="2" /><path d="M7 18c7 0 3-12 10-12M13 4l4 2-2 4" />
                {/if}
              </svg>
            </span>
            <div class="min-w-0 flex-1">
              <div class="text-[11px] font-bold {previewTarget && !moveRoute && !moveRouteLoading ? 'text-red-200' : orderToneText(currentIntent)}">
                {busy
                  ? `Issuing ${intentLabel(currentIntent).toLowerCase()} order…`
                  : moveRouteLoading
                    ? `Plotting ${intentLabel(currentIntent).toLowerCase()} route…`
                    : moveConfirmationPending && previewTarget
                      ? `Confirm: ${currentOrderStatus}`
                      : previewTarget && !moveRoute
                        ? moveRouteError || 'Route unavailable'
                        : currentOrderStatus}
              </div>
              <div class="mt-0.5 truncate text-[9px] text-[#969d98]">
                {moveConfirmationPending && previewTarget
                  ? moveRouteLoading
                    ? 'Wait for the route, then right-click again'
                    : `${moveRoute ? `${steps} known ${steps === 1 ? 'step' : 'steps'} · ~${fmtCountdown(moveRouteDurationMs)}${includesUnknown ? ' · continues through fog' : ''}` : 'Route unavailable'} · right-click again`
                  : previewTarget
                    ? moveRouteLoading
                      ? 'Reading known terrain'
                      : moveRoute
                        ? `${steps} known ${steps === 1 ? 'step' : 'steps'}${moveOrderActive ? ' remaining' : ''} · ~${fmtCountdown(moveRouteDurationMs)}${includesUnknown ? ' · through fog' : ''}${!moveRouteComplete ? ' · nearest known land' : ''}`
                        : moveRouteError
                          ? 'Right-click to let the server judge the route'
                          : 'Land armies cannot cross water'
                    : 'Hover to inspect · right-click to choose an order target'}
              </div>
            </div>
            <span class="text-[9px] text-[#7e7f72]">{moveOrderActive ? 'Esc hide' : 'Esc cancel'}</span>
          </div>
        {/if}

        <div class="inspector-body">
          {#if sel.building && !selectedArmy && !showCityManagement}
            {@const compactConstructionStart = timestampMs(sel.building.constructionStart)}
            {@const compactConstructionEnd = timestampMs(sel.building.constructionEnd)}
            {@const compactConstructionActive = compactConstructionStart > 0 && compactConstructionEnd > compactConstructionStart && compactConstructionEnd > now}
            {@const compactConstructing = sel.building.level === 0}
            {@const compactConstructionVisible = compactConstructionActive || (compactConstructing && compactConstructionEnd > 0)}
            {@const compactConstructionProgress =
              compactConstructionEnd > compactConstructionStart ? Math.max(0, Math.min(100, ((now - compactConstructionStart) / (compactConstructionEnd - compactConstructionStart)) * 100)) : 0}
            <section class="inspector-section">
              <div class="flex items-center gap-2.5">
                {@render structureGlyph(sel.building.type, Math.max(1, sel.building.level))}
                <div class="min-w-0 flex-1">
                  <div class="inspector-stat-label">Building level</div>
                  <strong class="mt-0.5 block truncate text-[13px] font-semibold text-[#edf2ef]">
                    {compactConstructing
                      ? `Level ${sel.building.targetLevel || 1} planned`
                      : compactConstructionActive
                        ? `Level ${sel.building.level} → ${sel.building.targetLevel || sel.building.level + 1}`
                        : `Level ${sel.building.level}`}
                  </strong>
                  <span class="mt-0.5 block text-[9px] {compactConstructionVisible ? 'text-amber-200/80' : 'text-emerald-200/70'}">
                    {compactConstructing ? 'Under construction' : compactConstructionActive ? 'Upgrade in progress' : 'Operational'}
                  </span>
                </div>
              </div>
              {#if compactConstructionVisible}
                <div class="mt-2.5 border-t border-white/[0.07] pt-2">
                  <div class="flex items-center justify-between gap-3 text-[9px]">
                    <span class="text-[#87938c]">{compactConstructing ? 'Construction' : `Upgrade to level ${sel.building.targetLevel}`}</span>
                    <strong class="tabular-nums text-amber-100">{compactConstructionEnd > now ? fmtCountdown(compactConstructionEnd - now) : 'Completing'}</strong>
                  </div>
                  <div class="mt-1.5 h-1 overflow-hidden bg-white/[0.08]">
                    <div class="h-full bg-amber-300 transition-[width] duration-500" style={`width: ${compactConstructionProgress}%`}></div>
                  </div>
                </div>
              {/if}
            </section>
            <div class="inspector-actions">
              <button class="game-action game-action-primary" on:click={openSelectedManagement}>
                {#if selectedSettlementCenter}
                  {@render managementGlyph('cities')}
                  {sel.city?.owner?.value === $userId ? `${sel.building.type === BuildingType.TOWN_CENTER ? 'Town' : 'City'} Management` : 'View details'}
                {:else}
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    <path d="M3 5h14M3 10h14M3 15h14" />
                    <circle cx="7" cy="5" r="1.7" fill="currentColor" /><circle cx="13" cy="10" r="1.7" fill="currentColor" /><circle cx="8" cy="15" r="1.7" fill="currentColor" />
                  </svg>
                  Manage {bName(sel.building.type)}
                {/if}
              </button>
            </div>
          {:else if selectedArmy}
            {@const selectedArmyOwned = selectedArmy.owner?.value === $userId}
            {@const selectedArmySize = armySize(selectedArmy)}
            {@const selectedArmyPersonnel = armyPersonnel(selectedArmy)}
            {@const selectedArmyUpkeep = armyFoodUpkeep(selectedArmy)}
            {@const selectedIntent = orderIntent(selectedOrder)}
            {@const selectedStack = sel.armies?.filter((army) => army.owner?.value === $userId) ?? []}
            {@const selectedTroops = selectedArmy.troops.filter((stack) => (stack.count ?? 1) > 0)}
            <section class="inspector-section">
              <div class="grid grid-cols-[auto_repeat(4,minmax(0,1fr))] items-center gap-3">
                {#if selectedArmy.compositionVisibility !== ArmyCompositionVisibility.HIDDEN && selectedTroops[0]}
                  {@render troopGlyph(selectedTroops[0].type)}
                {:else}
                  <span class="unit-token text-lg">?</span>
                {/if}
                <div>
                  <div class="inspector-stat-label">Units</div>
                  <div class="inspector-stat-value">
                    {selectedArmy.compositionVisibility === ArmyCompositionVisibility.EXACT ? selectedArmySize.toLocaleString() : 'Unknown'}
                  </div>
                </div>
                <div>
                  <div class="inspector-stat-label">Personnel</div>
                  <div class="inspector-stat-value">
                    {selectedArmy.compositionVisibility === ArmyCompositionVisibility.EXACT ? selectedArmyPersonnel.toLocaleString() : 'Unknown'}
                  </div>
                </div>
                <div>
                  <div class="inspector-stat-label">Tile</div>
                  <div class="inspector-stat-value">{selectedArmy.coords?.x ?? '—'}, {selectedArmy.coords?.y ?? '—'}</div>
                </div>
                <div>
                  <div class="inspector-stat-label">Disposition</div>
                  <div class="mt-0.5 truncate text-[11px] font-semibold {selectedOrder ? orderToneText(selectedIntent) : selectedBattle ? 'text-red-200' : 'text-[#c2c2b2]'}">
                    {selectedBattle
                      ? selectedOrder
                        ? orderStatus(selectedOrder, true)
                        : 'Engaged in battle'
                      : selectedOrder
                        ? orderStatus(selectedOrder)
                        : selectedArmy.orderId
                          ? 'Order details restricted'
                          : 'Holding position'}
                  </div>
                </div>
              </div>
              {#if selectedOrder}
                {@const selectedDestination = orderDestination(selectedOrder)}
                <div class="mt-2.5 flex items-center gap-2.5 border px-2.5 py-2 {orderToneSurface(selectedIntent)}">
                  <span class="shrink-0 border border-white/20 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.11em] {orderToneText(selectedIntent)}">{orderLabel(selectedOrder)}</span>
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-[10px] font-semibold {orderToneText(selectedIntent)}">{orderStatus(selectedOrder, !!selectedBattle)}</div>
                    <div class="mt-0.5 text-[8px] text-[#849092]">
                      {selectedBattle
                        ? 'Combat is active'
                        : `${selectedOrder.remainingRoute?.knownSteps.length ?? 0} route tiles remaining${selectedOrder.remainingRoute?.hiddenSegmentEnd ? ' · continues through fog' : ''}`}
                    </div>
                  </div>
                  {#if selectedDestination}<span class="shrink-0 text-[9px] tabular-nums text-[#99a5a4]">{selectedDestination.x}, {selectedDestination.y}</span>{/if}
                </div>
              {/if}
              {#if selectedBattle}
                <div class="mt-2.5 flex items-center gap-3 border-t border-red-300/15 pt-2.5 text-[11px]">
                  <span class="font-semibold uppercase tracking-[0.12em] text-red-300">{selectedIntent === 'siege' ? 'Siege battle' : 'Battle in progress'}</span>
                  <span class="min-w-0 flex-1 truncate text-right text-[#aab2ac]">
                    {selectedBattle.attackers?.armyIds.length ?? 0} attacking · {selectedBattle.defenders?.armyIds.length ?? 0} defending{selectedBattle.defenders?.militiaCount
                      ? ` · ${selectedBattle.defenders.militiaCount} militia`
                      : ''}
                  </span>
                  <button
                    class="border border-red-300/25 bg-red-300/[0.08] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-red-100 hover:bg-red-300/[0.14]"
                    on:click={() => (showBattlePanel = true)}
                  >
                    Open battle
                  </button>
                </div>
              {/if}
              <div class="mt-2.5 border-t border-[#465a5f] pt-2.5">
                <div class="mb-1.5 flex items-center justify-between gap-3">
                  <div class="inspector-label">Ranks</div>
                  {#if selectedArmy.compositionVisibility === ArmyCompositionVisibility.EXACT}
                    <div class="text-[9px] tabular-nums text-red-300/70">-{selectedArmyUpkeep.toLocaleString()} food/hr upkeep</div>
                  {/if}
                </div>
                {#if selectedArmy.compositionVisibility === ArmyCompositionVisibility.HIDDEN}
                  <div class="text-[11px] text-[#747d76]">Composition has not been identified.</div>
                {:else}
                  <div class="flex flex-wrap gap-1.5">
                    {#each selectedTroops as stack}
                      <button
                        class="unit-chip text-left {splitCounts[stack.type] ? 'unit-chip-selected' : ''}"
                        disabled={!selectedArmyOwned || !!selectedArmy.battleId || selectedTroops.length <= 1}
                        aria-pressed={splitCounts[stack.type] ? 'true' : 'false'}
                        title={selectedArmyOwned && !selectedArmy.battleId && selectedTroops.length > 1 ? `Detach all ${troopName(stack.type, stack.count)}` : undefined}
                        on:click={() => selectSplitComposition(stack.type, stack.count ?? 0)}
                      >
                        {@render troopGlyph(stack.type)}
                        <span class="min-w-0 leading-tight">
                          <strong class="block text-[12px] font-bold tabular-nums text-[#f0edda]">{stack.count ?? '?'}</strong>
                          <span class="block truncate text-[9px] text-[#9d9c8d]">{troopName(stack.type, stack.count)}</span>
                        </span>
                      </button>
                    {/each}
                  </div>
                  {#if selectedArmyOwned && selectedTroops.length > 1 && !selectedArmy.battleId}
                    {#if showSplit}
                      {@const splitStack = selectedTroops.find((stack) => (splitCounts[stack.type] ?? 0) > 0)}
                      <div class="mt-2.5 flex items-center gap-3 border border-blue-200/20 bg-blue-200/[0.055] px-2.5 py-2">
                        <div class="min-w-0 flex-1">
                          {#if splitStack}
                            <strong class="block truncate text-[11px] text-blue-100">
                              {splitStack.count}
                              {troopName(splitStack.type, splitStack.count)} selected
                            </strong>
                            <span class="mt-0.5 block text-[9px] text-[#849497]">They will form a separate idle army on this tile. Choose another rank to change the selection.</span>
                          {:else}
                            <strong class="block text-[11px] text-blue-100">Choose one rank to detach</strong>
                            <span class="mt-0.5 block text-[9px] text-[#849497]">Only one complete troop composition can form the new army.</span>
                          {/if}
                        </div>
                        <button
                          class="game-action game-action-secondary !w-auto shrink-0"
                          on:click={() => {
                            showSplit = false;
                            splitCounts = {};
                          }}>Cancel</button
                        >
                        <button
                          class="game-action game-action-primary !w-auto shrink-0"
                          disabled={busy || !splitStack || splitTotal <= 0 || splitTotal >= selectedArmySize}
                          on:click={() => splitArmy(selectedArmy)}
                        >
                          {busy ? 'Detaching…' : splitStack ? `Detach ${splitStack.count}` : 'Detach'}
                        </button>
                      </div>
                    {:else}
                      <div class="mt-1.5 text-[9px] text-[#718184]">Select a rank to detach it as a separate army.</div>
                    {/if}
                  {/if}
                {/if}
              </div>
            </section>
            {#if selectedArmyOwned}
              <div class="inspector-actions">
                <button class="game-action game-action-primary" disabled={busy || (moveArmyId === selectedArmyId && !moveOrderActive)} on:click={() => prepareMove(selectedArmy)}>
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" class="h-3.5 w-3.5" aria-hidden="true"><path d="M3 16 16 3M9 3h7v7M4 8v8h8" /></svg>
                  {selectedOrder ? 'Issue different order' : 'Issue order'}
                </button>
                {#if selectedOrder || selectedBattle}
                  <button class="game-action game-action-secondary" disabled={busy} on:click={() => haltArmy(selectedArmy)}>
                    {#if selectedBattle}
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" class="h-3.5 w-3.5" aria-hidden="true"><path d="M16 10H4m0 0 4-4m-4 4 4 4" /></svg>
                      Retreat
                    {:else}
                      <svg viewBox="0 0 20 20" fill="currentColor" class="h-3 w-3" aria-hidden="true"><rect x="4" y="4" width="12" height="12" /></svg>
                      {cancelOrderLabel(selectedOrder)}
                    {/if}
                  </button>
                {/if}
                {#if selectedStack.length > 1}
                  <button
                    class="game-action game-action-secondary"
                    disabled={busy}
                    on:mouseenter={(event) =>
                      showGameTooltip(event, 'Combine armies', `The selected army remains. ${selectedStack.length - 1} other ${selectedStack.length - 1 === 1 ? 'army joins' : 'armies join'} it.`)}
                    on:mouseleave={hideGameTooltip}
                    on:focus={(event) =>
                      showGameTooltip(event, 'Combine armies', `The selected army remains. ${selectedStack.length - 1} other ${selectedStack.length - 1 === 1 ? 'army joins' : 'armies join'} it.`)}
                    on:blur={hideGameTooltip}
                    on:click={() => mergeOwnedArmies(selectedStack, selectedArmyId ?? undefined)}
                  >
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" class="h-3.5 w-3.5" aria-hidden="true"><path d="M3 5h4l3 5 3-5h4M3 15h4l3-5 3 5h4" /></svg>
                    Combine {selectedStack.length} armies
                  </button>
                  <div class="merge-note">{selectedStack.length} formations → this army</div>
                {/if}
                {#if selectedTroops.length > 1 && !selectedArmy.battleId}
                  <button
                    class="game-action game-action-secondary"
                    disabled={busy}
                    on:click={() => {
                      showSplit = !showSplit;
                      splitCounts = {};
                    }}
                  >
                    {showSplit ? 'Cancel detach' : 'Detach troops'}
                  </button>
                {/if}
                <div class="mt-0.5 border-t border-[#42555a] pt-1.5 text-center text-[9px] leading-relaxed text-[#7f9294]">Select the army, then right-click its destination.</div>
              </div>
            {/if}
          {/if}

          {#if !selectedArmy && sel.city && selectedSettlementCenter && showCityManagement && cityManagementView === 'city'}
            <section class="inspector-section">
              <div class="mb-2 flex items-center justify-between gap-3">
                <span class="inspector-label">City ledger</span>
                {#if sel.city.owner?.value === $userId}
                  <span class="flex items-center gap-1.5 text-xs font-medium text-blue-300"><span class="h-1.5 w-1.5 bg-blue-400"></span>Yours</span>
                {:else if sel.city.owner}
                  <span class="flex items-center gap-1.5 text-xs font-medium text-red-300"><span class="h-1.5 w-1.5 bg-red-400"></span>Foreign</span>
                {:else}
                  <span class="flex items-center gap-1.5 text-xs font-medium text-[#8c958e]"><span class="h-1.5 w-1.5 bg-[#788179]"></span>Neutral</span>
                {/if}
              </div>

              {#if demographicsKnown(sel.city)}
                <div class="inspector-row">
                  <span>Population trend</span>
                  <span class="text-[11px]">{@render popChip(ratePerHour(sel.city.populationGrowth))}</span>
                </div>

                {#if sel.city.starving}
                  <div class="mt-2 flex items-center gap-1.5 border border-red-300/15 bg-red-300/[0.05] px-2 py-1.5 text-[10px] text-red-300">
                    <span class="h-1.5 w-1.5 animate-pulse bg-red-400"></span>
                    Population is declining from insufficient local food.
                  </div>
                {/if}
              {:else}
                <div class="border border-white/[0.08] bg-black/[0.1] px-3 py-3">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#929d96]">Population and defenses</span>
                    <strong class="text-lg text-[#d7ddd7]">?</strong>
                  </div>
                  <p class="mt-1 text-[9px] leading-relaxed text-[#717c75]">
                    Exact residents, militia strength, growth, and economy are unknown until this settlement is under your control. Scouting can reveal this intelligence later.
                  </p>
                </div>
              {/if}

              <!-- Food economy is owner-only intel; non-owners receive these unset -->
              {#if sel.city.owner?.value === $userId}
                {@const policy = $gameConfig.populationPolicy}
                {@const minMilitia = policy?.minMilitiaPercent ?? 5}
                {@const maxMilitia = policy?.maxMilitiaPercent ?? 45}
                {@const maxTax = policy?.maxTaxRatePercent ?? 100}
                {@const militiaPolicyDirty = militiaTargetDraft !== sel.city.militiaTarget}
                {@const taxPolicyDirty = taxDraft !== sel.city.taxRatePercent}
                {@const policyDirty = militiaPolicyDirty || taxPolicyDirty}
                {@const previewTargetMilitia = militiaTargetDraft}
                {@const previewMilitia = militiaPolicyDirty
                  ? Math.min(previewTargetMilitia, Math.max(sel.city.militiaPopulation, sel.city.population - sel.city.corePopulationFloor, 0))
                  : sel.city.militiaPopulation}
                {@const previewTaxableRaw = Math.max(0, sel.city.population - previewMilitia)}
                {@const previewCore = Math.min(sel.city.corePopulationFloor, previewTaxableRaw)}
                {@const previewRecruitable = Math.max(0, Math.floor(previewTaxableRaw - previewCore))}
                {@const previewTaxable = Math.floor(previewTaxableRaw)}
                {@const taxGoldPerResident = ratePerHour(policy?.taxGoldPerPopulation)}
                {@const previewTaxIncome = Math.round((previewTaxableRaw * taxGoldPerResident * taxDraft) / 100)}
                {@const untaxedGrowth = ratePerHour(sel.city.populationGrowthBeforeTax)}
                {@const maxTaxGrowthPenalty = policy?.maxTaxGrowthPenaltyPercent ?? 150}
                {@const taxGrowthMultiplier = maxTax > 0 ? 1 - (taxDraft / maxTax) * (maxTaxGrowthPenalty / 100) : 1}
                {@const previewGrowth = taxPolicyDirty && !sel.city.starving ? untaxedGrowth * taxGrowthMultiplier : ratePerHour(sel.city.populationGrowth)}
                <div class="mt-2.5 border-t border-[#465a5f] pt-2">{@render populationUse(sel.city)}</div>
                <div class="mt-2.5 border border-[#465a5f] bg-black/[0.08]">
                  <div class="flex items-center justify-between border-b border-white/[0.07] px-2.5 py-2">
                    <div>
                      <div class="inspector-label">City policy</div>
                      <div class="mt-0.5 text-[9px] text-[#768487]">Balance defense, revenue, and growth</div>
                    </div>
                    <button
                      class="border border-blue-200/20 bg-blue-200/[0.08] px-2.5 py-1 text-[9px] font-semibold text-blue-100 transition-colors hover:bg-blue-200/[0.14] disabled:opacity-35"
                      disabled={!policyDirty || policySaving}
                      on:click={saveCityPolicy}>{policySaving ? 'Saving…' : policyDirty ? 'Apply policy' : 'Saved'}</button
                    >
                  </div>
                  <div class="space-y-3 px-2.5 py-2.5">
                    <label class="block">
                      <span class="flex items-center justify-between gap-3 text-[10px]">
                        <span class="font-semibold text-[#bdc8c7]">Militia target</span>
                        <span class="flex items-center gap-1 tabular-nums text-blue-200">
                          <input
                            class="numeric-entry"
                            aria-label="Militia target percentage"
                            type="number"
                            min={minMilitia}
                            max={maxMilitia}
                            step="0.01"
                            value={Number(militiaDraft.toFixed(2))}
                            on:change={(event) => setMilitiaDraftFromPercent(event, sel!.city!.populationCap, minMilitia, maxMilitia)}
                          />
                          <span>% ·</span>
                          <input
                            class="numeric-entry numeric-entry-target"
                            aria-label="Militia target resident count"
                            type="number"
                            min={Math.ceil((sel.city.populationCap * minMilitia) / 100)}
                            max={Math.floor((sel.city.populationCap * maxMilitia) / 100)}
                            step="1"
                            value={militiaTargetDraft}
                            on:change={(event) => setMilitiaDraftFromTarget(event, sel!.city!.populationCap, minMilitia, maxMilitia)}
                          />
                          <span>target</span>
                        </span>
                      </span>
                      <input
                        class="mt-1.5 block w-full accent-[#78a9b5]"
                        type="range"
                        min={minMilitia}
                        max={maxMilitia}
                        step="1"
                        value={militiaDraft}
                        on:input={(event) => setMilitiaDraftFromPercent(event, sel!.city!.populationCap, minMilitia, maxMilitia)}
                      />
                      <span class="mt-1 block text-[9px] leading-relaxed text-[#748285]"
                        >Local defenders separate from core civilians. They consume food, do not pay tax, and refill through future growth.</span
                      >
                    </label>
                    <label class="block border-t border-white/[0.06] pt-2.5">
                      <span class="flex items-center justify-between gap-3 text-[10px]">
                        <span class="font-semibold text-[#bdc8c7]">Tax rate</span>
                        <span class="flex items-center gap-1.5">
                          <span class="flex items-center gap-1 tabular-nums text-amber-200">
                            <input
                              class="numeric-entry numeric-entry-tax"
                              aria-label="Tax rate percentage"
                              type="number"
                              min="0"
                              max={maxTax}
                              step="1"
                              bind:value={taxDraft}
                              on:input={() => (policyDraftDirty = true)}
                            />
                            <span>%</span>
                          </span>
                          {@render popChip(previewGrowth)}
                        </span>
                      </span>
                      <input class="mt-1.5 block w-full accent-[#d5b95b]" type="range" min="0" max={maxTax} step="1" bind:value={taxDraft} on:input={() => (policyDraftDirty = true)} />
                      <span class="mt-1 block text-[9px] leading-relaxed text-[#748285]">Higher tax earns more gold but increasingly suppresses growth; extreme rates can drive residents away.</span>
                    </label>
                    <div class="grid grid-cols-3 gap-2 border-t border-white/[0.06] pt-2.5 text-center">
                      <div>
                        <span class="block text-[8px] uppercase tracking-wide text-[#687679]">Recruitable</span><strong class="mt-0.5 block text-[11px] tabular-nums text-emerald-200"
                          >{previewRecruitable.toLocaleString()}</strong
                        >
                      </div>
                      <div>
                        <span class="block text-[8px] uppercase tracking-wide text-[#687679]">Taxpayers</span><strong class="mt-0.5 block text-[11px] tabular-nums text-[#d8d8c7]"
                          >{previewTaxable.toLocaleString()}</strong
                        >
                      </div>
                      <div>
                        <span class="block text-[8px] uppercase tracking-wide text-[#687679]">Tax yield</span><strong class="mt-0.5 block text-[11px] tabular-nums text-amber-200"
                          >+{previewTaxIncome.toLocaleString()}/hr</strong
                        >
                      </div>
                    </div>
                  </div>
                </div>
                {@const netFlow = ratePerHour(sel.city.netFoodFlow)}
                <div class="mt-2.5 border-t border-[#465a5f] pt-2">
                  <div class="inspector-row">
                    <span>Tax revenue</span>
                    <span class="text-amber-200">+{Math.round(ratePerHour(sel.city.taxIncome)).toLocaleString()}/hr</span>
                  </div>
                  <div class="inspector-row">
                    <span>Harvest</span>
                    <span class="text-emerald-300">{Math.round(ratePerHour(sel.city.foodProduction)).toLocaleString()}/hr</span>
                  </div>
                  <div class="inspector-row">
                    <span>Rations</span>
                    <span class="text-red-300/80">{fmtPerHour(-ratePerHour(sel.city.foodUpkeep))}/hr</span>
                  </div>
                  <div class="inspector-row mt-1 border-t border-white/[0.05] pt-2">
                    <span>{netFlow >= 0 ? 'To the stores' : 'From the stores'}</span>
                    <span class="font-semibold {netFlow >= 0 ? 'text-emerald-300' : 'text-red-400'}">{fmtPerHour(netFlow)}/hr</span>
                  </div>
                </div>
              {/if}
            </section>
          {/if}

          {#if !selectedArmy && sel.armies?.length && !showCityManagement}
            {@const stackCompositionExact = sel.armies.every((army) => army.compositionVisibility === ArmyCompositionVisibility.EXACT)}
            {@const friendlyArmies = sel.armies.filter((army) => army.owner?.value === $userId)}
            <section class="inspector-section">
              <div class="mb-2 flex items-center justify-between">
                <span class="inspector-label">Forces present</span>
                <span class="text-xs font-medium tabular-nums text-[#9aa39c]">
                  {stackCompositionExact ? `${sel.armies.reduce((sum, army) => sum + armySize(army), 0)} units` : 'Composition unknown'}
                </span>
              </div>
              <div class="space-y-1.5">
                {#each sel.armies as army}
                  {@const owned = army.owner?.value === $userId}
                  {@const size = armySize(army)}
                  {@const order = orderForArmy(army)}
                  {@const intent = orderIntent(order)}
                  {@const visibleTroops = army.troops.filter((stack) => (stack.count ?? 1) > 0)}
                  <button
                    class="flex w-full items-center gap-2.5 border border-[#465a5f] bg-[#233235] p-1.5 text-left transition-colors hover:border-[#60757a] hover:bg-[#304348]"
                    on:click={() => focusArmy(army, false)}
                  >
                    {#if army.compositionVisibility !== ArmyCompositionVisibility.HIDDEN && visibleTroops[0]}
                      {@render troopGlyph(visibleTroops[0].type)}
                    {:else}
                      <span class="unit-token text-lg">?</span>
                    {/if}
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5">
                        <span class="h-1.5 w-1.5 shrink-0 {owned ? 'bg-blue-400' : 'bg-red-400'}"></span>
                        <span class="truncate text-[11px] font-bold {owned ? 'text-blue-200' : 'text-red-200'}">{armyTitle(army)}</span>
                      </div>
                      {#if order}
                        <div class="mt-1 flex min-w-0 items-center gap-1.5">
                          <span class="shrink-0 border px-1 py-0.5 text-[7px] font-bold uppercase tracking-[0.08em] {orderToneSurface(intent)} {orderToneText(intent)}">{orderLabel(order)}</span>
                          <span class="truncate text-[9px] {orderToneText(intent)}">{orderStatus(order, !!army.battleId)}</span>
                        </div>
                      {:else}
                        <div class="mt-1 truncate text-[9px] {army.battleId ? 'text-red-200/80' : 'text-[#858578]'}">
                          {army.battleId ? 'In battle' : army.orderId ? 'Active order' : 'Holding this tile'}
                        </div>
                      {/if}
                    </div>
                    <div class="text-right">
                      <strong class="block text-[13px] font-bold tabular-nums text-[#edf3f1]">{army.compositionVisibility === ArmyCompositionVisibility.EXACT ? size : '?'}</strong>
                      <span class="text-[8px] uppercase tracking-wide text-[#7f7f72]">troops</span>
                    </div>
                  </button>
                {/each}
              </div>
              {#if friendlyArmies.length > 1}
                <button class="game-action game-action-secondary mt-2" disabled={busy} on:click={() => mergeOwnedArmies(friendlyArmies)}>
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" class="h-3.5 w-3.5" aria-hidden="true"><path d="M3 5h4l3 5 3-5h4M3 15h4l3-5 3 5h4" /></svg>
                  Combine {friendlyArmies.length} friendly armies
                </button>
                <div class="merge-note mt-1">{friendlyArmies.length} formations → strongest army remains</div>
              {/if}
            </section>
          {/if}

          <!-- Building information -->
          {#if !selectedArmy && sel.building && showCityManagement && (cityManagementView === 'building' || selectedSettlementCenter)}
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
            {@const populationAfterTraining = Math.max(0, availablePopulation - trainingPopulation)}
            {@const trainingBatchSeconds = batchCount * recruitStat.trainSeconds}
            {@const barracksTrainingInProgress = isBarracks && trainingOrdersAvailable && selectedTrainingOrders.length > 0}
            {@const canTrain =
              isBarracks && !isBuilding && !upgrading && batchCount >= 1 && batchCount <= trainingCapacity && BigInt(trainingCost) <= $gold && trainingPopulation <= availablePopulation}
            <section class="inspector-section">
              <div class="flex items-center gap-2.5">
                {@render structureGlyph(sel.building.type, sel.building.level)}
                <div class="min-w-0 flex-1">
                  <strong class="block truncate text-[12px] font-bold text-[#e9f0ee]">{bName(sel.building.type)}</strong>
                  <span class="mt-0.5 block text-[9px] text-[#829496]">{isBuilding ? 'Work underway' : `Level ${sel.building.level} city building`}</span>
                </div>
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
                      {isBuilding ? 'Constructing' : `Upgrading to Lv ${sel.building.targetLevel}`}
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
                      <span>Yield</span>
                      <span class="text-emerald-300">{stats.production.map(fmtProd).join(', ')}</span>
                    </div>
                  {/if}
                  {#if stats.population > 0}
                    <div class="inspector-row">
                      <span>Housing</span>
                      <span class="text-blue-300">+{stats.population}</span>
                    </div>
                  {/if}
                </div>
              {/if}
              {#if nextStats && sel.city?.owner?.value === $userId}
                <div class="mt-3 border-t border-white/[0.07] pt-3">
                  <div class="inspector-label mb-1">Next level</div>
                  {#if barracksTrainingInProgress}
                    <div class="mb-2 text-[10px] text-amber-200/80">Finish the training queue before upgrading this barracks.</div>
                  {/if}
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
                      <span>Yield</span>
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
                      <span>Housing</span>
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
              {#if sel.city?.owner?.value === $userId}
                <div class="mt-3 flex gap-2 border-t border-[#465a5f] pt-3">
                  <button
                    class="game-action game-action-primary flex-1"
                    disabled={busy || !nextStats || upgrading || barracksTrainingInProgress}
                    title={barracksTrainingInProgress ? 'Finish the training queue before upgrading' : undefined}
                    on:click={() => sel?.building && doAction(() => buildingClient.upgradeBuilding({ buildingId: sel!.building!.buildingId }), 'Upgrade failed')}
                  >
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" class="h-3.5 w-3.5" aria-hidden="true"><path d="M10 17V4M5 9l5-5 5 5M4 17h12" /></svg>
                    {busy ? 'Working…' : 'Upgrade'}
                  </button>
                  {#if !selectedSettlementCenter}
                    <button
                      class="game-action game-action-danger flex-1"
                      disabled={busy || upgrading}
                      on:click={() => sel?.building && doAction(() => buildingClient.deleteBuilding({ buildingId: sel!.building!.buildingId }), 'Demolish failed')}
                    >
                      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" class="h-3.5 w-3.5" aria-hidden="true"
                        ><path d="M5 6h10M8 3h4l1 3H7l1-3ZM7 8v7M10 8v7M13 8v7M6 17h8l1-11H5l1 11Z" /></svg
                      >
                      {busy ? 'Working…' : 'Demolish'}
                    </button>
                  {/if}
                </div>
              {/if}
            </section>
            {#if isBarracks && sel.city?.owner?.value === $userId && !isBuilding}
              <section class="inspector-section barracks-training-section">
                <div class="barracks-training-scroll">
                  {#if trainingOrdersAvailable && selectedTrainingOrders.length > 0}
                    {@const activeOrder = selectedTrainingOrders[0]}
                    {@const queuedPopulation = queuePopulationCost(selectedTrainingOrders)}
                    {@const activeStartsAt = timestampMs(activeOrder.startedAt)}
                    {@const activeCompletesAt = timestampMs(activeOrder.completesAt)}
                    {@const activeProgress =
                      activeStartsAt > 0 && activeCompletesAt > activeStartsAt ? Math.max(0, Math.min(100, ((now - activeStartsAt) / (activeCompletesAt - activeStartsAt)) * 100)) : 0}
                    <div class="mb-2 border border-blue-200/15 bg-blue-200/[0.05] px-2.5 py-2">
                      <div class="flex items-center justify-between gap-3 text-[10px]">
                        <span class="flex items-center gap-2 font-semibold text-blue-100">
                          <span class="training-order-icon">{@render troopGlyph(activeOrder.type)}</span>
                          Training {activeOrder.count}
                          {troopName(activeOrder.type, activeOrder.count)}
                        </span>
                        <span class="tabular-nums text-blue-200/80">{activeCompletesAt ? fmtCountdown(activeCompletesAt - now) : 'Waiting'}</span>
                      </div>
                      {#if activeStartsAt > 0 && activeCompletesAt > activeStartsAt}
                        <div class="mt-2 h-0.5 overflow-hidden bg-white/[0.08]">
                          <div class="h-full bg-blue-300/80 transition-[width] duration-500" style={`width: ${activeProgress}%`}></div>
                        </div>
                      {/if}
                      {#if selectedTrainingOrders.length > 1}
                        <div class="mt-1.5 text-[9px] tabular-nums text-[#7f9292]">
                          +{selectedTrainingOrders.length - 1}
                          {selectedTrainingOrders.length === 2 ? 'batch' : 'batches'} waiting
                        </div>
                      {/if}
                      <div class="mt-1 text-[9px] tabular-nums text-blue-200/70">
                        {queuedPopulation.toLocaleString()}
                        {queuedPopulation === 1 ? 'resident' : 'residents'} transferred into this queue
                      </div>
                    </div>
                  {/if}
                  <div class="mb-2 flex items-center justify-between gap-3">
                    <span class="inspector-label">Train troops</span>
                    <span class="text-[10px] tabular-nums text-[#818a83]">Batch limit {trainingCapacity}</span>
                  </div>
                  <div class="mb-3">{@render populationUse(sel.city!)}</div>
                  <div class="grid grid-cols-4 border-l border-t border-[#465a5f]">
                    {#each TROOP_TYPES as type}
                      {@const option = TROOP_STATS[type]}
                      <button
                        class="flex min-w-0 flex-col items-center border-b border-r border-[#465a5f] px-1 py-1.5 text-center transition-colors {recruitType === type
                          ? 'bg-[#48666d]/65 text-white'
                          : 'text-[#9d9c8d] hover:bg-white/[0.04] hover:text-white'}"
                        on:click={() => (recruitType = type)}
                      >
                        {@render troopGlyph(type)}
                        <span class="mt-1 block w-full truncate text-[9px] font-bold">{option.name}</span>
                        <span class="mt-0.5 block text-[8px] tabular-nums text-[#859799]">
                          {option.gold}g · {option.population}
                          {option.population === 1 ? 'recruit' : 'recruits'}
                        </span>
                      </button>
                    {/each}
                  </div>
                  <label class="mt-3 block border border-white/[0.08] bg-black/10 px-3 py-2.5">
                    <span class="flex items-center justify-between gap-3 text-[10px]">
                      <span class="font-semibold text-[#bdc8c7]">Number to train</span>
                      <span class="flex items-center gap-1 text-sm tabular-nums text-blue-200">
                        <input class="numeric-entry numeric-entry-count" aria-label="Number of troops to train" type="number" min="1" max={trainingCapacity} step="1" bind:value={recruitCount} />
                        <span>/ {trainingCapacity}</span>
                      </span>
                    </span>
                    <input class="mt-2 block w-full accent-[#78a9b5]" type="range" min="1" max={trainingCapacity} step="1" bind:value={recruitCount} />
                    <span class="mt-1 flex justify-between text-[8px] tabular-nums text-[#687679]"><span>1</span><span>Batch capacity {trainingCapacity}</span></span>
                  </label>
                  <div class="mt-2 border border-blue-200/10 bg-blue-200/[0.035] px-2 py-1.5 text-[9px] leading-relaxed text-[#849698]">
                    Recruits leave the city population as soon as the order is queued. Population growth can replenish the available pool.
                  </div>
                  <div class="mt-2 border-t border-[#465a5f] pt-1.5">
                    <div class="inspector-row">
                      <span>Gold cost</span>
                      <span class={BigInt(trainingCost) <= $gold ? 'text-amber-200' : 'text-red-300'}>{trainingCost.toLocaleString()} gold</span>
                    </div>
                    <div class="inspector-row">
                      <span>Residents recruited</span>
                      <span class={trainingPopulation <= availablePopulation ? 'text-blue-200' : 'text-red-300'}>{trainingPopulation.toLocaleString()}</span>
                    </div>
                    <div class="inspector-row">
                      <span>Recruitable after</span>
                      {#if trainingPopulation <= availablePopulation}
                        <span class="text-emerald-200">
                          <span class="text-[#78817a]">{availablePopulation.toLocaleString()} →</span>
                          {populationAfterTraining.toLocaleString()}
                        </span>
                      {:else}
                        <span class="text-red-300">{availablePopulation.toLocaleString()} available · {(trainingPopulation - availablePopulation).toLocaleString()} short</span>
                      {/if}
                    </div>
                    <div class="inspector-row">
                      <span>Ready in</span>
                      <span>{recruitStat.trainSeconds}s each · {fmtCountdown(trainingBatchSeconds * 1000)} batch</span>
                    </div>
                    <div class="inspector-row">
                      <span>Army upkeep</span>
                      <span class="text-red-300/80">-{(batchCount * recruitStat.foodPerHour).toLocaleString()} food/hr</span>
                    </div>
                  </div>
                </div>
                <div class="barracks-training-action">
                  <button class="game-action game-action-primary w-full" disabled={busy || !canTrain} on:click={queueTroops}>
                    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square" stroke-linejoin="miter">
                      <circle cx="9" cy="7" r="3" />
                      <path d="M3.5 19v-1.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5V19M18 8v6M15 11h6" />
                    </svg>
                    {busy ? 'Working…' : 'Train'}
                  </button>
                </div>
              </section>
            {/if}
          {:else if !selectedArmy && !sel.building && sel.city?.owner?.value === $userId && !showCityManagement}
            {#if showBuild}
              {@const buildStats = getLevelStats(buildType, 1)}
              <section class="inspector-section">
                <div class="mb-3 flex items-center justify-between">
                  <span class="inspector-label">City works</span>
                  <button class="text-xs font-medium text-[#9ba097] transition-colors hover:text-white" on:click={() => (showBuild = false)}>Cancel</button>
                </div>
                <div class="grid grid-cols-4 border-l border-t border-[#465a5f]">
                  {#each placeTypes as bt}
                    <button
                      class="flex min-w-0 flex-col items-center border-b border-r border-[#465a5f] px-1 py-1.5 text-center transition-colors
							{buildType === bt ? 'bg-[#48666d]/65 text-white' : 'text-[#9dacad] hover:bg-white/[0.04] hover:text-white'}"
                      on:click={() => (buildType = bt)}
                    >
                      {@render structureGlyph(bt, 1)}
                      <span class="mt-1 block w-full truncate text-[9px] font-bold">{bName(bt)}</span>
                    </button>
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
                        <span>Housing</span>
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
                  on:click={() => sel?.city && doAction(() => buildingClient.createBuilding({ cityId: sel!.city!.cityId, type: buildType, coords: { x: sel!.x, y: sel!.y } }), 'Construction failed')}
                  >{busy ? 'Working…' : `Construct ${bName(buildType)}`}</button
                >
              </div>
            {:else}
              <div class="inspector-actions inspector-actions-compact">
                <button class="game-action game-action-primary w-full" on:click={() => (showBuild = true)}>
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" class="h-3.5 w-3.5" aria-hidden="true"><path d="M3 17h14M5 17V8l5-4 5 4v9M8 17v-5h4v5" /></svg>
                  Construct
                </button>
              </div>
            {/if}
          {:else if !selectedArmy && !sel.city && !sel.armies?.length}
            <div class="inspector-empty px-5 py-8 text-sm text-[#85897d]">
              {selectedUnknown ? 'Beyond explored territory' : selectedVisibility === TileVisibilityState.EXPLORED ? 'Terrain remembered; current occupants are hidden' : 'No structures on this tile'}
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  {#if showBattlePanel && selectedBattle && selectedArmy}
    {@const battleStartedMs = timestampMs(selectedBattle.startedAt)}
    {@const nextBattleTickMs = timestampMs(selectedBattle.nextTickAt)}
    <div class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-3 sm:p-8" transition:fade={{ duration: 140 }}>
      <div class="battle-dialog" role="dialog" aria-modal="true" aria-label="Battle details">
        <header class="battle-dialog-header">
          <span class="battle-dialog-emblem" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-linecap="square" stroke-linejoin="miter">
              <path d="m7 24 4 1 14-15-3-3L7 22v2Zm18 1-4 1L7 10l3-3 15 15v3Z" fill="currentColor" opacity=".2" />
              <path d="m7 24 4 1 14-15-3-3L7 22v2Zm18 1-4 1L7 10l3-3 15 15v3ZM8 19l5 5M24 19l-5 5" stroke-width="1.7" />
            </svg>
          </span>
          <div class="min-w-0 flex-1">
            <div class="text-[9px] font-bold uppercase tracking-[0.16em] text-red-300">Active engagement</div>
            <h2 class="mt-0.5 truncate text-lg font-bold text-[#f0ead8]">
              Battle at {selectedBattle.tileId?.x ?? selectedArmy.coords?.x ?? '—'}, {selectedBattle.tileId?.y ?? selectedArmy.coords?.y ?? '—'}
            </h2>
          </div>
          <button class="battle-dialog-close" aria-label="Close battle details" on:click={() => (showBattlePanel = false)}>×</button>
        </header>

        <div class="battle-dialog-timing">
          <div>
            <span>Status</span>
            <strong class="text-red-200">In progress</strong>
          </div>
          <div>
            <span>Engaged</span>
            <strong>{battleStartedMs ? fmtCountdown(now - battleStartedMs) : 'Unknown'}</strong>
          </div>
          <div>
            <span>Next combat tick</span>
            <strong class="text-amber-100">{nextBattleTickMs ? fmtCountdown(nextBattleTickMs - now) : 'Pending'}</strong>
          </div>
        </div>

        <div class="battle-dialog-body">
          {@render battleSidePanel('Attackers', selectedBattle.attackers, true)}
          <div class="battle-versus" aria-hidden="true">VS</div>
          {@render battleSidePanel('Defenders', selectedBattle.defenders, false)}
        </div>

        <footer class="battle-dialog-footer">
          <p>Strength reflects currently disclosed formations. Battle state refreshes on server combat ticks.</p>
          <div class="flex shrink-0 gap-2">
            <button class="game-action game-action-secondary" on:click={() => (showBattlePanel = false)}>Close</button>
            {#if selectedArmy.owner?.value === $userId}
              <button class="game-action game-action-danger" disabled={busy} on:click={() => haltArmy(selectedArmy)}>
                {busy ? 'Ordering retreat…' : 'Retreat selected army'}
              </button>
            {/if}
          </div>
        </footer>
      </div>
    </div>
  {/if}

  <!-- Bottom hint -->
  {#if !sel}
    <div class="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2" transition:fade={{ duration: 200 }}>
      <span class="rounded-full bg-black/40 px-3 py-1.5 text-[11px] font-medium text-white/60 backdrop-blur-sm">Select a tile to inspect</span>
    </div>
  {/if}

  <!-- Minimap -->
  <div class="pointer-events-auto absolute bottom-4 left-4 z-[11]">
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
