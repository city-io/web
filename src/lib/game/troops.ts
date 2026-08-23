import { Container, Graphics, Text } from 'pixi.js';

import type { Army } from '$lib/gen/cityio/entity/v1/army_pb';
import { TroopType } from '$lib/gen/cityio/entity/v1/common_pb';
import { TerrainType, type Tile } from '$lib/gen/cityio/entity/v1/tile_pb';
import { tileKey } from '$lib/game/iso';

export type TroopStat = {
  name: string;
  singular: string;
  gold: number;
  trainSeconds: number;
  foodPerHour: number;
  population: number;
};

export const TROOP_TYPES = [TroopType.SOLDIER, TroopType.ARCHER, TroopType.CAVALRY, TroopType.ARTILLERY] as const;

export const TROOP_STATS: Record<(typeof TROOP_TYPES)[number], TroopStat> = {
  [TroopType.SOLDIER]: { name: 'Soldiers', singular: 'Soldier', gold: 50, trainSeconds: 20, foodPerHour: 60, population: 1 },
  [TroopType.ARCHER]: { name: 'Archers', singular: 'Archer', gold: 75, trainSeconds: 30, foodPerHour: 60, population: 1 },
  [TroopType.CAVALRY]: { name: 'Cavalry', singular: 'Cavalry', gold: 150, trainSeconds: 45, foodPerHour: 180, population: 1 },
  [TroopType.ARTILLERY]: { name: 'Artillery', singular: 'Artillery', gold: 300, trainSeconds: 60, foodPerHour: 120, population: 3 }
};

export function troopName(type: TroopType, count = 2): string {
  const stat = TROOP_STATS[type as keyof typeof TROOP_STATS];
  if (!stat) return count === 1 ? 'Troop' : 'Troops';
  return count === 1 ? stat.singular : stat.name;
}

export function armySize(army: Army): number {
  return army.troops.reduce((sum, stack) => sum + stack.count, 0);
}

export type ArmyPathStep = { x: number; y: number };

const PATH_DIRECTIONS: ArmyPathStep[] = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: 1 },
  { x: 1, y: 1 }
];

export function terrainMovementCost(terrain: TerrainType): number {
  if (terrain === TerrainType.WATER) return 0;
  if (terrain === TerrainType.MARSH) return 2;
  if (terrain === TerrainType.MOUNTAINS) return 3;
  return 1;
}

const chebyshev = (a: ArmyPathStep, b: ArmyPathStep): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

const traversable = (tiles: Map<string, Tile>, step: ArmyPathStep): boolean => {
  const tile = tiles.get(tileKey(step.x, step.y));
  return !!tile && terrainMovementCost(tile.terrain) > 0;
};

type PathNode = ArmyPathStep & { cost: number; score: number };

const pushNode = (heap: PathNode[], node: PathNode) => {
  heap.push(node);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    const parentNode = heap[parent];
    if (parentNode.score < node.score || (parentNode.score === node.score && parentNode.cost <= node.cost)) break;
    heap[index] = parentNode;
    index = parent;
  }
  heap[index] = node;
};

const popNode = (heap: PathNode[]): PathNode | undefined => {
  const first = heap[0];
  const last = heap.pop();
  if (!first || !last || heap.length === 0) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= heap.length) break;
    let child = left;
    if (right < heap.length) {
      const l = heap[left];
      const r = heap[right];
      if (r.score < l.score || (r.score === l.score && r.cost < l.cost)) child = right;
    }
    const childNode = heap[child];
    if (last.score < childNode.score || (last.score === childNode.score && last.cost <= childNode.cost)) break;
    heap[index] = childNode;
    index = child;
  }
  heap[index] = last;
  return first;
};

// Mirrors the backend's weighted eight-direction pathfinder so the previewed
// route is the route the server will execute. Water is blocked; diagonal moves
// cannot squeeze between two blocked orthogonal neighbors.
export function findArmyPath(tiles: Map<string, Tile>, start: ArmyPathStep, destination: ArmyPathStep): ArmyPathStep[] | null {
  if (start.x === destination.x && start.y === destination.y) return [];
  if (!traversable(tiles, start) || !traversable(tiles, destination)) return null;

  const startKey = tileKey(start.x, start.y);
  const frontier: PathNode[] = [];
  pushNode(frontier, { ...start, cost: 0, score: chebyshev(start, destination) });
  const costs = new Map<string, number>([[startKey, 0]]);
  const previous = new Map<string, ArmyPathStep>();

  while (frontier.length > 0) {
    const current = popNode(frontier)!;
    const currentKey = tileKey(current.x, current.y);
    if (current.cost !== costs.get(currentKey)) continue;
    if (current.x === destination.x && current.y === destination.y) {
      const path: ArmyPathStep[] = [];
      for (let step = destination; step.x !== start.x || step.y !== start.y; ) {
        path.push(step);
        step = previous.get(tileKey(step.x, step.y))!;
      }
      return path.reverse();
    }

    for (const direction of PATH_DIRECTIONS) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      if (!traversable(tiles, next)) continue;
      if (direction.x !== 0 && direction.y !== 0) {
        if (!traversable(tiles, { x: current.x + direction.x, y: current.y }) || !traversable(tiles, { x: current.x, y: current.y + direction.y })) continue;
      }
      const terrain = tiles.get(tileKey(next.x, next.y))!.terrain;
      const cost = current.cost + terrainMovementCost(terrain);
      const nextKey = tileKey(next.x, next.y);
      if (cost >= (costs.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      costs.set(nextKey, cost);
      previous.set(nextKey, { x: current.x, y: current.y });
      pushNode(frontier, { ...next, cost, score: cost + chebyshev(next, destination) });
    }
  }
  return null;
}

export function armyPathCost(tiles: Map<string, Tile>, path: ArmyPathStep[]): number {
  return path.reduce((total, step) => total + terrainMovementCost(tiles.get(tileKey(step.x, step.y))?.terrain ?? TerrainType.WATER), 0);
}

export function createArmyMarker(armies: Army[], userId?: string): Container {
  const marker = new Container();
  marker.position.y = -9;

  const owned = armies.every((army) => army.owner?.value === userId);
  const foreign = armies.every((army) => army.owner?.value !== userId);
  const color = owned ? 0x5d9de0 : foreign ? 0xc95d53 : 0xc59b45;
  const art = new Graphics();

  art.ellipse(0, 5, 15, 4);
  art.fill({ color: 0x111611, alpha: 0.58 });

  for (const [x, y] of [
    [-7, -3],
    [0, -6],
    [7, -3]
  ] as const) {
    art.rect(x - 2, y, 4, 8);
    art.fill({ color: 0x242b24, alpha: 1 });
    art.rect(x - 2, y + 1, 4, 2);
    art.fill({ color, alpha: 0.92 });
    art.circle(x, y - 2, 2.5);
    art.fill({ color: 0xc8b58d, alpha: 1 });
    art.moveTo(x - 3, y - 2);
    art.lineTo(x + 3, y - 2);
    art.stroke({ color: 0x30372f, width: 2, alpha: 1 });
  }

  art.moveTo(12, 4);
  art.lineTo(12, -17);
  art.stroke({ color: 0x2a2e27, width: 2, alpha: 1 });
  art.poly([12, -17, 22, -14, 12, -10]);
  art.fill({ color, alpha: 1 });
  art.poly([12, -17, 22, -14, 12, -10]);
  art.stroke({ color: 0x171a16, width: 1, alpha: 0.9 });

  if (armies.some((army) => army.destination)) {
    art.poly([18, -4, 24, 0, 18, 4]);
    art.stroke({ color: 0xeee7b5, width: 1.5, alpha: 0.95 });
  }

  const count = new Text({
    text: armies.reduce((sum, army) => sum + armySize(army), 0).toLocaleString(),
    roundPixels: true,
    style: {
      fontFamily: ['Tahoma', 'Verdana', 'Arial', 'sans-serif'],
      fontSize: 9,
      fontWeight: 'bold',
      fill: '#f3f1df'
    }
  });
  const badgeWidth = Math.max(16, Math.ceil(count.width) + 7);
  const badge = new Graphics();
  badge.rect(-badgeWidth / 2, 8, badgeWidth, 13);
  badge.fill({ color: 0x171b17, alpha: 0.96 });
  badge.rect(-badgeWidth / 2, 8, badgeWidth, 13);
  badge.stroke({ color, width: 1, alpha: 0.95 });
  count.anchor.set(0.5);
  count.position.set(0, 14.5);

  marker.addChild(art, badge, count);
  return marker;
}
