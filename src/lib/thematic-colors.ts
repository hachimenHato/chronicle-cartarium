import type { TerrainBiome } from '../../shared/cartography';
import type { GeographicCell } from '../../shared/geography';
import type { GeographicLayer } from '../../shared/map-layers';

/** Display pigment only; source-block colors and persisted biome identities stay unchanged. */
export const terrainLayerColors: Record<TerrainBiome, string> = {
  water: '#b5d6e2',
  grass: '#b4bd78',
  forest: '#738744',
  rainforest: '#3f6b38',
  taiga: '#6b7951',
  mountain: '#a48c76',
  hill: '#beaa71',
  plateau: '#b18d60',
  desert: '#e3bd78',
  savanna: '#cbbe69',
  swamp: '#929b55',
  tundra: '#c6bea2',
  snow: '#f4efdc',
  badlands: '#bd8865',
};
export function thematicRamp(
  value: number,
  min: number,
  max: number,
  from: number[],
  to: number[],
) {
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return `rgb(${from.map((n, i) => Math.round(n + (to[i] - n) * t)).join(' ')})`;
}

export type ClimateLayer = 'temperature' | 'precipitation';
export interface ClimateColorStop {
  value: number;
  color: string;
  label: string;
}
/** Fixed physical thresholds make maps comparable; never stretch a dry world into false wet colors. */
export const climateColorScales: Record<ClimateLayer, readonly ClimateColorStop[]> = {
  temperature: [
    { value: -25, color: '#597b9e', label: '−25℃' },
    { value: -10, color: '#91b6c8', label: '−10℃' },
    { value: 0, color: '#c7d9d5', label: '0℃' },
    { value: 10, color: '#e9e3c3', label: '10℃' },
    { value: 20, color: '#dfba77', label: '20℃' },
    { value: 30, color: '#cd8860', label: '30℃' },
    { value: 40, color: '#a64f42', label: '40+℃' },
  ],
  precipitation: [
    { value: 0, color: '#c69d65', label: '0' },
    { value: 250, color: '#e2c994', label: '250' },
    { value: 500, color: '#d1d3a6', label: '500' },
    { value: 1000, color: '#94b78b', label: '1000' },
    { value: 2000, color: '#5d9b95', label: '2000' },
    { value: 4000, color: '#3b7187', label: '4000' },
    { value: 6500, color: '#304e6a', label: '6500+' },
  ],
};
export function climateValueColor(value: number, layer: ClimateLayer) {
  const stops = climateColorScales[layer];
  if (value <= stops[0].value || !Number.isFinite(value)) return stops[0].color;
  for (let i = 1; i < stops.length; i++) {
    if (value <= stops[i].value) {
      const rgb = (hex: string) => [1, 3, 5].map((j) => parseInt(hex.slice(j, j + 2), 16));
      return thematicRamp(
        value,
        stops[i - 1].value,
        stops[i].value,
        rgb(stops[i - 1].color),
        rgb(stops[i].color),
      );
    }
  }
  return stops[stops.length - 1].color;
}
export function climateLegendItems(layer: ClimateLayer) {
  return climateColorScales[layer].map((s) => ({
    id: `${layer}-${s.value}`,
    label: s.label + (layer === 'precipitation' ? ' mm／年' : ''),
    color: s.color,
  }));
}
export function thematicCellColor(c: GeographicCell, layer: GeographicLayer) {
  if (layer === 'temperature' || layer === 'precipitation')
    return climateValueColor(c[layer], layer);
  return terrainLayerColors[c.biome];
}

/** A narrow blend band softens cell seams without blurring coastlines or map ink. */
export function thematicBlendRadius(width: number, height: number, cells: number) {
  const unit = Math.max(width, height) / 1000;
  return Math.max(
    unit * 0.8,
    Math.min(unit * 14, Math.sqrt((width * height) / Math.max(1, cells)) * 0.23),
  );
}
