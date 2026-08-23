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

export function armyTitle(army: Army): string {
  const active = army.troops.filter((stack) => stack.count > 0);
  if (active.length !== 1) return 'Field Army';
  switch (active[0].type) {
    case TroopType.SOLDIER:
      return 'Infantry Army';
    case TroopType.ARCHER:
      return 'Archer Army';
    case TroopType.CAVALRY:
      return 'Cavalry Army';
    case TroopType.ARTILLERY:
      return 'Artillery Battery';
    default:
      return 'Field Army';
  }
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

const drawFootTroop = (art: Graphics, x: number, y: number, color: number, light: number, archer: boolean) => {
  art.moveTo(x - 1.5, y + 6);
  art.lineTo(x - 2.5, y + 11);
  art.moveTo(x + 1.5, y + 6);
  art.lineTo(x + 2.5, y + 11);
  art.stroke({ color: 0x272a25, width: 1.5, alpha: 1 });
  art.rect(x - 3, y - 1, 6, 8);
  art.fill({ color, alpha: 1 });
  art.rect(x - 3, y + 3, 6, 2);
  art.fill({ color: 0x2b2d27, alpha: 0.9 });
  art.circle(x, y - 4, 2.7);
  art.fill({ color: 0xbda77f, alpha: 1 });
  art.rect(x - 3, y - 6, 6, 2.5);
  art.fill({ color: 0x353a33, alpha: 1 });

  if (archer) {
    art.arc(x + 4, y + 1, 5, -Math.PI / 2, Math.PI / 2);
    art.moveTo(x + 4, y - 4);
    art.lineTo(x + 4, y + 6);
    art.stroke({ color: 0x6f4d2a, width: 1, alpha: 1 });
    art.moveTo(x + 1, y + 1);
    art.lineTo(x + 8, y + 1);
    art.stroke({ color: 0xd8c99e, width: 1, alpha: 0.9 });
  } else {
    art.moveTo(x + 4, y + 9);
    art.lineTo(x + 4, y - 10);
    art.stroke({ color: 0x4c4b3e, width: 1.2, alpha: 1 });
    art.poly([x + 4, y - 12, x + 2, y - 9, x + 6, y - 9]);
    art.fill({ color: 0xb9b8a7, alpha: 1 });
    art.circle(x - 4, y + 3, 3.2);
    art.fill({ color: 0x30352f, alpha: 1 });
    art.circle(x - 4, y + 3, 3.2);
    art.stroke({ color: light, width: 1, alpha: 0.9 });
  }
};

const drawCavalry = (art: Graphics, x: number, y: number, color: number) => {
  art.moveTo(x - 4, y + 6);
  art.lineTo(x - 5, y + 12);
  art.moveTo(x + 3, y + 6);
  art.lineTo(x + 4, y + 12);
  art.stroke({ color: 0x2e241c, width: 1.7, alpha: 1 });
  art.ellipse(x, y + 4, 7, 4);
  art.fill({ color: 0x71503a, alpha: 1 });
  art.rect(x + 5, y - 1, 4, 6);
  art.fill({ color: 0x71503a, alpha: 1 });
  art.circle(x + 8, y - 2, 2.2);
  art.fill({ color: 0x59402f, alpha: 1 });
  art.rect(x - 2.5, y - 5, 5, 8);
  art.fill({ color, alpha: 1 });
  art.circle(x, y - 8, 2.5);
  art.fill({ color: 0xbda77f, alpha: 1 });
  art.rect(x - 3, y - 10, 6, 2.2);
  art.fill({ color: 0x353a33, alpha: 1 });
  art.moveTo(x + 3, y + 1);
  art.lineTo(x + 7, y - 13);
  art.stroke({ color: 0x4c4b3e, width: 1.2, alpha: 1 });
};

const drawArtillery = (art: Graphics, x: number, y: number, color: number) => {
  art.circle(x - 4, y + 7, 3.5);
  art.circle(x + 4, y + 7, 3.5);
  art.fill({ color: 0x2b2c28, alpha: 1 });
  art.circle(x - 4, y + 7, 1.5);
  art.circle(x + 4, y + 7, 1.5);
  art.fill({ color: 0x8b6840, alpha: 1 });
  art.moveTo(x - 7, y + 2);
  art.lineTo(x + 8, y - 3);
  art.stroke({ color: 0x3d413c, width: 4, alpha: 1 });
  art.circle(x - 7, y + 2, 2.4);
  art.fill({ color, alpha: 1 });
};

export function createArmyMarker(army: Army, userId?: string, selected = false): Container {
  const marker = new Container();
  marker.position.y = -13;

  const owned = army.owner?.value === userId;
  const color = owned ? 0x4f88bd : 0xa94e45;
  const light = owned ? 0xa9cae5 : 0xe0aaa0;
  const art = new Graphics();

  art.ellipse(0, 10, 13, 3.5);
  art.fill({ color: 0x101410, alpha: 0.55 });

  if (selected) {
    art.poly([-16, 8, 0, 15, 16, 8, 0, 1]);
    art.stroke({ color: 0xf0d65a, width: 2, alpha: 1 });
  }

  const dominant = army.troops.filter((stack) => stack.count > 0).sort((a, b) => b.count - a.count)[0]?.type ?? TroopType.SOLDIER;
  if (dominant === TroopType.CAVALRY) {
    drawCavalry(art, -9, -2, color);
    drawCavalry(art, 8, 0, color);
    drawCavalry(art, 0, -8, color);
  } else if (dominant === TroopType.ARTILLERY) {
    drawFootTroop(art, -11, -2, color, light, false);
    drawArtillery(art, 0, 0, color);
    drawFootTroop(art, 12, -1, color, light, false);
  } else {
    const archer = dominant === TroopType.ARCHER;
    for (const [x, y] of [
      [-12, -3],
      [0, -7],
      [12, -3],
      [-7, 4],
      [7, 4]
    ] as const)
      drawFootTroop(art, x, y, color, light, archer);
  }

  if (army.destination) {
    art.poly([23, -3, 28, 1, 23, 5]);
    art.poly([28, -3, 33, 1, 28, 5]);
    art.stroke({ color: 0xeee7b5, width: 1.5, alpha: 0.95 });
  }

  const count = new Text({
    text: armySize(army).toLocaleString(),
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
  badge.poly([-badgeWidth / 2, 0, badgeWidth / 2, 0, badgeWidth / 2 - 1, 10, 0, 13, -badgeWidth / 2 + 1, 10]);
  badge.fill({ color: 0x171b17, alpha: 0.96 });
  badge.poly([-badgeWidth / 2, 0, badgeWidth / 2, 0, badgeWidth / 2 - 1, 10, 0, 13, -badgeWidth / 2 + 1, 10]);
  badge.stroke({ color, width: 1, alpha: 0.95 });
  badge.position.y = 14;
  count.anchor.set(0.5);
  count.position.set(0, 20.5);

  marker.addChild(art, badge, count);
  return marker;
}
