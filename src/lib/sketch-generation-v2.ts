import type {
  MapObject,
  MapPoint,
  MapRegion,
  SketchGenerationSettings,
  TerrainBiome,
} from '../../shared/cartography';
import { MAP_EDITOR_LIMITS } from '../../shared/cartography';
import { distanceToSegment, pointInPolygon, seededRandom } from './terrain';
import { parchmentPaper, parchmentSea } from './map-palette';
import {
  applyElevation,
  elevationField,
  type ElevationField,
  type TerrainHeightInfluence,
} from './elevation';
import { makeClassicalRelief } from './classical-relief';
import type { AtlasMap } from '../../shared/model';

import type {
  SketchCell,
  SketchDiagnostics,
  SketchMapResult,
  SketchMapStats,
} from './sketch-generation-v1';
import { buildDrainage, generateRiverNetwork, generateRoadNetwork } from './sketch-networks';
import { mapDetailProfile } from './map-scale';
import { settlementPlan } from './settlements';
import { surroundingBuildingCount, surroundingBuildingSites } from './settlement-surroundings';
import type { GeneratedGeography } from '../../shared/geography';
import {
  applyGeographicFields,
  applyGeographicRunoff,
  climateBiome,
  type GeographicFields,
  type GeographicFieldContext,
} from './geography-fields';
import { buildGeographicMesh } from './geography-mesh';
import { buildGeographicNavigation, preferCoastalSettlements } from './geography-navigation';
import { buildSketchShapeField } from './sketch-shapes';
export interface RefinedSketchDiagnostics extends SketchDiagnostics {
  riverChannels: ReturnType<typeof generateRiverNetwork>['channels'];
  roadPaths: MapPoint[][];
  bridges: ReturnType<typeof generateRoadNetwork>['bridges'];
}
const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const smooth = (n: number) => {
  n = clamp(n);
  return n * n * (3 - 2 * n);
};
const round = (n: number) => Math.round(n * 1000) / 1000;
function noise(x: number, y: number, seed: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    tx = smooth(x - ix),
    ty = smooth(y - iy);
  const hash = (a: number, b: number) => {
    let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  return (
    (hash(ix, iy) * (1 - tx) + hash(ix + 1, iy) * tx) * (1 - ty) +
    (hash(ix, iy + 1) * (1 - tx) + hash(ix + 1, iy + 1) * tx) * ty
  );
}

/** A versioned, entirely local generation pipeline. Input regions are never modified. */
export function generateSketchMapV2(
  regions: MapRegion[],
  width: number,
  height: number,
  settings: Extract<SketchGenerationSettings, { version: 2 }>,
  scaleKm?: number,
  kind?: AtlasMap['kind'],
): SketchMapResult & {
  diagnostics: RefinedSketchDiagnostics;
  elevation?: ElevationField;
  geography?: GeneratedGeography;
} {
  if (settings.version !== 2) throw new Error('不支持这个地图生成版本。');
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error('地图尺寸无效。');
  if (regions.length > MAP_EDITOR_LIMITS.regions)
    throw new Error('色块超过 200 个，请先整理区域。');
  if (regions.some((r) => !r.points.length || r.points.length > MAP_EDITOR_LIMITS.points))
    throw new Error('色块控制点数量无效。');
  const visible = regions.filter((r) => r.visible);
  const complexity = visible.reduce((sum, r) => sum + r.points.length, 0);
  const detailProfile = mapDetailProfile(scaleKm, kind);
  const plannedSettlements = settlementPlan(settings);
  const requestedSettlements = plannedSettlements.length;
  const { featureScale } = detailProfile;
  const targetResolution = Math.min(
    512,
    { standard: 192, high: 288, ultra: 384 }[settings.detail] *
      (scaleKm === undefined ? 1 : Math.max(1, Math.sqrt(Math.max(width, height) / 1000))),
  );
  const resolution = Math.max(
    128,
    Math.round(targetResolution / Math.max(1, Math.sqrt(complexity / 6000))),
  );
  const gridUnit = Math.max(width, height) / resolution;
  const unit = (Math.max(width, height) / 160) * featureScale;
  const columns = Math.max(8, Math.round(width / gridUnit)),
    rows = Math.max(8, Math.round(height / gridUnit));
  const cellWidth = width / columns,
    cellHeight = height / rows;
  const cells: SketchCell[] = [];
  const diagnostics: RefinedSketchDiagnostics = {
    columns,
    rows,
    cellWidth,
    cellHeight,
    cells,
    rivers: [],
    routes: [],
    settlements: [],
    vegetation: [],
    riverChannels: [],
    roadPaths: [],
    bridges: [],
  };
  const stats: SketchMapStats = { landCells: 0, rivers: 0, settlements: 0, roads: 0 };
  const objects: MapObject[] = [];
  let geographicFields: GeographicFields | undefined;
  const geographicContext: GeographicFieldContext = {
    cells,
    field: new Float64Array(0),
    columns,
    rows,
    width,
    height,
    kind: kind ?? 'region',
    scaleKm,
    settings,
  };
  const empty = () => ({
    objects,
    stats,
    diagnostics,
    elevation: cells.length ? elevationField(cells, columns, rows, width, height) : undefined,
    ...(geographicFields
      ? { geography: buildGeographicMesh(geographicContext, geographicFields) }
      : {}),
  });
  if (!visible.some((r) => r.biome !== 'water') && !settings.elevation && !settings.geography)
    return empty();
  const seed = settings.seed >>> 0,
    random = seededRandom(seed);
  const heightSeed = settings.elevation?.seed ?? seed;
  const point = (x: number, y: number) => ({
    x: settings.geography ? Math.round(clamp(x, 0, width) * 100) / 100 : round(clamp(x, 0, width)),
    y: settings.geography
      ? Math.round(clamp(y, 0, height) * 100) / 100
      : round(clamp(y, 0, height)),
  });
  const neighbors = (i: number, diagonal = true) => {
    const x = i % columns,
      y = Math.floor(i / columns),
      result: number[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!(dx || dy) || (!diagonal && dx && dy)) continue;
        if (x + dx >= 0 && x + dx < columns && y + dy >= 0 && y + dy < rows)
          result.push((y + dy) * columns + x + dx);
      }
    return result;
  };
  const prepared = visible.map((r) => {
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity;
    for (const p of r.points) {
      left = Math.min(left, p.x);
      right = Math.max(right, p.x);
      top = Math.min(top, p.y);
      bottom = Math.max(bottom, p.y);
    }
    const margin =
      r.geometry === 'brush'
        ? r.width * (settings.elevation && settings.elevation.preset !== 'sketch' ? 1.08 : 0.8)
        : settings.elevation && settings.elevation.preset !== 'sketch'
          ? Math.max(unit * 5, r.width * 0.58)
          : unit * 5;
    return {
      r,
      left: left - margin,
      right: right + margin,
      top: top - margin,
      bottom: bottom + margin,
    };
  });
  const signedDistance = (p: MapPoint, r: MapRegion) => {
    let distance = Math.hypot(p.x - r.points[0].x, p.y - r.points[0].y);
    const n = r.geometry === 'polygon' ? r.points.length : r.points.length - 1;
    for (let i = 0; i < n; i++)
      distance = Math.min(
        distance,
        distanceToSegment(p, r.points[i], r.points[(i + 1) % r.points.length]),
      );
    return r.geometry === 'brush'
      ? r.width / 2 - distance
      : pointInPolygon(p, r.points)
        ? distance
        : -distance;
  };
  const field = new Float64Array(columns * rows);
  const density = new Float64Array(columns * rows);
  const intent = new Int16Array(columns * rows).fill(-1);
  const interpretedSketch =
    settings.geography?.source === 'sketch'
      ? buildSketchShapeField(
          visible,
          columns,
          rows,
          width,
          height,
          seed,
          settings.geography.sketchMode ?? 'balanced',
          settings.geography.roughness,
        )
      : undefined;
  const terrainHeight: TerrainHeightInfluence | undefined =
    settings.elevation && settings.elevation.preset !== 'sketch'
      ? {
          land: new Float64Array(columns * rows),
          water: new Float64Array(columns * rows),
          uplift: new Float64Array(columns * rows),
          plateau: new Float64Array(columns * rows),
          wetland: new Float64Array(columns * rows),
        }
      : undefined;
  // Evaluate the ordered sketch as a signed land field. Directly painted water
  // wins over coastline noise; unpainted space remains ocean.
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const x = (column + 0.5) * cellWidth,
        y = (row + 0.5) * cellHeight,
        i = row * columns + column;
      const p = { x, y };
      let land = -unit * 8,
        owner = -1,
        mountain = 0,
        coldUplift = 0,
        plateauWeight = 0,
        wetlandWeight = 0;
      if (!interpretedSketch)
        prepared.forEach(({ r, left, right, top, bottom }, index) => {
          if (x < left || x > right || y < top || y > bottom) return;
          const d = signedDistance(p, r);
          const amplitude = Math.min(r.width * 0.12, unit * 5.2) * r.roughness;
          const texture =
            ((noise(x / (unit * 6), y / (unit * 6), seed ^ r.seed) - 0.5) * 1.25 +
              (noise(x / (unit * 1.7), y / (unit * 1.7), r.seed + seed + 31) - 0.5) * 0.48 +
              (noise(x / (unit * 0.6), y / (unit * 0.6), r.seed + seed + 59) - 0.5) * 0.16) *
            amplitude;
          if (r.biome === 'water') land = Math.min(land, -d + Math.min(0, texture));
          else land = Math.max(land, d + texture);
          if (d >= 0) owner = index;
          if (terrainHeight) {
            const weight = smooth(d / Math.max(unit * 2, r.width * 0.18));
            if (r.biome === 'water') {
              terrainHeight.water[i] = Math.max(terrainHeight.water[i], weight);
              terrainHeight.land[i] *= 1 - weight;
            } else {
              terrainHeight.land[i] = Math.max(terrainHeight.land[i], weight);
              terrainHeight.water[i] *= 1 - weight;
            }
          }
          const interior = smooth(d / Math.max(unit * 2, r.width * 0.3));
          if (r.biome === 'snow' || r.biome === 'tundra')
            coldUplift = Math.max(coldUplift, interior * (r.biome === 'snow' ? 0.16 : 0.07));
          if (r.biome === 'plateau') plateauWeight = Math.max(plateauWeight, interior);
          if (r.biome === 'swamp') wetlandWeight = Math.max(wetlandWeight, interior);
          if (['mountain', 'hill', 'plateau', 'badlands'].includes(r.biome)) {
            const intensity =
              r.biome === 'mountain'
                ? 1
                : r.biome === 'plateau'
                  ? 0.68
                  : r.biome === 'badlands'
                    ? 0.48
                    : 0.35;
            const regionSeed = heightSeed ^ r.seed;
            const wide = noise(x / (unit * 13), y / (unit * 13), regionSeed + 99);
            const fine =
              1 - Math.abs(noise(x / (unit * 1.3), y / (unit * 1.3), regionSeed + 927) * 2 - 1);
            const crest =
              1 - Math.abs(noise(x / (unit * 4.4), y / (unit * 4.4), regionSeed + 915) * 2 - 1);
            const peaks =
              0.28 +
              wide * 0.22 +
              crest * 0.25 +
              fine * 0.09 +
              noise(x / (unit * 3), y / (unit * 3), regionSeed + 48) * 0.12;
            mountain = Math.max(
              mountain,
              smooth((d + r.width * 0.58) / (r.width * 1.08)) *
                (0.82 + r.roughness * 0.5) *
                intensity *
                peaks,
            );
          }
        });
      if (interpretedSketch) {
        land = interpretedSketch.field[i];
        owner = interpretedSketch.intent[i];
        const localRelief =
          0.3 +
          noise(x / (unit * 13), y / (unit * 13), heightSeed + 99) * 0.28 +
          (1 - Math.abs(noise(x / (unit * 3), y / (unit * 3), heightSeed + 927) * 2 - 1)) * 0.2;
        mountain = interpretedSketch.uplift[i] * localRelief;
        coldUplift = interpretedSketch.cold[i];
        plateauWeight = interpretedSketch.plateau[i];
        wetlandWeight = interpretedSketch.wetland[i];
        if (terrainHeight) {
          terrainHeight.land[i] = smooth(land / Math.max(unit * 2, gridUnit * 2));
          terrainHeight.water[i] = smooth(-land / Math.max(unit * 2, gridUnit * 2));
        }
      }
      intent[i] = owner;
      density[i] = owner >= 0 ? visible[owner].density : 0.75;
      const biome = owner >= 0 ? visible[owner].biome : 'grass';
      const isLand = land > 0 && (Boolean(interpretedSketch) || biome !== 'water');
      field[i] = isLand ? land : Math.min(land, -0.001);
      const coastal = clamp(land / (unit * 10));
      // Lowland relief is shared across brush ownership boundaries. Each upland
      // source contributes a smoothly decaying height field, never a seeded cliff
      // simply because a forest stroke becomes the latest color owner.
      const relief = noise(x / (unit * 13), y / (unit * 13), heightSeed + 99);
      const rough = noise(x / (unit * 3), y / (unit * 3), heightSeed + 48);
      let elevation = isLand
        ? 0.025 + 0.16 * coastal + mountain + (relief * 0.16 + rough * 0.045) * coastal
        : -0.1;
      if (isLand) {
        elevation += coldUplift;
        elevation += (Math.min(0.62, elevation * 1.12) - elevation) * plateauWeight;
        elevation += (Math.min(elevation, 0.13 + coastal * 0.07) - elevation) * wetlandWeight;
      }
      if (terrainHeight) {
        terrainHeight.uplift[i] = mountain + coldUplift;
        terrainHeight.plateau[i] = plateauWeight;
        terrainHeight.wetland[i] = wetlandWeight;
      }
      const moisture = clamp(
        0.4 +
          (noise(x / (unit * 13), y / (unit * 13), seed + 253) - 0.5) * 0.45 +
          (settings.climate === 'dry' ? -0.24 : settings.climate === 'cold' ? 0.08 : 0.13),
      );
      cells.push({
        x,
        y,
        land: isLand,
        biome: isLand ? biome : 'water',
        elevation,
        drainageElevation: elevation,
        downstream: -1,
        moisture,
        slope: 0,
        accumulation: isLand ? 1 : 0,
      });
      if (isLand) stats.landCells++;
    }
  if (settings.elevation) {
    applyElevation(cells, field, columns, rows, width, height, settings.elevation, terrainHeight);
    stats.landCells = cells.reduce((n, c) => n + Number(c.land), 0);
  }
  if (settings.geography) {
    geographicContext.field = field;
    geographicContext.regions = visible;
    geographicContext.intent = intent;
    geographicFields = applyGeographicFields(geographicContext);
    stats.landCells = cells.reduce((n, c) => n + Number(c.land), 0);
  }
  if (!stats.landCells) {
    objects.push({
      id: `sketch2_${seed}_sea`,
      name: '海面',
      kind: 'polygon',
      points: [point(0, 0), point(width, 0), point(width, height), point(0, height)],
      color: parchmentSea,
      stroke: 'none',
      strokeWidth: 0,
      text: '',
      size: 16,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
    });
    return empty();
  }
  buildDrainage(cells, columns, rows);
  if (geographicFields) applyGeographicRunoff(cells, geographicFields);
  cells.forEach((c, i) => {
    if (!c.land) return;
    c.slope = Math.max(
      ...neighbors(i)
        .filter((n) => cells[n].land)
        .map((n) => (Math.abs(c.elevation - cells[n].elevation) * unit) / gridUnit),
      0,
    );
    c.moisture = clamp(
      c.moisture +
        Math.min(0.22, c.accumulation / (260 * (resolution / 128) ** 2)) +
        (neighbors(i).some((n) => !cells[n].land) ? 0.12 : 0),
    );
    const explicit = intent[i] >= 0 ? visible[intent[i]].biome : 'grass';
    if (geographicFields) {
      const temperature = geographicFields.temperature[i],
        rain = geographicFields.precipitation[i];
      c.biome = climateBiome(c.land, c.elevation * 6000, temperature, rain);
      // Sketch cover is an authoring constraint; thermally impossible woodland becomes taiga/tundra.
      if (intent[i] >= 0 && explicit !== 'grass' && explicit !== 'water') {
        if (['forest', 'taiga', 'rainforest'].includes(explicit))
          c.biome =
            temperature < 0
              ? 'tundra'
              : temperature < 9
                ? 'taiga'
                : explicit === 'rainforest' && temperature < 20
                  ? 'forest'
                  : explicit;
        else if (explicit === 'mountain' || explicit === 'hill' || explicit === 'plateau')
          c.biome = temperature < -8 ? 'snow' : explicit;
        else c.biome = explicit;
      }
      return;
    }
    // Template relief and painted cover are independent. Restore the author's
    // biome even where the template/height brush exposed a previously wet cell.
    // A raised water region instead becomes automatically classified new land.
    // Grass remains the generic land intent, classified by climate and height.
    if (explicit !== 'grass' && explicit !== 'water') {
      c.biome = explicit;
    } else {
      c.biome =
        c.elevation > 0.8
          ? 'snow'
          : settings.climate === 'cold'
            ? c.elevation > 0.52
              ? 'snow'
              : c.moisture > 0.56
                ? 'taiga'
                : 'tundra'
            : c.elevation > 0.58
              ? 'mountain'
              : c.elevation > 0.43
                ? 'hill'
                : c.moisture > 0.73
                  ? 'rainforest'
                  : c.moisture > 0.59
                    ? 'forest'
                    : c.moisture < 0.23
                      ? 'desert'
                      : c.moisture < 0.35
                        ? 'savanna'
                        : 'grass';
    }
  });
  const waterNetwork = settings.rivers
    ? generateRiverNetwork(
        cells,
        columns,
        rows,
        width,
        height,
        seed,
        settings.linework === 'organic' || Boolean(settings.geography),
        featureScale,
        { widthScale: Math.max(width, height) / 1000, maxChannels: detailProfile.riverLimit },
      )
    : {
        rivers: [],
        channels: [],
        riverCells: new Set<number>(),
        coordinates: new Map<number, MapPoint>(),
        crossings: undefined,
      };
  diagnostics.rivers = waterNetwork.rivers;
  diagnostics.riverChannels = waterNetwork.channels;
  const riverCells = waterNetwork.riverCells;
  stats.rivers = waterNetwork.channels.length;
  // Rank habitable sites, then use a map-scale separation so a large island does
  // not receive a pile of settlements on the same favorable coastal cell.
  const candidates = cells
    .map((c, i) => ({ c, i }))
    .filter(
      ({ c, i }) =>
        c.land &&
        !riverCells.has(i) &&
        c.elevation < 0.56 &&
        c.slope < 0.13 &&
        !['mountain', 'swamp', 'snow', 'badlands', 'plateau'].includes(c.biome) &&
        field[i] > unit * 1.5,
    )
    .map(({ c, i }) => ({
      i,
      score:
        (riverCells.has(i) || neighbors(i).some((n) => riverCells.has(n)) ? 3 : 0) +
        (field[i] < unit * 5 ? 1.2 : 0) +
        c.moisture * 1.4 -
        c.slope * 7 -
        c.elevation +
        noise(c.x / 18, c.y / 18, seed + 717) * 0.55,
    }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const spacing = Math.max(
    unit * 7,
    (Math.min(width, height) / (2.3 + Math.sqrt(Math.max(1, requestedSettlements)))) * featureScale,
  );
  for (const { i } of candidates) {
    if (diagnostics.settlements.length >= requestedSettlements) break;
    if (
      diagnostics.settlements.every(
        (n) => Math.hypot(cells[n].x - cells[i].x, cells[n].y - cells[i].y) >= spacing,
      )
    )
      diagnostics.settlements.push(i);
  }
  if (settings.geography?.ports) {
    diagnostics.settlements = preferCoastalSettlements(
      cells,
      columns,
      rows,
      diagnostics.settlements,
      plannedSettlements.slice(0, diagnostics.settlements.length).map((site) => site.kind),
      riverCells,
    );
  }
  stats.settlements = diagnostics.settlements.length;
  const roadNetwork = settings.routes
    ? generateRoadNetwork(
        cells,
        columns,
        rows,
        width,
        height,
        diagnostics.settlements,
        riverCells,
        seed,
        waterNetwork.coordinates,
        settings.linework === 'organic' || Boolean(settings.geography),
        waterNetwork.crossings,
        {
          extraConnections: Math.round(
            (diagnostics.settlements.length - 1) * detailProfile.extraRoadRatio,
          ),
        },
      )
    : { routes: [], paths: [], bridges: [] };
  diagnostics.routes = roadNetwork.routes;
  diagnostics.roadPaths = roadNetwork.paths;
  diagnostics.bridges = roadNetwork.bridges;
  stats.roads = roadNetwork.paths.length;
  let serial = 0;
  const add = (
    name: string,
    kind: MapObject['kind'],
    points: MapPoint[],
    style: Partial<MapObject> = {},
  ) => {
    if (points.length < (kind === 'polygon' ? 3 : kind === 'path' ? 2 : 1)) return;
    if (kind === 'path' && points.length > MAP_EDITOR_LIMITS.points) {
      for (let start = 0; start < points.length - 1; start += 1799)
        add(name, kind, points.slice(start, start + 1800), style);
      return;
    }
    if (points.length > MAP_EDITOR_LIMITS.points)
      throw new Error(`「${name}」生成轮廓有 ${points.length} 个控制点，超过上限。请简化色块。`);
    if (objects.length >= MAP_EDITOR_LIMITS.objects)
      throw new Error('生成内容过多，请减少区域或聚落。');
    objects.push({
      id: `sketch2_${seed}_${serial++}`,
      name,
      kind,
      points: points.map((p) => point(p.x, p.y)),
      text: '',
      color: 'none',
      stroke: 'none',
      strokeWidth: 0,
      size: 16,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      ...style,
    });
  };
  // Rendering is factored out so the grid never becomes visible square tiles.
  renderSketch({
    cells,
    field,
    density,
    columns,
    rows,
    cellWidth,
    cellHeight,
    width,
    height,
    unit,
    seed,
    random,
    diagnostics,
    waterNetwork,
    roadNetwork,
    add,
    objectCount: () => objects.length,
    mountainScale: detailProfile.mountainScale,
    plannedSettlements,
    typedSettlements: Boolean(settings.settlementCounts),
    mapKind: kind,
    objectBudget: settings.geography ? 3000 : MAP_EDITOR_LIMITS.objects,
    compactArtwork: Boolean(settings.geography),
  });
  const sites = diagnostics.settlements.map((at, index) => ({
    id: plannedSettlements[index].id,
    kind: plannedSettlements[index].kind,
    name: plannedSettlements[index].name,
    ...(settings.settlementLinks?.[plannedSettlements[index].id]
      ? { entityId: settings.settlementLinks[plannedSettlements[index].id] }
      : {}),
    x: cells[at].x,
    y: cells[at].y,
  }));
  geographicContext.settlements = sites;
  geographicContext.riverChannels = diagnostics.riverChannels;
  const surface = elevationField(cells, columns, rows, width, height);
  const geography = geographicFields
    ? buildGeographicMesh(geographicContext, geographicFields)
    : undefined;
  if (geography && settings.geography?.ports)
    Object.assign(geography, buildGeographicNavigation(geography, sites, seed, surface));
  return {
    objects,
    stats,
    diagnostics,
    elevation: surface,
    ...(geography ? { geography } : {}),
    sites,
  };
}

export const elevationBands = [
  { level: -3000, color: '#66888e' },
  { level: -1000, color: '#93b3b4' },
  { level: 0, color: '#b5c69b' },
  { level: 250, color: '#c9d1a0' },
  { level: 750, color: '#e0d5a4' },
  { level: 1500, color: '#d8bd91' },
  { level: 2500, color: '#bc997c' },
  { level: 3500, color: '#9d8071' },
  { level: 4500, color: '#d1c4b0' },
  { level: 5500, color: '#f0eadd' },
];
/** A clean cartographic height view, exported as real contour polygons rather than a screenshot. */
export function buildElevationArtwork(field: ElevationField): MapObject[] {
  const { columns, rows, width, height, values } = field,
    dx = width / columns,
    dy = height / rows;
  const scalar = Float64Array.from(values),
    out: MapObject[] = [];
  const add = (
    name: string,
    kind: MapObject['kind'],
    points: MapPoint[],
    style: Partial<MapObject>,
  ) => {
    if (kind === 'path' && points.length > 1800) {
      for (let i = 0; i < points.length - 1; i += 1799)
        add(name, kind, points.slice(i, i + 1800), style);
      return;
    }
    out.push({
      id: `elevation_${out.length}`,
      name,
      kind,
      points: points.map((p) => ({ x: clamp(p.x, 0, width), y: clamp(p.y, 0, height) })),
      text: '',
      color: 'none',
      stroke: 'none',
      strokeWidth: 0,
      size: 12,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      ...style,
    });
  };
  add(
    '海拔底色',
    'polygon',
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    { color: elevationBands[0].color },
  );
  for (const { level, color } of elevationBands.slice(1)) {
    if (field.max < level) continue;
    const rings = contours(scalar, columns, rows, dx, dy, level);
    for (const points of fillRings(rings)) add(`${level} 米色带`, 'polygon', points, { color });
    for (const ring of rings)
      if (Math.abs(area(ring)) > dx * dy * 3) {
        add(`${level} 米等高线`, 'path', [...ring, ring[0]], {
          stroke: level === 0 ? '#385759' : '#5d5547',
          strokeWidth: level === 0 ? 0.85 : 0.45,
          opacity: level === 0 ? 0.8 : 0.4,
        });
      }
  }
  return out;
}

interface RenderContext {
  cells: SketchCell[];
  field: Float64Array;
  density: Float64Array;
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  width: number;
  height: number;
  unit: number;
  seed: number;
  random: () => number;
  diagnostics: SketchDiagnostics;
  waterNetwork: ReturnType<typeof generateRiverNetwork>;
  roadNetwork: ReturnType<typeof generateRoadNetwork>;
  objectCount: () => number;
  mountainScale: number;
  plannedSettlements: ReturnType<typeof settlementPlan>;
  typedSettlements?: boolean;
  mapKind?: AtlasMap['kind'];
  objectBudget: number;
  compactArtwork: boolean;
  add: (
    name: string,
    kind: MapObject['kind'],
    points: MapPoint[],
    style?: Partial<MapObject>,
  ) => void;
}

/** Marching triangles interpolate cell-center samples; chains are closed outside
 * the map before clipping, so coastlines at the viewport boundary remain filled. */
function contours(
  values: Float64Array,
  columns: number,
  rows: number,
  dx: number,
  dy: number,
  threshold: number,
  detailTolerance = 0.12,
) {
  const links = new Map<string, { p: MapPoint; edges: { key: string; id: number }[] }>();
  let serial = 0;
  const value = (x: number, y: number) =>
    x < 0 || y < 0 || x >= columns || y >= rows
      ? threshold - Math.max(1, Math.abs(threshold))
      : values[y * columns + x];
  const key = (p: MapPoint) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`;
  const edge = (a: MapPoint, b: MapPoint) => {
    const ka = key(a),
      kb = key(b);
    if (ka === kb) return;
    if (!links.has(ka)) links.set(ka, { p: a, edges: [] });
    if (!links.has(kb)) links.set(kb, { p: b, edges: [] });
    links.get(ka)!.edges.push({ key: kb, id: serial });
    links.get(kb)!.edges.push({ key: ka, id: serial++ });
  };
  for (let y = -1; y < rows; y++)
    for (let x = -1; x < columns; x++) {
      const samples = [value(x, y), value(x + 1, y), value(x + 1, y + 1), value(x, y + 1)];
      if (samples.every((v) => v > threshold) || samples.every((v) => v < threshold)) continue;
      const corners = [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
      ].map(([a, b], i) => ({
        p: { x: (a + 0.5) * dx, y: (b + 0.5) * dy },
        v: samples[i] - threshold + 1e-10,
      }));
      for (const triangle of [
        [0, 1, 2],
        [0, 2, 3],
      ]) {
        const crossing: MapPoint[] = [];
        for (let k = 0; k < 3; k++) {
          const a = corners[triangle[k]],
            b = corners[triangle[(k + 1) % 3]];
          if (a.v > 0 === b.v > 0) continue;
          const t = a.v / (a.v - b.v);
          crossing.push({ x: a.p.x + (b.p.x - a.p.x) * t, y: a.p.y + (b.p.y - a.p.y) * t });
        }
        if (crossing.length === 2) edge(crossing[0], crossing[1]);
      }
    }
  const used = new Set<number>(),
    rings: MapPoint[][] = [];
  for (const [start, node] of links)
    for (const first of node.edges) {
      if (used.has(first.id)) continue;
      const ring: MapPoint[] = [node.p];
      let at = start,
        next = first;
      for (let n = 0; n <= serial; n++) {
        used.add(next.id);
        at = next.key;
        if (at === start) break;
        const current = links.get(at)!;
        ring.push(current.p);
        const following = current.edges.find((e) => !used.has(e.id));
        if (!following) break;
        next = following;
      }
      if (at !== start || ring.length < 3) continue;
      // Remove sampling-level corners while keeping peninsulas and lake holes.
      const simple = ring.filter(
        (p, i) =>
          distanceToSegment(
            p,
            ring[(i + ring.length - 1) % ring.length],
            ring[(i + 1) % ring.length],
          ) >
            Math.min(dx, dy) * 0.045 || i % 4 === 0,
      );
      if (simple.length < 3 || Math.abs(area(simple)) < dx * dy * 0.65) continue;
      const rounded: MapPoint[] = [];
      for (let i = 0; i < simple.length; i++) {
        const a = simple[i],
          b = simple[(i + 1) % simple.length];
        rounded.push(
          { x: a.x * 0.82 + b.x * 0.18, y: a.y * 0.82 + b.y * 0.18 },
          { x: a.x * 0.18 + b.x * 0.82, y: a.y * 0.18 + b.y * 0.82 },
        );
      }
      let split = 1;
      for (let i = 2; i < rounded.length; i++)
        if (
          Math.hypot(rounded[i].x - rounded[0].x, rounded[i].y - rounded[0].y) >
          Math.hypot(rounded[split].x - rounded[0].x, rounded[split].y - rounded[0].y)
        )
          split = i;
      const tolerance = Math.min(dx, dy) * detailTolerance;
      const simplified = [
        ...simplifyLine(rounded.slice(0, split + 1), tolerance).slice(0, -1),
        ...simplifyLine([...rounded.slice(split), rounded[0]], tolerance).slice(0, -1),
      ];
      rings.push(simplified.length >= 3 ? simplified : rounded);
    }
  return rings;
}
function area(points: MapPoint[]) {
  return (
    points.reduce((n, p, i) => {
      const q = points[(i + 1) % points.length];
      return n + p.x * q.y - q.x * p.y;
    }, 0) / 2
  );
}
function simplifyLine(points: MapPoint[], tolerance: number) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const pending: [number, number][] = [[0, points.length - 1]];
  while (pending.length) {
    const [start, end] = pending.pop()!;
    let greatest = tolerance,
      index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i], points[start], points[end]);
      if (d > greatest) {
        greatest = d;
        index = i;
      }
    }
    if (index >= 0) {
      keep[index] = 1;
      pending.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
function simplifyRing(points: MapPoint[], tolerance: number) {
  let split = 1;
  for (let i = 2; i < points.length; i++) {
    if (
      Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y) >
      Math.hypot(points[split].x - points[0].x, points[split].y - points[0].y)
    )
      split = i;
  }
  const result = [
    ...simplifyLine(points.slice(0, split + 1), tolerance).slice(0, -1),
    ...simplifyLine([...points.slice(split), points[0]], tolerance).slice(0, -1),
  ];
  return result.length >= 3 ? result : points;
}
function fillRings(rings: MapPoint[][]): MapPoint[][] {
  const sorted = [...rings].sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  const groups: { outer: MapPoint[]; holes: MapPoint[][] }[] = [];
  sorted.forEach((ring, i) => {
    const depth = sorted.slice(0, i).filter((parent) => pointInPolygon(ring[0], parent)).length;
    if (!(depth % 2))
      groups.push({ outer: area(ring) > 0 ? ring : [...ring].reverse(), holes: [] });
    else {
      const group = [...groups].reverse().find((g) => pointInPolygon(ring[0], g.outer));
      group?.holes.push(area(ring) < 0 ? ring : [...ring].reverse());
    }
  });
  return groups.map(({ outer, holes }) => {
    // Preserve every ring and its winding while budgeting a compound fill.
    // Bridges must be added after simplification: simplifying a bridged polygon
    // would turn zero-area connectors into visible wedges across lakes.
    const count = () => outer.length + holes.reduce((n, h) => n + h.length + 2, 0);
    const originalOuter = outer,
      originalHoles = holes;
    let tolerance = 0.15;
    for (let attempt = 0; count() > MAP_EDITOR_LIMITS.points && attempt < 12; attempt++) {
      outer = simplifyRing(originalOuter, tolerance);
      holes = originalHoles.map((h) => simplifyRing(h, tolerance));
      tolerance *= 1.6;
    }
    const joined = [...outer];
    for (const hole of holes) {
      let a = 0,
        b = 0,
        best = Infinity;
      for (let i = 0; i < joined.length; i++)
        for (let j = 0; j < hole.length; j++) {
          const d = (joined[i].x - hole[j].x) ** 2 + (joined[i].y - hole[j].y) ** 2;
          if (d < best) {
            a = i;
            b = j;
            best = d;
          }
        }
      const loop = [...hole.slice(b), ...hole.slice(0, b), hole[b], joined[a]];
      joined.splice(a + 1, 0, ...loop);
    }
    return joined;
  });
}

function renderSketch(context: RenderContext) {
  const {
    add,
    width,
    height,
    cells,
    field,
    density,
    columns,
    rows,
    cellWidth: dx,
    cellHeight: dy,
    unit,
    seed,
    random,
    diagnostics,
    waterNetwork,
    roadNetwork,
  } = context;
  const at = (p: MapPoint) =>
    clamp(Math.floor(p.y / dy), 0, rows - 1) * columns +
    clamp(Math.floor(p.x / dx), 0, columns - 1);
  const trace = (values: Float64Array, level: number) =>
    values.some((v) => v >= level)
      ? contours(values, columns, rows, dx, dy, level, context.compactArtwork ? 0.25 : 0.12)
      : [];
  const surface = (
    name: string,
    values: Float64Array,
    level: number,
    color: string,
    opacity = 1,
    blur = 0,
  ) => {
    const rings = trace(values, level).filter(
      (ring) =>
        (!name.endsWith('坡面') || Math.abs(area(ring)) >= unit * unit * 0.65) &&
        (!context.compactArtwork || Math.abs(area(ring)) >= dx * dy * 1.4),
    );
    fillRings(rings).forEach((ring) => add(name, 'polygon', ring, { color, opacity, blur }));
    return rings;
  };
  add(
    '海面',
    'polygon',
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    { color: parchmentSea },
  );
  const coast = trace(field, 0);
  // Separate strokes are essential: a lake hole must not create a visible bridge.
  for (const ring of coast)
    add('沿岸浅海', 'path', [...ring, ring[0]], {
      stroke: '#eee0bc',
      strokeWidth: unit * 1.5,
      opacity: 0.48,
      blur: unit * 0.18,
    });
  // Follow the signed shoreline field rather than scaling the land polygon:
  // bays, islands and lake holes retain their own nested engraved waterlines.
  for (const [distance, opacity] of [
    [0.65, 0.32],
    [1.3, 0.21],
    [2.1, 0.13],
  ] as const)
    for (const ring of trace(field, -unit * distance))
      add('沿岸水纹', 'path', [...ring, ring[0]], {
        stroke: '#78694f',
        strokeWidth: unit * 0.045,
        opacity,
      });
  fillRings(coast).forEach((ring) => add('大陆', 'polygon', ring, { color: parchmentPaper }));
  const heights = Float64Array.from(cells, (c, i) => (c.land ? c.elevation : 0));
  const fertility = Float64Array.from(cells, (c, i) =>
    c.land
      ? clamp(c.moisture - (c.elevation > 0.55 ? 0.18 : 0)) * smooth(field[i] / (unit * 1.8))
      : 0,
  );
  for (const [level, color, opacity] of [
    [0.15, '#daceaa', 0.4],
    [0.25, '#c8c5a0', 0.36],
    [0.4, '#b5b792', 0.32],
    [0.52, '#a5aa89', 0.34],
  ] as const)
    surface('地表过渡', fertility, level, color, opacity * 0.85, unit * 0.45);
  for (const [level, color] of [
    [0.34, '#c9bda0'],
    [0.45, '#b9aa8d'],
    [0.56, '#a7987e'],
    [0.67, '#c3b89e'],
    [0.8, '#e6dec8'],
  ] as const)
    surface('高程地形', heights, level, color, 0.085, unit * 0.1);
  const lighting = Float64Array.from(cells, (c, i) => {
    if (
      !c.land ||
      c.elevation < 0.35 ||
      i < columns ||
      i >= cells.length - columns ||
      i % columns === 0 ||
      i % columns === columns - 1
    )
      return 0;
    return (
      ((((cells[i + 1].elevation - cells[i - 1].elevation) * unit) / dx) * 0.8 +
        (((cells[i + columns].elevation - cells[i - columns].elevation) * unit) / dy) * 0.6) *
      smooth((c.elevation - 0.3) / 0.25)
    );
  });
  for (const level of [0.03, 0.065, 0.11]) {
    surface('背光坡面', lighting, level, '#776249', 0.04, unit * 0.1);
    surface(
      '迎光坡面',
      Float64Array.from(lighting, (v) => -v),
      level,
      '#f5eacc',
      0.045,
      unit * 0.14,
    );
  }
  const terrainTints: Partial<Record<TerrainBiome, string>> = {
    desert: '#d8bb80',
    swamp: '#a2ad94',
    snow: '#efe8d5',
    hill: '#bbb99a',
    plateau: '#bdaa8a',
    taiga: '#95a28b',
    rainforest: '#939e76',
    savanna: '#cebe8d',
    tundra: '#b9baa4',
    badlands: '#bf9b7b',
  };
  for (const [biome, color] of Object.entries(terrainTints)) {
    const values = Float64Array.from(cells, (c, i) =>
      c.land && c.biome === biome
        ? smooth(field[i] / (unit * 1.5)) *
          (0.72 + noise(c.x / (unit * 3), c.y / (unit * 3), seed + 64) * 0.28)
        : 0,
    );
    surface('地貌覆盖 · ' + biome, values, 0.35, color, 0.42, unit * 0.55);
    surface('地貌纹理 · ' + biome, values, 0.84, color, 0.16, unit * 0.28);
  }
  // Fine terrain contour ink adds scale without replacing the continuous shading.
  for (const level of [0.4, 0.48, 0.56, 0.64, 0.72, 0.8, 0.88]) {
    for (const ring of trace(heights, level)) {
      if (Math.abs(area(ring)) < unit * unit * 2.5) continue;
      add('山地等高细线', 'path', [...ring, ring[0]], {
        stroke: '#705a3c',
        strokeWidth: unit * 0.045,
        opacity: level > 0.75 ? 0.07 : 0.11,
      });
    }
  }
  // Slope shading and hachures suggest connected ridges instead of repeated
  // identical triangular mountain stamps. Marks thin toward flat lowlands.
  let hachures = 0;
  const samplingArea = (dx * dy) / (unit * unit);
  for (let row = 1; row < rows - 1; row++)
    for (let column = 1; column < columns - 1; column++) {
      const i = row * columns + column,
        c = cells[i];
      if (!c.land || c.elevation < 0.34 || field[i] < unit * 2) continue;
      const gx = ((cells[i + 1].elevation - cells[i - 1].elevation) * unit) / dx,
        gy = ((cells[i + columns].elevation - cells[i - columns].elevation) * unit) / dy;
      const gradient = Math.hypot(gx, gy);
      if (
        gradient < 0.022 ||
        hachures >= (context.compactArtwork ? 160 : 1100) ||
        random() > density[i] * 0.6 * samplingArea
      )
        continue;
      hachures++;
      const x = c.x + (random() - 0.5) * dx,
        y = c.y + (random() - 0.5) * dy;
      const length = unit * (0.4 + clamp(gradient * 7) * 1.1),
        vx = -gx / gradient,
        vy = -gy / gradient;
      add(
        '山坡排线',
        'path',
        [
          { x, y },
          {
            x: x + vx * length * 0.5 - vy * unit * 0.12,
            y: y + vy * length * 0.5 + vx * unit * 0.12,
          },
          { x: x + vx * length, y: y + vy * length },
        ],
        {
          stroke: gx + gy > 0 ? '#644e33' : '#8d7453',
          strokeWidth: unit * 0.075,
          opacity: gx + gy > 0 ? 0.24 : 0.14,
        },
      );
    }
  for (const ring of coast) {
    add('海岸沙缘', 'path', [...ring, ring[0]], { stroke: '#f0dfb8', strokeWidth: unit * 0.3 });
    add('海岸线', 'path', [...ring, ring[0]], {
      stroke: '#6e5b42',
      strokeWidth: unit * 0.075,
      opacity: 0.82,
    });
  }
  // Sparse ocean engraving; every sample is tested against the land field.
  const waveBudget = context.compactArtwork ? 260 : Infinity;
  const waveChance = context.compactArtwork
    ? Math.min(1, 260 / Math.max(1, (width * height) / (unit * unit * 4.1 * 6.3)))
    : 1;
  let waves = 0;
  for (let y = unit * 3; y < height - unit; y += unit * 4.1)
    for (let x = unit * 2; x < width - unit; x += unit * 6.3) {
      const p = { x: x + (random() - 0.5) * unit * 3, y: y + (random() - 0.5) * unit * 2 };
      if (field[at(p)] > -unit * 2) continue;
      if (waves >= waveBudget || (context.compactArtwork && random() > waveChance)) continue;
      waves++;
      add(
        '海面细波',
        'path',
        [
          { x: p.x - unit * 0.75, y: p.y },
          { x: p.x - unit * 0.2, y: p.y - unit * 0.12 },
          { x: p.x + unit * 0.45, y: p.y + unit * 0.04 },
          { x: p.x + unit * 0.85, y: p.y - unit * 0.08 },
        ],
        { stroke: '#88765a', strokeWidth: unit * 0.045, opacity: 0.24 },
      );
    }
  const riverShapes = waterNetwork.channels.map((channel) => {
    const points = channel.points;
    const ribbon = (extra: number) => {
      const left: MapPoint[] = [],
        right: MapPoint[] = [];
      points.forEach((p, j) => {
        const a = points[Math.max(0, j - 1)],
          b = points[Math.min(points.length - 1, j + 1)];
        const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const half = (channel.widths[j] + extra) / 2;
        const nx = (-(b.y - a.y) / length) * half,
          ny = ((b.x - a.x) / length) * half;
        left.push({ x: p.x + nx, y: p.y + ny });
        right.push({ x: p.x - nx, y: p.y - ny });
      });
      const shape = [...left, ...right.reverse()];
      if (context.compactArtwork && shape.length > 32) {
        const minimumWidth = channel.widths.reduce((n, w) => Math.min(n, w), Infinity);
        return simplifyRing(shape, Math.min(Math.min(dx, dy) * 0.14, minimumWidth * 0.2));
      }
      return shape.length <= 1800
        ? shape
        : simplifyLine([...shape, shape[0]], Math.min(dx, dy) * 0.055).slice(0, -1);
    };
    return { points, bank: ribbon(unit * 0.18), water: ribbon(0), kind: channel.kind };
  });
  const forestKinds = ['forest', 'taiga', 'rainforest'];
  const forest = Float64Array.from(cells, (c, i) =>
    c.land && forestKinds.includes(c.biome)
      ? smooth(field[i] / (unit * 2)) *
        (0.5 + noise(c.x / (unit * 5), c.y / (unit * 5), seed + 61) * 0.5)
      : 0,
  );
  surface('林地底色', forest, 0.35, '#8e9874', 0.23, unit * 0.72);
  surface('林间浓荫', forest, 0.72, '#697557', 0.12, unit * 0.5);
  const networkReserve =
    riverShapes.length * 2 +
    roadNetwork.paths.reduce((sum, path) => sum + 2 * Math.ceil((path.length - 1) / 1799), 0) +
    roadNetwork.bridges.length * 2 +
    diagnostics.settlements.reduce(
      (sum, _, i) =>
        sum +
        (context.typedSettlements
          ? surroundingBuildingCount(
              context.plannedSettlements[i].kind,
              context.mapKind,
              diagnostics.settlements.length,
            ) * 2
          : context.plannedSettlements[i].buildings * 3) +
        2,
      0,
    );
  // Reserve the actual complete mountains and required network first. Dense
  // forest decorations cannot consume the room needed by a world-scale range.
  const relief = makeClassicalRelief(cells, columns, rows, width, height, seed, {
    density,
    featureScale: context.mountainScale,
    objectBudget: Math.min(
      context.compactArtwork ? 1400 : Infinity,
      context.objectBudget - context.objectCount() - networkReserve,
    ),
  });
  const decorativeLimit = context.objectBudget - networkReserve - relief.length;
  const fineMarkBudget = context.compactArtwork ? 180 : 850;
  const foliageBudget = Math.min(
    context.compactArtwork ? 180 : 760,
    Math.max(0, (decorativeLimit - context.objectCount() - fineMarkBudget) / 3),
  );
  const vegetationWeight = cells.reduce(
    (sum, c, i) => sum + (c.land && forestKinds.includes(c.biome) ? density[i] : 0),
    0,
  );
  const foliageProbability = Math.min(
    0.52 * samplingArea,
    foliageBudget / Math.max(1, vegetationWeight),
  );
  const occupied = diagnostics.settlements;
  const riverSet = waterNetwork.riverCells;
  let fineMarks = 0;
  for (let row = 1; row < rows - 1; row++)
    for (let column = 1; column < columns - 1; column++) {
      const i = row * columns + column,
        c = cells[i];
      if (
        !c.land ||
        field[i] < unit ||
        riverSet.has(i) ||
        context.objectCount() + 3 > decorativeLimit
      )
        continue;
      if (occupied.some((n) => Math.hypot(c.x - cells[n].x, c.y - cells[n].y) < unit * 3)) continue;
      const leafy = forestKinds.includes(c.biome);
      const scattered = c.biome === 'savanna' && random() < 0.09 * samplingArea * density[i];
      if ((leafy && random() < foliageProbability * density[i]) || scattered) {
        const x = c.x + (random() - 0.5) * dx * 0.6,
          y = c.y + (random() - 0.5) * dy * 0.6;
        if (!cells[at({ x, y })].land) continue;
        const localDensity = noise(x / (unit * 4), y / (unit * 4), seed + 776);
        if (leafy && localDensity < 0.16) continue;
        if (c.biome === 'taiga') {
          add('针叶林', 'symbol', [{ x, y }], {
            symbol: 'pine',
            size: unit * (1.2 + random() * 0.7),
            color: random() > 0.5 ? '#8c9679' : '#a0a587',
            stroke: '#555b43',
            strokeWidth: 0.38,
          });
        } else {
          const radius =
            unit * (c.biome === 'rainforest' ? 0.56 : scattered ? 0.5 : 0.4) * (1 + random() * 0.5);
          const crown: MapPoint[] = [];
          const lobes: MapPoint[] = [];
          for (let k = 0; k < 14; k++) {
            const angle = (k * Math.PI) / 7,
              r = radius * (0.84 + random() * 0.24) * (k % 2 ? 0.78 : 1.14);
            lobes.push({ x: x + Math.cos(angle) * r, y: y - radius * 0.48 + Math.sin(angle) * r });
          }
          // Round the irregular leaf lobes without consuming more randomness.
          // The original fourteen draws and tree centers remain deterministic.
          for (let k = 0; k < lobes.length; k++) {
            const a = lobes[(k + lobes.length - 1) % lobes.length],
              b = lobes[k],
              c = lobes[(k + 1) % lobes.length],
              d = lobes[(k + 2) % lobes.length];
            for (let step = 0; step < 3; step++) {
              const t = step / 3,
                t2 = t * t,
                t3 = t2 * t;
              const interpolate = (axis: 'x' | 'y') =>
                0.5 *
                (2 * b[axis] +
                  (-a[axis] + c[axis]) * t +
                  (2 * a[axis] - 5 * b[axis] + 4 * c[axis] - d[axis]) * t2 +
                  (-a[axis] + 3 * b[axis] - 3 * c[axis] + d[axis]) * t3);
              crown.push({ x: interpolate('x'), y: interpolate('y') });
            }
          }
          add(
            '林木树干',
            'path',
            [
              { x: x - radius * 0.32, y: y + radius * 0.94 },
              { x: x + radius * 0.3, y: y + radius * 0.94 },
              { x, y: y + radius * 0.9 },
              { x: x + radius * 0.02, y: y - radius * 0.1 },
            ],
            { stroke: '#62573e', strokeWidth: unit * 0.045, opacity: 0.7 },
          );
          add('林冠', 'polygon', crown, {
            color:
              c.biome === 'rainforest'
                ? random() > 0.5
                  ? '#89936b'
                  : '#9ea279'
                : scattered
                  ? '#b2ad80'
                  : random() > 0.5
                    ? '#a2aa80'
                    : '#b1b38a',
            stroke: '#64694b',
            strokeWidth: unit * 0.046,
            opacity: 0.92,
          });
          add(
            '林冠枝脉',
            'path',
            [
              { x: x - radius * 0.5, y: y - radius * 0.35 },
              { x: x + radius * 0.02, y: y + radius * 0.1 },
              { x: x - radius * 0.06, y: y - radius * 0.65 },
              { x: x + radius * 0.02, y: y + radius * 0.1 },
              { x: x + radius * 0.47, y: y - radius * 0.24 },
            ],
            { stroke: '#616348', strokeWidth: unit * 0.032, opacity: 0.45 },
          );
        }
        diagnostics.vegetation.push(i);
      } else if (fineMarks < fineMarkBudget && random() < density[i] * 0.22 * samplingArea) {
        const { x, y } = c;
        const biome = c.biome;
        if (['grass', 'savanna', 'tundra', 'swamp'].includes(biome)) {
          add(
            biome === 'swamp' ? '湿地芦苇' : '草甸纹理',
            'path',
            biome === 'swamp'
              ? [
                  { x: x - unit * 0.3, y: y + unit * 0.15 },
                  { x, y: y + unit * 0.05 },
                  { x: x - unit * 0.04, y: y - unit * 0.45 },
                ]
              : [
                  { x: x - unit * 0.22, y },
                  { x: x - unit * 0.09, y: y - unit * 0.12 },
                  { x: x + unit * 0.12, y: y - unit * 0.08 },
                ],
            {
              stroke: biome === 'tundra' ? '#8b8b71' : biome === 'swamp' ? '#707c61' : '#99906c',
              strokeWidth: unit * 0.046,
              opacity: 0.45,
            },
          );
          fineMarks++;
        } else if (['desert', 'badlands', 'plateau', 'hill', 'snow'].includes(biome)) {
          const sand = biome === 'desert';
          add(
            sand ? '风积沙纹' : biome === 'badlands' ? '荒岩层理' : '地表细纹',
            'path',
            [
              { x: x - unit * 0.55, y: y + unit * 0.12 },
              { x: x - unit * 0.22, y: y - unit * 0.15 },
              { x: x + unit * 0.15, y: y - unit * 0.22 },
              { x: x + unit * 0.55, y },
            ],
            {
              stroke: sand
                ? '#a88955'
                : biome === 'badlands'
                  ? '#815e48'
                  : biome === 'snow'
                    ? '#a9a58e'
                    : '#80785b',
              strokeWidth: unit * 0.05,
              opacity: 0.4,
            },
          );
          fineMarks++;
        }
      }
    }
  // Draw after vegetation and all banks first, keeping water continuous through
  // woodland and preventing tributary banks from cutting the downstream river.
  riverShapes.forEach((r, i) =>
    add(`河流 ${i + 1} · 岸`, 'polygon', r.bank, { color: '#f0e4c4', opacity: 0.88 }),
  );
  riverShapes.forEach((r, i) => add(`河流 ${i + 1}`, 'polygon', r.water, { color: '#657d79' }));
  for (let j = 0; j < roadNetwork.paths.length; j++) {
    const points = roadNetwork.paths[j];
    add(`道路 ${j + 1} · 路基`, 'path', points, {
      stroke: '#f0e2be',
      strokeWidth: unit * 0.37,
      opacity: 0.94,
    });
    add(`道路 ${j + 1}`, 'path', points, {
      stroke: '#8a6446',
      strokeWidth: unit * 0.11,
      opacity: 0.92,
    });
  }
  for (const bridge of roadNetwork.bridges) {
    const angle = (bridge.angle * Math.PI) / 180,
      along = { x: Math.cos(angle), y: Math.sin(angle) },
      side = { x: -Math.sin(angle), y: Math.cos(angle) };
    for (const offset of [-0.22, 0.22])
      add(
        '道路桥栏',
        'path',
        [-1, 1].map((t) => ({
          x: bridge.point.x + along.x * unit * 0.75 * t + side.x * unit * offset,
          y: bridge.point.y + along.y * unit * 0.75 * t + side.y * unit * offset,
        })),
        { stroke: '#67553f', strokeWidth: unit * 0.075 },
      );
  }
  // Habitable settlements use small clusters with roofs, a center and a label.
  // Opaque peak silhouettes and saddles hide the rivers/roads behind them while
  // preserving the complete, connected geographic network underneath. Ordinary
  // polygons keep this painter's order when frozen, edited or exported to SVG.
  for (const object of relief) {
    const { id: _id, name, kind, points, ...style } = object;
    add(name, kind, points, style);
  }
  // Their dependent details still check the final water mask individually.
  for (let j = 0; j < diagnostics.settlements.length; j++) {
    const c = cells[diagnostics.settlements[j]],
      site = context.plannedSettlements[j];
    if (context.typedSettlements) {
      const count = surroundingBuildingCount(
        site.kind,
        context.mapKind,
        diagnostics.settlements.length,
      );
      const reach = unit * (site.size + Math.sqrt(count * 1.35 + 3) + 2);
      const corridors: { a: MapPoint; b: MapPoint; halfWidth: number }[] = [];
      for (const { points: path, widths } of [
        ...roadNetwork.paths.map((points) => ({ points, widths: undefined })),
        ...waterNetwork.channels,
      ]) {
        for (let i = 1; i < path.length; i++) {
          const a = path[i - 1],
            b = path[i],
            halfWidth = widths ? Math.max(widths[i - 1], widths[i]) / 2 : unit * 0.185,
            margin = reach + halfWidth;
          if (
            Math.max(a.x, b.x) >= c.x - margin &&
            Math.min(a.x, b.x) <= c.x + margin &&
            Math.max(a.y, b.y) >= c.y - margin &&
            Math.min(a.y, b.y) <= c.y + margin
          )
            corridors.push({ a, b, halfWidth });
        }
      }
      const surroundings = surroundingBuildingSites(
        c,
        site.size,
        count,
        unit,
        seed + 1901 + j * 7919,
        (point, radius) => {
          if (
            point.x - radius < 0 ||
            point.x + radius > width ||
            point.y - radius < 0 ||
            point.y + radius > height
          )
            return false;
          const center = at(point);
          if (
            !cells[center].land ||
            cells[center].elevation >= 0.6 ||
            field[center] < radius + unit * 0.6 ||
            riverSet.has(center)
          )
            return false;
          if (
            diagnostics.settlements.some(
              (other, index) =>
                index !== j &&
                Math.hypot(cells[other].x - point.x, cells[other].y - point.y) <
                  unit * (context.plannedSettlements[index].size * 0.6 + 1),
            )
          )
            return false;
          if (
            corridors.some(
              ({ a, b, halfWidth }) =>
                distanceToSegment(point, a, b) < radius + halfWidth + unit * 0.12,
            )
          )
            return false;
          return true;
        },
      );
      surroundings.forEach(({ point, width: w, height: h, angle }, index) => {
        const convert = ([x, y]: [number, number]) => ({
          x: point.x + x * Math.cos(angle) - y * Math.sin(angle),
          y: point.y + x * Math.sin(angle) + y * Math.cos(angle),
        });
        const outline: [number, number][] =
          site.kind === 'camp'
            ? [
                [-w, h],
                [0, -h * 1.6],
                [w, h],
              ]
            : [
                [-w, 0],
                [-w * 0.3, -h],
                [w, -h * 0.5],
                [w, h],
                [-w * 0.8, h * 1.3],
              ];
        const shadow: [number, number][] =
          site.kind === 'camp'
            ? [
                [0, -h * 1.6],
                [w, h],
                [w * 0.25, h],
              ]
            : [
                [-w * 0.3, -h],
                [w, -h * 0.5],
                [w, h],
                [w * 0.15, h * 0.8],
              ];
        add(`聚落 ${j + 1} · 周边建筑 ${index + 1} · 屋面`, 'polygon', outline.map(convert), {
          color: site.kind === 'camp' ? '#c5be92' : '#ceb38a',
          stroke: '#786047',
          strokeWidth: unit * 0.065,
        });
        add(`聚落 ${j + 1} · 周边建筑 ${index + 1} · 阴面`, 'polygon', shadow.map(convert), {
          color: site.kind === 'camp' ? '#a5a37f' : '#a48362',
          opacity: 0.55,
        });
      });
    }
    const count = context.typedSettlements ? 0 : site.buildings;
    for (let k = 0; k < count; k++) {
      const angle = k * 2.39996,
        radius = unit * (0.9 + Math.sqrt(k) * 0.65),
        x = c.x + Math.cos(angle) * radius,
        y = c.y + Math.sin(angle) * radius;
      if (!cells[at({ x, y })].land || field[at({ x, y })] < unit) continue;
      const w = unit * (0.4 + random() * 0.18),
        h = w * 0.75;
      const house = [
        { x: x - w, y: y - h },
        { x: x + w, y: y - h },
        { x: x + w, y: y + h },
        { x: x - w, y: y + h },
      ];
      add(
        `聚落 ${j + 1} · 建筑阴影`,
        'polygon',
        house.map((p) => ({ x: p.x + unit * 0.15, y: p.y + unit * 0.2 })),
        { color: '#75604a', opacity: 0.17 },
      );
      add(`聚落 ${j + 1} · 屋顶`, 'polygon', house, {
        color: k % 3 ? '#bc9a72' : '#ad9c7e',
        stroke: '#6c543c',
        strokeWidth: unit * 0.075,
      });
      add(
        `聚落 ${j + 1} · 屋脊`,
        'path',
        [
          { x: x - w, y },
          { x: x + w, y },
        ],
        { stroke: '#e2c69a', strokeWidth: unit * 0.065 },
      );
    }
    const name = site.name;
    add(`聚落 ${j + 1} · 地标`, 'symbol', [{ x: c.x, y: c.y }], {
      symbol: context.typedSettlements ? site.kind : j === 0 ? 'city' : 'village',
      size: unit * site.size,
      color: '#d7c19a',
      stroke: '#624d36',
      strokeWidth: 0.8,
    });
    add(`聚落 ${j + 1} · 名称`, 'text', [{ x: c.x, y: c.y + unit * 4.1 }], {
      text: name,
      color: '#483c2b',
      stroke: '#f4e7c7',
      strokeWidth: unit * 0.26,
      size: unit * 1.55,
    });
  }
}
