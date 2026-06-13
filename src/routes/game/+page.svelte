<script lang="ts">
	import {
		buildings,
		cities,
		capital,
		mapCenter,
		token,
		username,
		gold,
		food,
		userId
	} from '$lib/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { Application, Assets, Container, Sprite, Text } from 'pixi.js';
	import type { City } from '$lib/gen/cityio/v1/city_pb';
	import type { Building } from '$lib/gen/cityio/v1/building_pb';
	import { BuildingType } from '$lib/gen/cityio/v1/common_pb';
	import { CityType } from '$lib/gen/cityio/v1/common_pb';

	let app: Application;
	let container: Container;

	const numTiles = 128;

	const tileSize = 130;
	let visibleWidth = 9 * tileSize;
	let visibleHeight = 6 * tileSize;

	const minZoom = 0.5;
	const maxZoom = 2;
	let currentZoom = 1;

	let loadedTiles = new Map<string, { sprite: Sprite }>();

	// Build coordinate lookup from cities and buildings
	let tileData = new Map<string, { city?: City; building?: Building }>();

	const buildTileLookup = () => {
		tileData.clear();
		for (const city of $cities) {
			if (!city.start) continue;
			for (let dx = 0; dx < city.size; dx++) {
				for (let dy = 0; dy < city.size; dy++) {
					const key = `${city.start.x + dx},${city.start.y + dy}`;
					const existing = tileData.get(key);
					tileData.set(key, { ...existing, city });
				}
			}
		}
		for (const building of $buildings) {
			if (!building.coords) continue;
			const key = `${building.coords.x},${building.coords.y}`;
			const existing = tileData.get(key);
			tileData.set(key, { ...existing, building });
		}
	};

	const buildingTypeName = (t: BuildingType): string => {
		switch (t) {
			case BuildingType.CITY_CENTER:
				return 'City Center';
			case BuildingType.TOWN_CENTER:
				return 'Town Center';
			case BuildingType.BARRACKS:
				return 'Barracks';
			case BuildingType.HOUSE:
				return 'House';
			case BuildingType.FARM:
				return 'Farm';
			case BuildingType.MINE:
				return 'Mine';
			default:
				return 'Unknown';
		}
	};

	const cityTypeName = (t: CityType): string => {
		switch (t) {
			case CityType.CITY:
				return 'City';
			case CityType.TOWN:
				return 'Town';
			default:
				return 'Settlement';
		}
	};

	onMount(async () => {
		buildTileLookup();
		await initializePixi();

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

	const logout = () => {
		token.set(undefined);
		username.set(undefined);
		userId.set(undefined);
		goto('/login');
	};

	const renderTile = (x: number, y: number): void => {
		if (x < 0 || y < 0 || x >= numTiles || y >= numTiles) return;

		const tileKey = `${x},${y}`;
		if (loadedTiles.has(tileKey)) return;

		const tile = tileData.get(tileKey);
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

		let label: string;
		if (tile?.building) {
			label = buildingTypeName(tile.building.type);
		} else if (tile?.city) {
			label = cityTypeName(tile.city.type);
		} else {
			label = `(${x}, ${y})`;
		}

		const text = new Text({
			text: label,
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
	};

	const loadVisibleTiles = () => {
		const offsetX = -container.x;
		const offsetY = -container.y;

		const start = convertToMap(offsetX, offsetY);

		// start at -1 to pre-render tiles that are partially visible
		for (let dx = -1; dx < visibleWidth / tileSize + 1; dx++) {
			for (let dy = -1; dy < visibleHeight / tileSize + 1; dy++) {
				const x = start.x + dx + dy;
				const y = start.y - dx + dy;

				renderTile(x, y);
				renderTile(x, y + 1);
			}
		}
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
				const newPosition = event.global.clone();
				container.x = container.containerStart.x + (newPosition.x - container.dragStart.x);
				container.y = container.containerStart.y + (newPosition.y - container.dragStart.y);

				loadVisibleTiles();
				mapCenter.set(center);
			}
		});

		container.on('pointerup', () => (container.dragging = false));
		container.on('pointerupoutside', () => (container.dragging = false));

		// Zoom interaction
		container.on('wheel', (event) => {
			const center = getCenter();
			const SCALE = 0.02;

			if (event.deltaY < 0) {
				container.scale.set(
					container.scale.x * (1 + SCALE),
					container.scale.y * (1 + SCALE)
				);
				container.position.set(
					container.position.x * (1 + SCALE),
					container.position.y * (1 + SCALE)
				);
			} else if (event.deltaY > 0) {
				container.scale.set(
					container.scale.x * (1 - SCALE),
					container.scale.y * (1 - SCALE)
				);
				container.position.set(
					container.position.x * (1 - SCALE),
					container.position.y * (1 - SCALE)
				);
			}

			loadVisibleTiles();
			mapCenter.set(center);
		});
	};
</script>

<div class="flex h-screen w-screen overflow-hidden">
	<div id="pixi-container" class="map-container flex h-full overflow-hidden"></div>
	<div class="sidebar flex-1 bg-gray-100">
		<div class="flex items-center justify-between p-4">
			<div class="text-lg">{$username}</div>
			<div class="text-sm text-gray-600">Gold: {$gold.toString()}</div>
			<div class="text-sm text-gray-600">Food: {$food.toString()}</div>
			<button class="text-sm text-gray-600" on:click={logout}>Logout</button>
		</div>
		<p>Map Center: {$mapCenter.x}, {$mapCenter.y}</p>
	</div>
</div>
