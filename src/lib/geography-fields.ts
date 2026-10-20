import type { GeographicSettings, GeographicPlate } from '../../shared/geography';
import type {
  SketchGenerationV2,
  MapPoint,
  TerrainBiome,
  MapRegion,
} from '../../shared/cartography';
import type { AtlasMap } from '../../shared/model';
import type { SketchCell } from './sketch-generation-v1';
import { seededRandom, distanceToSegment, pointInPolygon } from './terrain';
import { applyElevationStrokes, ELEVATION_SCALE } from './elevation';
import type { RiverChannel } from './sketch-networks';
import { generateGeographicClimate } from './geography-climate';
import { mapSizePresets } from './map-scale';
import { longitudeSpan } from '../../shared/world-extent';
import { generatedPlateName } from '../../shared/plate-names';
export { geographicTemperature } from './geography-climate';

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
export function geographicNoise(x: number, y: number, seed: number): number {
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
function fractal(x: number, y: number, seed: number) {
  return (
    (geographicNoise(x, y, seed) +
      geographicNoise(x * 2.03 + 11, y * 2.03 + 17, seed + 73) * 0.5 +
      geographicNoise(x * 4.13 - 7, y * 4.13 + 5, seed + 149) * 0.25 +
      geographicNoise(x * 8.27 + 23, y * 8.27 - 19, seed + 281) * 0.125) /
    1.875
  );
}

export interface GeographicFieldContext {
  cells: SketchCell[];
  field: Float64Array;
  columns: number;
  rows: number;
  width: number;
  height: number;
  kind: AtlasMap['kind'];
  scaleKm?: number;
  settings: SketchGenerationV2;
  regions?: MapRegion[];
  intent?: Int16Array;
  /** Final visible channels and settlements seed geography on the same generated terrain. */
  riverChannels?: RiverChannel[];
  settlements?: { id: string; kind: string; name: string; x: number; y: number }[];
}
export interface GeographicFields {
  plates: GeographicPlate[];
  plate: Int16Array;
  temperature: Float32Array;
  precipitation: Float32Array;
  shelf: Uint8Array;
}

const plateColors = [
  '#c09176',
  '#a9aa78',
  '#889b9a',
  '#ab92ad',
  '#ba9f66',
  '#8caa81',
  '#a18d77',
  '#6f939c',
];
/** Far-apart plate seeds with relative movement, sampled with a warped distance field. */
export function createGeographicPlates(
  width: number,
  height: number,
  seed: number,
  count: number,
): GeographicPlate[] {
  const random = seededRandom(seed ^ 0x523921);
  const plates: GeographicPlate[] = [];
  for (let id = 0; id < clamp(Math.round(count), 3, 24); id++) {
    let center: MapPoint = { x: random() * width, y: random() * height },
      best = -1;
    for (let trial = 0; trial < 32; trial++) {
      const candidate = { x: random() * width, y: random() * height };
      const score = plates.length
        ? Math.min(
            ...plates.map((p) => Math.hypot(candidate.x - p.center.x, candidate.y - p.center.y)),
          )
        : random();
      if (score > best) {
        best = score;
        center = candidate;
      }
    }
    const angle = random() * Math.PI * 2,
      speed = 0.35 + random() * 0.65;
    plates.push({
      id,
      name: generatedPlateName(id, seed),
      center: { x: Math.round(center.x * 100) / 100, y: Math.round(center.y * 100) / 100 },
      velocity: {
        x: Math.round(Math.cos(angle) * speed * 1000) / 1000,
        y: Math.round(Math.sin(angle) * speed * 1000) / 1000,
      },
      kind: random() < 0.48 ? 'continental' : 'oceanic',
      color: plateColors[id % plateColors.length],
    });
  }
  if (!plates.some((p) => p.kind === 'continental')) plates[0].kind = 'continental';
  return plates;
}

export function plateMotion(
  a: GeographicPlate,
  b: GeographicPlate,
): 'convergent' | 'divergent' | 'transform' {
  const dx = b.center.x - a.center.x,
    dy = b.center.y - a.center.y,
    length = Math.hypot(dx, dy) || 1;
  const closing =
    ((a.velocity.x - b.velocity.x) * dx + (a.velocity.y - b.velocity.y) * dy) / length;
  return closing > 0.22 ? 'convergent' : closing < -0.22 ? 'divergent' : 'transform';
}

/** Signed distance sampled from the same final height field used by hydrology. */
export function geographicCoastDistance(
  cells: SketchCell[],
  columns: number,
  rows: number,
  width: number,
  height: number,
) {
  const dx = width / columns,
    dy = height / rows,
    distance = new Float64Array(cells.length).fill(Math.hypot(width, height));
  for (let i = 0; i < cells.length; i++) {
    const x = i % columns,
      y = Math.floor(i / columns);
    for (const [ox, oy, length] of [
      [-1, 0, dx],
      [1, 0, dx],
      [0, -1, dy],
      [0, 1, dy],
    ]) {
      const xx = x + ox,
        yy = y + oy;
      if (xx < 0 || yy < 0 || xx >= columns || yy >= rows) continue;
      const j = yy * columns + xx;
      if (cells[i].land !== cells[j].land)
        distance[i] = Math.min(
          distance[i],
          (length * Math.abs(cells[i].elevation)) /
            Math.max(1e-9, Math.abs(cells[i].elevation) + Math.abs(cells[j].elevation)),
        );
    }
  }
  for (const direction of [1, -1])
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < columns; col++) {
        const x = direction > 0 ? col : columns - col - 1,
          y = direction > 0 ? row : rows - row - 1,
          i = y * columns + x;
        for (const [ox, oy] of [
          [-direction, 0],
          [0, -direction],
          [-direction, -direction],
          [direction, -direction],
        ]) {
          const xx = x + ox,
            yy = y + oy;
          if (xx < 0 || yy < 0 || xx >= columns || yy >= rows) continue;
          const j = yy * columns + xx;
          if (cells[i].land === cells[j].land)
            distance[i] = Math.min(distance[i], distance[j] + Math.hypot(ox * dx, oy * dy));
        }
      }
  return Float64Array.from(distance, (d, i) => (cells[i].land ? 1 : -1) * Math.max(0.001, d));
}

/** Moisture availability uses precipitation relative to a temperature-dependent evapotranspiration proxy. */
export function climateBiome(
  land: boolean,
  elevation: number,
  temperature: number,
  precipitation: number,
): TerrainBiome {
  if (!land) return 'water';
  if (temperature < -8 || (elevation > 3600 && temperature < 3)) return 'snow';
  if (temperature < 1) return 'tundra';
  if (elevation > 2400) return 'mountain';
  if (elevation > 1700) return precipitation < 350 ? 'badlands' : 'plateau';
  const aridity = precipitation / Math.max(220, 430 + Math.max(0, temperature) * 30);
  if (aridity < 0.24) return temperature > 12 ? 'desert' : 'badlands';
  if (temperature < 9) return aridity > 0.6 ? 'taiga' : 'tundra';
  if (temperature > 23)
    return precipitation > 1650 ? 'rainforest' : aridity < 0.75 ? 'savanna' : 'forest';
  if (elevation > 900) return 'hill';
  if (precipitation > 1900 && elevation < 110) return 'swamp';
  return aridity > 0.9 ? 'forest' : 'grass';
}

export function geographicClimateVariation(
  geo: GeographicSettings,
  seed: number,
  x: number,
  y: number,
) {
  return fractal(
    ((geo.longitudeWest ?? -180) +
      longitudeSpan({
        longitudeWest: geo.longitudeWest ?? -180,
        longitudeEast: geo.longitudeEast ?? 180,
      }) *
        x) /
      45,
    (geo.latitudeNorth + (geo.latitudeSouth - geo.latitudeNorth) * y) / 22.5,
    seed + 894,
  );
}

/** Coupled deterministic tectonic relief and advected moisture. All values remain inspectable. */
export function applyGeographicFields(context: GeographicFieldContext): GeographicFields {
  const { cells, columns, rows, width, height, kind, settings, field } = context;
  const geo = settings.geography!;
  const seed = settings.seed >>> 0,
    span = Math.max(width, height),
    n = cells.length;
  const plates = createGeographicPlates(width, height, seed, geo.plateCount);
  const plate = new Int16Array(n),
    shelf = new Uint8Array(n);
  const random = seededRandom(seed + 78243),
    cores: { x: number; y: number; rx: number; ry: number }[] = [];
  const coreCount =
    settings.elevation?.preset === 'archipelago'
      ? kind === 'world'
        ? 9
        : 6
      : kind === 'world'
        ? 3
        : 1;
  for (let i = 0; i < coreCount; i++)
    cores.push({
      x: coreCount === 1 ? 0.5 : 0.2 + random() * 0.6,
      y: coreCount === 1 ? 0.5 : 0.18 + random() * 0.64,
      rx: coreCount === 1 ? 0.45 : 0.13 + random() * 0.15,
      ry: coreCount === 1 ? 0.44 : 0.13 + random() * 0.19,
    });
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = cells[i],
      nx = c.x / width,
      ny = c.y / height;
    const wx = nx + (fractal(nx * 4, ny * 4, seed + 981) - 0.5) * 0.18,
      wy = ny + (fractal(nx * 4, ny * 4, seed + 1783) - 0.5) * 0.18;
    const px = wx * width,
      py = wy * height;
    let nearest = 0,
      second = 1,
      d1 = Infinity,
      d2 = Infinity;
    for (let p = 0; p < plates.length; p++) {
      const d = Math.hypot(px - plates[p].center.x, py - plates[p].center.y);
      if (d < d1) {
        d2 = d1;
        second = nearest;
        d1 = d;
        nearest = p;
      } else if (d < d2) {
        d2 = d;
        second = p;
      }
    }
    plate[i] = nearest;
    const a = plates[nearest],
      b = plates[second],
      dx = b.center.x - a.center.x,
      dy = b.center.y - a.center.y,
      separation = Math.hypot(dx, dy) || 1,
      closing =
        ((a.velocity.x - b.velocity.x) * dx + (a.velocity.y - b.velocity.y) * dy) / separation;
    const boundary = Math.exp(-(d2 - d1) / (span * 0.035));
    const ridge = 1 - Math.abs(fractal(wx * 19, wy * 19, seed + 931) * 2 - 1);
    const tectonic =
      boundary *
      (Math.max(0, closing) *
        (a.kind === 'continental' && b.kind === 'continental' ? 2300 : 1650) *
        (0.35 + ridge ** 5) -
        Math.max(0, -closing) * 750);
    if (geo.source === 'random') {
      const core = Math.max(
        ...cores.map((p) => 1 - Math.hypot((wx - p.x) / p.rx, (wy - p.y) / p.ry)),
      );
      const edge = smooth(Math.min(nx, ny, 1 - nx, 1 - ny) / 0.07);
      const broad = fractal(wx * 5.1, wy * 5.1, seed + 98),
        detail = fractal(wx * 35, wy * 35, seed + 813) - 0.5;
      const rough = clamp(geo.roughness);
      let metres = (core * 0.65 + (broad - 0.46) * 0.88 + detail * 0.14 * rough) * 5000;
      metres += (a.kind === 'continental' ? 220 : -180) + tectonic;
      metres = metres * edge - (1 - edge) * 2300;
      if (kind === 'town')
        metres = (core + 0.19 + (broad - 0.5) * 0.35 + detail * 0.06) * 580 + tectonic * 0.08;
      // Later smart brushes amend this base world. They must not be discarded
      // merely because the initial source was random rather than color blocks.
      const region =
        context.intent && context.intent[i] >= 0 ? context.regions?.[context.intent[i]] : undefined;
      if (region) {
        let edgeDistance = Math.hypot(c.x - region.points[0].x, c.y - region.points[0].y);
        const segments =
          region.geometry === 'polygon' ? region.points.length : region.points.length - 1;
        for (let j = 0; j < segments; j++)
          edgeDistance = Math.min(
            edgeDistance,
            distanceToSegment(c, region.points[j], region.points[(j + 1) % region.points.length]),
          );
        const inside =
          region.geometry === 'brush'
            ? region.width / 2 - edgeDistance
            : pointInPolygon(c, region.points)
              ? edgeDistance
              : -edgeDistance;
        const blend = smooth(inside / Math.max(span / 350, region.width * 0.15));
        const target =
          region.biome === 'water'
            ? -450
            : region.biome === 'mountain'
              ? Math.max(3200, metres)
              : region.biome === 'hill'
                ? 1150
                : region.biome === 'plateau'
                  ? 1950
                  : region.biome === 'badlands'
                    ? 750
                    : region.biome === 'swamp'
                      ? 55
                      : region.biome === 'grass' ||
                          region.biome === 'desert' ||
                          region.biome === 'savanna'
                        ? 220
                        : Math.max(150, metres);
        metres += (target - metres) * blend;
      }
      values[i] = metres * (settings.elevation?.relief ?? 1);
    } else {
      // The selected A/B/C interpretation has already formed one authoritative
      // shoreline. Uplift varies land heights without introducing a second,
      // unrelated coastline deformation (especially for strict imported maps).
      values[i] =
        c.elevation * ELEVATION_SCALE +
        (c.land ? Math.max(0, tectonic) * 0.7 : Math.min(0, tectonic) * 0.2);
    }
  }
  if (geo.source === 'random' && settings.elevation) {
    applyElevationStrokes(values, columns, rows, width, height, settings.elevation.strokes);
    for (let i = 0; i < n; i++) values[i] -= settings.elevation.seaLevel;
  }
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    c.elevation = clamp(values[i], -9000, 9000) / ELEVATION_SCALE;
    c.land = c.elevation > 0;
    c.drainageElevation = c.elevation;
    c.accumulation = c.land ? 1 : 0;
    if (!c.land) c.biome = 'water';
  }
  field.set(geographicCoastDistance(cells, columns, rows, width, height));
  for (let i = 0; i < n; i++)
    if (!cells[i].land) {
      const coast = -field[i],
        shelfWidth = span * 0.032;
      shelf[i] = Number(coast < shelfWidth);
      // Bathymetry is tied to the same coast, rather than an unrelated blue layer.
      if (shelf[i])
        cells[i].elevation =
          -clamp(15 + (coast / shelfWidth) ** 1.5 * 205, 15, 220) / ELEVATION_SCALE;
      else
        cells[i].elevation =
          -clamp(220 + ((coast - shelfWidth) / span) * 16000, 220, 9000) / ELEVATION_SCALE;
      cells[i].drainageElevation = cells[i].elevation;
    }
  const { temperature, precipitation } = generateGeographicClimate({
    cells,
    coastDistance: field,
    columns,
    rows,
    width,
    height,
    coverageKm: context.scaleKm ?? mapSizePresets[kind].scaleKm,
    settings: geo,
    variation: (x, y) => geographicClimateVariation(geo, seed, x, y),
  });
  for (let i = 0; i < n; i++)
    if (cells[i].land) {
      const evap = Math.max(200, 430 + Math.max(0, temperature[i]) * 30);
      cells[i].moisture = clamp((precipitation[i] / evap) * 0.68, 0.025, 1);
    }
  return { plates, plate, temperature, precipitation, shelf };
}

/** Reweight the already acyclic drainage graph by annual effective runoff. */
export function applyGeographicRunoff(cells: SketchCell[], fields: GeographicFields) {
  for (let i = 0; i < cells.length; i++)
    cells[i].accumulation = cells[i].land ? clamp(fields.precipitation[i] / 1100, 0.12, 2.7) : 0;
  const order = Array.from({ length: cells.length }, (_, i) => i).sort(
    (a, b) => cells[b].drainageElevation - cells[a].drainageElevation || b - a,
  );
  for (const i of order) {
    const next = cells[i].downstream;
    if (next >= 0) cells[next].accumulation += cells[i].accumulation;
  }
}
