export interface User {
  username: string;
  gold: number;
  food: number;
  allies: string[];
}

export interface City {
  cityId: number;
  name: string;
  startX: number;
  startY: number;
}

export interface Building {
  buildingId: string;
  cityId: string;
  type: string;
  x: number;
  y: number;
  constructionEnd: Date;
}

export interface Army {
  armyId: string;
  tileX: number;
  tileY: number;
  owner: string;
  size: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  marchActive: boolean;
}

export interface MapTile {
  x: number;
  y: number;
  city?: City;
  building?: Building;
  armies?: Map<string, Army[]>;
}
