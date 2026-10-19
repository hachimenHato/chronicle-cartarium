import type { AtlasMap } from '../../shared/model';
import type { GeographicSettings } from '../../shared/geography';
import { defaultGeographicSettings, validGeographicSettings } from '../../shared/geography';
import type { ElevationSettings, SketchGenerationV2, TerrainBiome } from '../../shared/cartography';
import type { GeneratedMapSnapshot } from '../../shared/generated-map';
import {
  applyGeographicFields,
  climateBiome,
  geographicCoastDistance,
  geographicClimateVariation,
} from './geography-fields';
import { generateGeographicClimate } from './geography-climate';
import type { SketchCell } from './sketch-generation-v1';
import { ELEVATION_SCALE } from './elevation';
import { mapSizePresets } from './map-scale';
import type { WorldExtent } from '../../shared/world-extent';

export interface ClimatePreviewOptions {
  kind?: AtlasMap['kind'];
  seed?: number;
  width?: number;
  height?: number;
  scaleKm?: number;
  preset?: ElevationSettings['preset'];
  settings?: GeographicSettings;
  elevation?: GeneratedMapSnapshot['elevation'];
  source?: 'random' | 'sketch';
}
export interface ClimatePreviewCell {
  land: boolean;
  elevation: number;
  temperature: number;
  precipitation: number;
  biome: TerrainBiome;
}
/** Coarse preview reuses the production terrain and annual climate model, without symbols or navigation. */
export function createClimatePreview(extent: WorldExtent, options: ClimatePreviewOptions = {}) {
  const kind = options.kind ?? 'world',
    preset = mapSizePresets[kind];
  const width = options.width ?? preset.width,
    height = options.height ?? preset.height;
  const columns = 64,
    rows = Math.max(12, Math.min(64, Math.round((columns * height) / width)));
  const seed = options.seed ?? 17391;
  const settings = { ...(options.settings ?? defaultGeographicSettings(kind)), ...extent };
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !validGeographicSettings(settings)
  )
    throw new Error('请检查地图尺寸与气候参数。');
  const cells: SketchCell[] = Array.from({ length: columns * rows }, (_, i) => ({
    x: (((i % columns) + 0.5) * width) / columns,
    y: ((Math.floor(i / columns) + 0.5) * height) / rows,
    land: false,
    biome: 'water',
    elevation: 0,
    drainageElevation: 0,
    downstream: -1,
    moisture: 0.5,
    slope: 0,
    accumulation: 0,
  }));
  const field = new Float64Array(cells.length);
  let climate: { temperature: Float32Array; precipitation: Float32Array };
  const surface = options.elevation;
  if (surface) {
    // Nearest cell resampling preserves narrow coasts rather than averaging sea into uplands.
    for (const c of cells) {
      const x = Math.min(surface.columns - 1, Math.floor((c.x / width) * surface.columns));
      const y = Math.min(surface.rows - 1, Math.floor((c.y / height) * surface.rows));
      c.elevation = surface.values[y * surface.columns + x] / ELEVATION_SCALE;
      c.land = c.elevation > 0;
    }
    field.set(geographicCoastDistance(cells, columns, rows, width, height));
    climate = generateGeographicClimate({
      cells,
      coastDistance: field,
      columns,
      rows,
      width,
      height,
      coverageKm: options.scaleKm ?? preset.scaleKm,
      settings,
      variation: (x, y) => geographicClimateVariation(settings, seed, x, y),
    });
  } else {
    const recipe: SketchGenerationV2 = {
      version: 2,
      seed,
      detail: 'standard',
      climate: 'temperate',
      settlements: 0,
      rivers: false,
      routes: false,
      geography: { ...settings, source: 'random' },
      elevation: {
        version: 1,
        preset: options.preset ?? 'continent',
        seed,
        relief: 1,
        seaLevel: 0,
        strokes: [],
      },
    };
    climate = applyGeographicFields({
      cells,
      field,
      columns,
      rows,
      width,
      height,
      kind,
      scaleKm: options.scaleKm,
      settings: recipe,
    });
  }
  const result: ClimatePreviewCell[] = cells.map((c, i) => ({
    land: c.land,
    elevation: c.elevation * ELEVATION_SCALE,
    temperature: climate.temperature[i],
    precipitation: climate.precipitation[i],
    biome: climateBiome(
      c.land,
      c.elevation * ELEVATION_SCALE,
      climate.temperature[i],
      climate.precipitation[i],
    ),
  }));
  const land = result.filter((c) => c.land),
    samples = land.length ? land : result;
  const range = (key: 'temperature' | 'precipitation') => ({
    min: Math.min(...samples.map((c) => c[key])),
    max: Math.max(...samples.map((c) => c[key])),
    mean: samples.reduce((sum, c) => sum + c[key], 0) / samples.length,
  });
  const biomes = new Map<TerrainBiome, number>();
  for (const c of land) biomes.set(c.biome, (biomes.get(c.biome) ?? 0) + 1);
  return {
    columns,
    rows,
    cells: result,
    temperature: range('temperature'),
    precipitation: range('precipitation'),
    landFraction: land.length / result.length,
    biomes: [...biomes]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([biome, count]) => ({ biome, share: count / land.length })),
    usesSavedTerrain: !!surface,
  };
}
