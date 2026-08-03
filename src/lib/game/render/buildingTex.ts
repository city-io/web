import { Texture } from 'pixi.js';
import { S } from '../hex';
import { BuildingType } from '$lib/gen/cityio/entity/v1/common_pb';
import { CX, CY, clipTop, newCanvas } from './geometry';

/**
 * Building art on a transparent canvas, so a structure composites over whatever
 * ground it happens to stand on. Previously each building was baked into its
 * own opaque tile texture, which meant a farm could only ever be drawn on
 * grass — on desert or tundra it carried a patch of grassland with it.
 *
 * The drawing bodies are unchanged from the original tiles.ts.
 */

function drawFarmRows(ctx: CanvasRenderingContext2D) {
  ctx.save();
  clipTop(ctx, S * 0.85);
  for (let y = CY - 20; y < CY + 20; y += 8) {
    ctx.fillStyle = 'rgba(90,65,30,0.35)';
    ctx.fillRect(CX - 34, y + 2, 68, 3);
    ctx.strokeStyle = 'rgba(60,45,20,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CX - 34, y + 2);
    ctx.lineTo(CX + 34, y + 2);
    ctx.stroke();
    for (let x = CX - 30; x < CX + 30; x += 6) {
      ctx.strokeStyle = 'rgba(180,160,50,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + 1);
      ctx.lineTo(x, y - 4);
      ctx.stroke();
      ctx.fillStyle = 'rgba(210,180,60,0.8)';
      ctx.beginPath();
      ctx.ellipse(x, y - 5, 1.5, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawHouse(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(CX - 7, CY + 1, 16, 11);
  ctx.fillStyle = '#b8956a';
  ctx.fillRect(CX - 8, CY - 1, 16, 11);
  ctx.fillStyle = '#8b4c2a';
  ctx.beginPath();
  ctx.moveTo(CX - 11, CY - 1);
  ctx.lineTo(CX, CY - 11);
  ctx.lineTo(CX + 11, CY - 1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#5a3520';
  ctx.fillRect(CX - 2, CY + 3, 4, 7);
  ctx.fillStyle = 'rgba(180,220,255,0.5)';
  ctx.fillRect(CX + 4, CY + 1, 3, 3);
}

function drawMine(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#787068';
  ctx.beginPath();
  ctx.arc(CX - 6, CY + 3, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6a6358';
  ctx.beginPath();
  ctx.arc(CX + 5, CY + 4, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#7a7268';
  ctx.beginPath();
  ctx.arc(CX, CY - 3, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(220,190,100,0.5)';
  ctx.beginPath();
  ctx.arc(CX - 3, CY - 5, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(CX + 4, CY + 1, 1.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawBarracks(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#6a4a38';
  ctx.fillRect(CX - 10, CY - 4, 20, 14);
  ctx.fillStyle = '#4a2a1a';
  ctx.beginPath();
  ctx.moveTo(CX - 12, CY - 4);
  ctx.lineTo(CX, CY - 12);
  ctx.lineTo(CX + 12, CY - 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8a7a60';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(CX + 8, CY - 4);
  ctx.lineTo(CX + 8, CY - 18);
  ctx.stroke();
  ctx.fillStyle = '#c03030';
  ctx.beginPath();
  ctx.moveTo(CX + 8, CY - 18);
  ctx.lineTo(CX + 16, CY - 15);
  ctx.lineTo(CX + 8, CY - 12);
  ctx.closePath();
  ctx.fill();
}

function drawCityCenter(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(CX - 15, CY + 1, 32, 9);
  ctx.fillStyle = '#9a9080';
  ctx.fillRect(CX - 16, CY - 2, 32, 11);
  ctx.fillStyle = '#b0a890';
  ctx.fillRect(CX - 7, CY - 14, 14, 16);
  ctx.fillStyle = '#6a4030';
  ctx.beginPath();
  ctx.moveTo(CX - 9, CY - 14);
  ctx.lineTo(CX, CY - 22);
  ctx.lineTo(CX + 9, CY - 14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#a09878';
  ctx.fillRect(CX - 17, CY - 8, 8, 12);
  ctx.fillStyle = '#6a4030';
  ctx.beginPath();
  ctx.moveTo(CX - 18, CY - 8);
  ctx.lineTo(CX - 13, CY - 14);
  ctx.lineTo(CX - 8, CY - 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#a09878';
  ctx.fillRect(CX + 9, CY - 8, 8, 12);
  ctx.fillStyle = '#6a4030';
  ctx.beginPath();
  ctx.moveTo(CX + 8, CY - 8);
  ctx.lineTo(CX + 13, CY - 14);
  ctx.lineTo(CX + 18, CY - 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3a2518';
  ctx.beginPath();
  ctx.arc(CX, CY + 2, 4, Math.PI, 0);
  ctx.lineTo(CX + 4, CY + 9);
  ctx.lineTo(CX - 4, CY + 9);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8a7a60';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(CX, CY - 22);
  ctx.lineTo(CX, CY - 28);
  ctx.stroke();
  ctx.fillStyle = '#c03030';
  ctx.beginPath();
  ctx.moveTo(CX, CY - 28);
  ctx.lineTo(CX + 7, CY - 26);
  ctx.lineTo(CX, CY - 24);
  ctx.closePath();
  ctx.fill();
}

function drawTownCenter(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#a89878';
  ctx.fillRect(CX - 12, CY - 3, 24, 12);
  ctx.fillStyle = '#8a7a5a';
  ctx.fillRect(CX - 14, CY - 5, 28, 3);
  ctx.fillStyle = '#b0a080';
  ctx.fillRect(CX - 4, CY - 16, 8, 12);
  ctx.fillStyle = '#6a4a30';
  ctx.beginPath();
  ctx.moveTo(CX - 5, CY - 16);
  ctx.lineTo(CX, CY - 22);
  ctx.lineTo(CX + 5, CY - 16);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3a2818';
  ctx.beginPath();
  ctx.arc(CX, CY - 11, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c8b898';
  for (const dx of [-8, -3, 3, 8]) ctx.fillRect(CX + dx - 1, CY - 3, 2, 12);
  ctx.fillStyle = '#4a3020';
  ctx.beginPath();
  ctx.arc(CX, CY + 3, 3, Math.PI, 0);
  ctx.lineTo(CX + 3, CY + 9);
  ctx.lineTo(CX - 3, CY + 9);
  ctx.closePath();
  ctx.fill();
}

/** Contact shadow, so a structure sits on the ground rather than floating. */
function drawGroundShadow(ctx: CanvasRenderingContext2D, rx: number) {
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath();
  ctx.ellipse(CX, CY + 9, rx, rx * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
}

const DRAW: Partial<Record<BuildingType, { fn: (ctx: CanvasRenderingContext2D) => void; shadow: number }>> = {
  [BuildingType.HOUSE]: { fn: drawHouse, shadow: 12 },
  [BuildingType.FARM]: { fn: drawFarmRows, shadow: 0 },
  [BuildingType.MINE]: { fn: drawMine, shadow: 13 },
  [BuildingType.BARRACKS]: { fn: drawBarracks, shadow: 14 },
  [BuildingType.CITY_CENTER]: { fn: drawCityCenter, shadow: 20 },
  [BuildingType.TOWN_CENTER]: { fn: drawTownCenter, shadow: 16 }
};

const cache = new Map<BuildingType, Texture>();

export function buildingTexture(type: BuildingType): Texture | null {
  const spec = DRAW[type];
  if (!spec) return null;
  let t = cache.get(type);
  if (!t) {
    const ctx = newCanvas();
    if (spec.shadow) drawGroundShadow(ctx, spec.shadow);
    spec.fn(ctx);
    t = Texture.from(ctx.canvas);
    cache.set(type, t);
  }
  return t;
}
