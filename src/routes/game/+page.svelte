<script lang="ts">
	import {
		buildings, cities, mapCenter, token, username, gold, food, userId, gameConfig
	} from '$lib/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { Application, Container, Graphics, Rectangle, Sprite } from 'pixi.js';
	import { S, HEX_H, HEX_VERTS, hexToPixel, pixelToHex, tileKey, hexNeighbors } from '$lib/game/hex';
	import { getTileTexture, TILE_ANCHOR_X, TILE_ANCHOR_Y, type TileKind } from '$lib/game/tiles';
	import type { City } from '$lib/gen/cityio/entity/v1/city_pb';
	import type { Building } from '$lib/gen/cityio/entity/v1/building_pb';
	import { BuildingType, CityType } from '$lib/gen/cityio/entity/v1/common_pb';
	import { mapClient, buildingClient, cityClient } from '$lib/api/client';

	// ── constants ──────────────────────────────────────────
	const MIN_ZOOM = 0.4;
	const MAX_ZOOM = 3;
	const CLICK_DIST = 5;

	// ── pixi state ──────────────────────────────────────────
	let app: Application;
	let cont: Container;
	let el: HTMLDivElement;
	let cw = 800, ch = 600;

	// drag
	let drag = false;
	let dsx = 0, dsy = 0, csx = 0, csy = 0;

	// tiles
	let loaded = new Map<string, Container>();
	let tileData = new Map<string, { city?: City; building?: Building }>();
	let selGfx: Graphics | null = null;

	// ── UI state ────────────────────────────────────────────
	let sel: { x: number; y: number; city?: City; building?: Building } | null = null;
	let myCities: City[] = [];
	let buildType: BuildingType = BuildingType.HOUSE;
	const placeTypes = [BuildingType.HOUSE, BuildingType.FARM, BuildingType.MINE, BuildingType.BARRACKS];
	let busy = false;
	let err = '';
	let showBuild = false;

	// ── names ───────────────────────────────────────────────
	const BN: Record<number, string> = {
		[BuildingType.CITY_CENTER]: 'City Center', [BuildingType.TOWN_CENTER]: 'Town Center',
		[BuildingType.BARRACKS]: 'Barracks', [BuildingType.HOUSE]: 'House',
		[BuildingType.FARM]: 'Farm', [BuildingType.MINE]: 'Mine',
	};
	const bName = (t: BuildingType) => BN[t] ?? 'Unknown';
	const cName = (t: CityType) => t === CityType.CITY ? 'City' : t === CityType.TOWN ? 'Town' : 'Settlement';

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
			const sx = city.start.x, sy = city.start.y, s = city.size;
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

	const centerCam = (col: number, row: number) => {
		const p = hexToPixel(col, row);
		cont.x = -p.x * cont.scale.x + cw / 2;
		cont.y = -p.y * cont.scale.y + ch / 2;
	};

	// ── data actions ────────────────────────────────────────
	const refreshMap = async () => {
		const r = await mapClient.getMap({});
		cities.set(r.entities?.cities ?? []); buildings.set(r.entities?.buildings ?? []);
		buildLookup(); rebuildTiles();
		if (sel) {
			const t = tileData.get(tileKey(sel.x, sel.y));
			sel = { x: sel.x, y: sel.y, ...t };
		}
	};

	const rebuildTiles = () => {
		for (const [, c] of loaded) c.destroy({ children: true });
		loaded.clear();
		if (selGfx) { selGfx.destroy(); selGfx = null; }
		loadVisible();
		if (sel) drawSel(sel.x, sel.y);
	};

	const loadCities = async () => {
		try { myCities = (await cityClient.listCities({})).entities?.cities ?? []; rebuildTiles(); } catch { /* */ }
	};

	const doAction = async (fn: () => Promise<unknown>, msg: string) => {
		busy = true; err = '';
		try { await fn(); await refreshMap(); }
		catch (e: unknown) { err = e instanceof Error ? e.message : msg; }
		finally { busy = false; }
	};

	// ── pixi init ───────────────────────────────────────────
	onMount(() => {
		buildLookup(); initPixi(); loadCities();
		const onR = () => resize();
		window.addEventListener('resize', onR);
		return () => { window.removeEventListener('resize', onR); app?.destroy(true, { children: true }); };
	});

	const resize = () => {
		if (!app || !el) return;
		cw = el.clientWidth; ch = el.clientHeight;
		app.renderer.resize(cw, ch);
		loadVisible();
	};

	const initPixi = async () => {
		cw = el.clientWidth; ch = el.clientHeight;
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

		// Selection pulse animation
		app.ticker.add(() => {
			if (selGfx) {
				const t = performance.now() / 1000;
				selGfx.alpha = 0.85 + 0.15 * Math.sin(t * 2.5);
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
		tc.x = px; tc.y = py;
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
					const vi = i * 2, vn = ((i + 1) % 6) * 2;
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
		const ox = -cont.x / s, oy = -cont.y / s;
		const vw = cw / s, vh = ch / s;
		const colMin = Math.floor(ox / (1.5 * S)) - 2;
		const colMax = Math.ceil((ox + vw) / (1.5 * S)) + 2;
		const rowMin = Math.floor(oy / HEX_H) - 2;
		const rowMax = Math.ceil((oy + vh) / HEX_H) + 2;
		for (let col = colMin; col <= colMax; col++)
			for (let row = rowMin; row <= rowMax; row++)
				renderTile(col, row);
	};

	// ── selection ───────────────────────────────────────────
	const drawSel = (col: number, row: number) => {
		if (selGfx) { cont.removeChild(selGfx); selGfx.destroy(); }
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
		if (selGfx) { cont.removeChild(selGfx); selGfx.destroy(); selGfx = null; }
	};

	// ── input ───────────────────────────────────────────────
	const setupInput = () => {
		cont.on('pointerdown', (e) => {
			drag = true;
			const p = e.data.global;
			dsx = p.x; dsy = p.y; csx = cont.x; csy = cont.y;
		});

		cont.on('pointermove', (e) => {
			if (!drag) return;
			const p = e.data.global;
			cont.x = csx + (p.x - dsx);
			cont.y = csy + (p.y - dsy);
			loadVisible();
		});

		cont.on('pointerup', (e) => {
			if (!drag) return;
			const p = e.data.global;
			const dx = p.x - dsx, dy = p.y - dsy;
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
			const mx = e.data.global.x, my = e.data.global.y;
			const f = next / cur;
			cont.x = mx - (mx - cont.x) * f;
			cont.y = my - (my - cont.y) * f;
			cont.scale.set(next);
			loadVisible();
			mapCenter.set(getCenter());
		});
	};

	const logout = () => {
		token.set(undefined); username.set(undefined); userId.set(undefined);
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
			<span class="text-xs text-gray-400">Gold <span class="tabular-nums text-amber-300">{$gold.toString()}</span></span>
			<span class="text-xs text-gray-400">Food <span class="tabular-nums text-emerald-300">{$food.toString()}</span></span>
		</div>

		<!-- Logout -->
		<button
			class="pointer-events-auto rounded-lg bg-gray-900/85 px-3 py-1.5 text-xs font-medium text-gray-500 backdrop-blur-sm transition-colors hover:text-gray-200"
			on:click={logout}
		>Sign Out</button>
	</div>

	<!-- Right panel -->
	<div class="pointer-events-none absolute bottom-4 right-4 top-16 flex w-60 flex-col gap-2.5">
		{#if myCities.length > 0}
			<div class="pointer-events-auto rounded-lg bg-gray-900/85 p-3 backdrop-blur-sm">
				<div class="mb-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">Your Cities</div>
				{#each myCities as city}
					<button
						class="group flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors duration-150 hover:bg-white/[0.06]"
						on:click={() => {
							if (city.start) {
								centerCam(city.start.x + Math.floor(city.size / 2), city.start.y + Math.floor(city.size / 2));
								loadVisible(); mapCenter.set(getCenter());
							}
						}}
					>
						<div class="h-1.5 w-1.5 rounded-full bg-emerald-400/60"></div>
						<span class="text-xs font-medium text-gray-300 group-hover:text-gray-100">{city.name}</span>
						<span class="ml-auto text-[10px] text-gray-600">{cName(city.type)}</span>
					</button>
				{/each}
			</div>
		{/if}

		{#if sel}
			<div class="pointer-events-auto space-y-3 rounded-lg bg-gray-900/85 p-3 backdrop-blur-sm"
				transition:fly={{ x: 16, duration: 200 }}>
				<!-- Header -->
				<div class="flex items-center justify-between">
					<span class="rounded-md bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-gray-500">{sel.x}, {sel.y}</span>
					<button
						aria-label="Close"
						class="flex h-5 w-5 items-center justify-center rounded-lg text-gray-600 transition-colors duration-150 hover:bg-white/[0.06] hover:text-gray-300"
						on:click={deselect}
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5">
							<path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
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
						</div>
					</div>
				{/if}

				<!-- Building info card -->
				{#if sel.building}
					<div class="rounded-md bg-white/[0.04] p-3">
						<div class="flex items-center justify-between">
							<span class="text-sm font-semibold text-amber-200">{bName(sel.building.type)}</span>
							<span class="rounded-lg bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-amber-400">Lv {sel.building.level}</span>
						</div>
						{#if sel.building.targetLevel > sel.building.level}
							<div class="mt-2 flex items-center gap-1.5 text-[10px] text-amber-400/70">
								<div class="h-1 w-1 animate-pulse rounded-full bg-amber-400"></div>
								Upgrading to Lv {sel.building.targetLevel}
							</div>
						{/if}
						{#if sel.building.constructionEnd}
							<div class="mt-2 flex items-center gap-1.5 text-[10px] text-amber-400/70">
								<div class="h-1 w-1 animate-pulse rounded-full bg-amber-400"></div>
								Under construction
							</div>
						{/if}
					</div>
					{#if sel.city?.owner?.value === $userId}
						<div class="flex gap-2">
							<button class="flex-1 rounded-md bg-sky-500/15 py-2 text-[11px] font-semibold text-sky-300 transition-colors hover:bg-sky-500/25 disabled:opacity-30"
								disabled={busy} on:click={() => sel?.building && doAction(() => buildingClient.upgradeBuilding({ buildingId: sel!.building!.buildingId }), 'Upgrade failed')}
							>{busy ? '...' : 'Upgrade'}</button>
							<button class="flex-1 rounded-md bg-red-500/10 py-2 text-[11px] font-semibold text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-30"
								disabled={busy} on:click={() => sel?.building && doAction(() => buildingClient.deleteBuilding({ buildingId: sel!.building!.buildingId }), 'Demolish failed')}
							>{busy ? '...' : 'Demolish'}</button>
						</div>
					{/if}
				{:else if sel.city?.owner?.value === $userId}
					<!-- Build toggle (own city, no building on tile) -->
					<button
						class="w-full rounded-md py-2 text-xs font-semibold transition-colors
							{showBuild ? 'bg-gray-500/15 text-gray-300 hover:bg-gray-500/25' : 'bg-emerald-600/25 text-emerald-200 hover:bg-emerald-600/35'}"
						on:click={() => showBuild = !showBuild}
					>{showBuild ? 'Cancel' : 'Build'}</button>
					{#if showBuild}
						<div>
							<div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">Build Structure</div>
							<div class="grid grid-cols-2 gap-1.5">
								{#each placeTypes as bt}
									<button
										class="rounded-xl py-1.5 text-[11px] font-medium transition-all duration-150
											{buildType === bt
												? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25'
												: 'bg-white/[0.04] text-gray-400 hover:bg-white/[0.08] hover:text-gray-300'}"
										on:click={() => buildType = bt}
									>{bName(bt)}</button>
								{/each}
							</div>
						</div>
						<button class="w-full rounded-md bg-emerald-600/25 py-2 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-600/35 disabled:opacity-30"
							disabled={busy}
							on:click={() => sel?.city && doAction(() => buildingClient.createBuilding({ cityId: sel!.city!.cityId, type: buildType, coords: { x: sel!.x, y: sel!.y } }), 'Build failed')}
						>{busy ? '...' : 'Place Building'}</button>
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
