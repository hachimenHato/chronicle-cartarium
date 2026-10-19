import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultGeographicSettings, GEOGRAPHY_LIMITS } from '../shared/geography';
import type { SketchGenerationV2, MapPoint, MapRegion } from '../shared/cartography';
import { generateSketchMap } from '../src/lib/sketch-generation';
import {
  applyGeographicFields,
  climateBiome,
  geographicTemperature,
} from '../src/lib/geography-fields';
import { buildGeographicMesh } from '../src/lib/geography-mesh';
import { pointInPolygon, distanceToSegment } from '../src/lib/terrain';
import { createSeed } from '../shared/seed';
import { validateWorkspace } from '../server/validation';
import { generationSignature, snapshotElevation } from '../src/lib/generated-map';
import type { SketchCell } from '../src/lib/sketch-generation-v1';
import { isWaterPoint, isWaterSegment } from '../shared/map-surface';

const recipe: SketchGenerationV2 = {
  version: 2,
  detail: 'standard',
  linework: 'organic',
  seed: 382914,
  climate: 'temperate',
  settlements: 8,
  rivers: true,
  routes: true,
  geography: {
    ...defaultGeographicSettings('world'),
    plateCount: 6,
    countryCount: 4,
    cultureCount: 3,
    religionCount: 3,
    regionDensity: 0.7,
  },
};
let accepted: ReturnType<typeof generateSketchMap>;
const generated = () => (accepted ??= generateSketchMap([], 1200, 800, recipe, 4800, 'world'));

test('geography generation is deterministic and all persisted fine artwork and layers pass server validation', () => {
  const result = generated(),
    again = generateSketchMap([], 1200, 800, structuredClone(recipe), 4800, 'world');
  assert.deepEqual(result, again);
  assert(result.geography && result.elevation);
  const data = createSeed(),
    map = data.maps[0];
  Object.assign(map, {
    kind: 'world',
    width: 1200,
    height: 800,
    scaleKm: 4800,
    pins: [],
    strokes: [],
    editor: {
      version: 1,
      mode: 'sculpt',
      baseVisible: false,
      regions: [],
      objects: [],
      generation: recipe,
      generated: {
        version: 1,
        signature: generationSignature([], 1200, 800, recipe, 4800, 'world'),
        objects: result.objects,
        stats: result.stats,
        sites: result.sites,
        elevation: snapshotElevation(result.elevation),
        geography: result.geography,
      },
    },
  });
  assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(data))), data);
  assert(
    Buffer.byteLength(JSON.stringify(data)) < 10 * 1024 * 1024,
    'whole saved world remains within the request budget',
  );
});

test('temperature uses latitude and altitude, precipitation and thermal limits classify useful biomes', () => {
  assert(geographicTemperature(60, 0, 30) < geographicTemperature(10, 0, 30));
  assert.equal(geographicTemperature(30, 2000, 30), geographicTemperature(30, 0, 30) - 13);
  assert.equal(climateBiome(true, 100, 27, 80), 'desert');
  assert.equal(climateBiome(true, 100, 27, 2300), 'rainforest');
  assert.equal(climateBiome(true, 600, 5, 1200), 'taiga');
  assert.equal(climateBiome(true, 4000, -12, 1200), 'snow');
  const g = generated().geography!;
  assert(new Set(g.cells.map((c) => c.biome)).size >= 6);
  assert(g.cells.some((c) => c.shelf && !c.land && c.elevation >= -220));
  assert(g.cells.some((c) => !c.land && !c.shelf && c.elevation < -220));
  const warm = g.cells.filter((c) => c.land && c.temperature > 16),
    cold = g.cells.filter((c) => c.land && c.temperature < 4);
  assert(warm.length && cold.length, 'world spans multiple annual climates');
});

test('shared irregular cells partition the canvas and political borders use exactly shared edges', () => {
  const g = generated().geography!;
  let totalArea = 0;
  for (const cell of g.cells) {
    totalArea +=
      Math.abs(
        cell.polygon.reduce((a, p, i) => {
          const q = cell.polygon[(i + 1) % cell.polygon.length];
          return a + p.x * q.y - q.x * p.y;
        }, 0),
      ) / 2;
    for (const neighbor of cell.neighbors) assert(g.cells[neighbor].neighbors.includes(cell.id));
    for (const p of cell.polygon) assert(p.x >= 0 && p.x <= g.width && p.y >= 0 && p.y <= g.height);
    if (cell.land)
      for (const kind of ['country', 'culture', 'religion'] as const)
        assert(g.divisions.some((d) => d.id === cell[kind] && d.kind === kind));
    else assert(!cell.country && !cell.culture && !cell.religion);
  }
  assert(
    Math.abs(totalArea - g.width * g.height) < g.width * g.height * 0.0001,
    'shared bends conserve total cell area',
  );
  const borders = g.borders.filter((b) => b.kind === 'country');
  assert(borders.length > 0);
  assert(
    borders.some((b) => distanceToSegment(b.points[1], b.points[0], b.points[2]) > 0.03),
    'borders have shared non-straight edge samples',
  );
  for (const border of borders)
    for (const id of border.cells)
      for (const point of border.points)
        assert(g.cells[id].polygon.some((p) => Math.hypot(p.x - point.x, p.y - point.y) < 0.001));
  assert(g.areas.some((a) => a.kind === 'continent' || a.kind === 'island'));
  assert(g.areas.some((a) => a.kind === 'ocean'));
  assert(g.areas.some((a) => a.kind === 'province'));
});

test('multiple coastal settlements form navigable port connections over the final fine water surface', () => {
  const result = generated(),
    g = result.geography!;
  assert(g.ports.length >= 2);
  assert(g.seaRoutes.length >= 1);
  const surface = snapshotElevation(result.elevation!)!;
  for (const port of g.ports) {
    assert(g.cells[port.cell].land);
    if (port.settlementId) assert(result.sites!.some((s) => s.id === port.settlementId));
    assert(isWaterPoint(surface, port.harbor));
  }
  for (const route of g.seaRoutes) {
    assert(g.ports.some((p) => p.id === route.from));
    assert(g.ports.some((p) => p.id === route.to));
    for (let i = 0; i < route.points.length; i++) {
      assert(
        isWaterPoint(surface, route.points[i]),
        'shipping vertices are on the actual water surface',
      );
      if (i)
        assert(
          isWaterSegment(surface, route.points[i - 1], route.points[i]),
          'every continuous shipping segment stays on water, including between saved vertices',
        );
    }
  }
});

function coarseContext(seed: number, kind: 'world' | 'region' | 'town', density = 1) {
  const width = 1000,
    height = 650,
    columns = 64,
    rows = 42;
  const cells: SketchCell[] = Array.from({ length: columns * rows }, (_, i) => ({
    x: (((i % columns) + 0.5) * width) / columns,
    y: ((Math.floor(i / columns) + 0.5) * height) / rows,
    land: false,
    biome: 'water',
    elevation: -0.1,
    drainageElevation: -0.1,
    downstream: -1,
    moisture: 0,
    slope: 0,
    accumulation: 0,
  }));
  return {
    cells,
    field: new Float64Array(cells.length),
    columns,
    rows,
    width,
    height,
    kind,
    settings: {
      ...recipe,
      seed,
      geography: { ...defaultGeographicSettings(kind), regionDensity: density },
    },
  };
}
test('cell scale changes with map purpose, multiple seeds and maximum density remain bounded', () => {
  const counts: number[] = [];
  for (const kind of ['world', 'region', 'town'] as const) {
    const c = coarseContext(711, kind);
    const f = applyGeographicFields(c);
    counts.push(buildGeographicMesh(c, f).cells.length);
  }
  assert(counts[0] > counts[1] && counts[1] > counts[2]);
  for (const seed of [1, 29, 711, 20261014, 4294967295]) {
    const c = coarseContext(seed, 'world', 2),
      f = applyGeographicFields(c),
      g = buildGeographicMesh(c, f);
    assert(g.cells.length <= GEOGRAPHY_LIMITS.cells);
    assert(g.borders.length <= GEOGRAPHY_LIMITS.borders);
    assert(g.cells.some((c) => c.land) && g.cells.some((c) => !c.land));
    assert(Buffer.byteLength(JSON.stringify(g)) < 3 * 1024 * 1024);
  }
});

test('changing rain and wind changes climate and land cover while preserving random continents', () => {
  const a = coarseContext(811, 'world'),
    b = coarseContext(811, 'world');
  b.settings.geography!.rainfall = 2.5;
  b.settings.geography!.windAngle = 195;
  const fa = applyGeographicFields(a),
    fb = applyGeographicFields(b);
  assert.deepEqual(
    a.cells.map((c) => c.elevation),
    b.cells.map((c) => c.elevation),
  );
  assert.notDeepEqual(Array.from(fa.precipitation), Array.from(fb.precipitation));
  assert(
    b.cells.reduce((n, c, i) => n + (c.land ? fb.precipitation[i] : 0), 0) >
      a.cells.reduce((n, c, i) => n + (c.land ? fa.precipitation[i] : 0), 0),
  );
});

test('smart brushes amend a random world rather than being overwritten by its original random source', () => {
  const context = coarseContext(713, 'region');
  const base = coarseContext(713, 'region');
  applyGeographicFields(base);
  const center = Math.floor(context.rows / 2) * context.columns + Math.floor(context.columns / 2);
  const corner = context.columns * 3 + 3;
  const regions: MapRegion[] = [
    {
      id: 'random_brush_water',
      name: '新增内湖',
      biome: 'water',
      geometry: 'brush',
      points: [{ x: context.cells[center].x, y: context.cells[center].y }],
      width: 130,
      seed: 2,
      roughness: 0.5,
      density: 0.5,
      visible: true,
      locked: false,
    },
    {
      id: 'random_brush_mountain',
      name: '新增高地',
      biome: 'mountain',
      geometry: 'brush',
      points: [{ x: context.cells[corner].x, y: context.cells[corner].y }],
      width: 130,
      seed: 3,
      roughness: 0.5,
      density: 0.5,
      visible: true,
      locked: false,
    },
  ];
  const intent = new Int16Array(context.cells.length).fill(-1);
  intent[center] = 0;
  intent[corner] = 1;
  applyGeographicFields({ ...context, regions, intent });
  assert(base.cells[center].land);
  assert(!context.cells[center].land, 'water brush excavates a lake in the random continent');
  assert(
    context.cells[corner].land && context.cells[corner].elevation * 6000 >= 3190,
    'mountain brush raises a new island on the former ocean',
  );
  const unchanged = context.columns * (context.rows - 4) + context.columns - 4;
  assert.equal(
    context.cells[unchanged].elevation,
    base.cells[unchanged].elevation,
    'unpainted geography is preserved',
  );
});

test('prevailing ocean winds enhance upslope rain and leave the lee side drier', () => {
  const context = coarseContext(4421, 'region');
  context.settings.geography = {
    ...context.settings.geography!,
    source: 'sketch',
    windAngle: 0,
    latitudeNorth: 35,
    latitudeSouth: 35,
    roughness: 0,
  };
  for (let i = 0; i < context.cells.length; i++) {
    const x = i % context.columns,
      c = context.cells[i];
    c.land = x >= 6;
    const ridge = Math.max(0, 1 - Math.abs(x - 29) / 7) * 3200;
    c.elevation = (c.land ? 180 + ridge : -1000) / 6000;
    context.field[i] = c.land ? 10_000 : -10_000;
  }
  const fields = applyGeographicFields(context);
  let windward = 0,
    leeward = 0;
  for (let y = 0; y < context.rows; y++) {
    windward += fields.precipitation[y * context.columns + 27];
    leeward += fields.precipitation[y * context.columns + 37];
  }
  assert(
    windward > leeward * 1.3,
    `upslope annual rain ${windward / context.rows} exceeds lee ${leeward / context.rows}`,
  );
});

test('sketch geography preserves explicit land, sea and altitude intentions', () => {
  const regions: MapRegion[] = [
    {
      id: 'geo_test_land',
      name: '大陆草稿',
      biome: 'grass',
      geometry: 'brush',
      points: [
        { x: 300, y: 300 },
        { x: 680, y: 350 },
      ],
      width: 360,
      seed: 2,
      roughness: 0.8,
      density: 0.8,
      visible: true,
      locked: false,
    },
    {
      id: 'geo_test_ridge',
      name: '山脊',
      biome: 'mountain',
      geometry: 'brush',
      points: [
        { x: 400, y: 240 },
        { x: 620, y: 270 },
      ],
      width: 130,
      seed: 4,
      roughness: 0.8,
      density: 0.8,
      visible: true,
      locked: false,
    },
    {
      id: 'geo_test_lake',
      name: '湖泊',
      biome: 'water',
      geometry: 'brush',
      points: [{ x: 610, y: 360 }],
      width: 90,
      seed: 3,
      roughness: 0.7,
      density: 0.8,
      visible: true,
      locked: false,
    },
  ];
  const result = generateSketchMap(
    regions,
    1000,
    650,
    {
      ...recipe,
      settlements: 0,
      geography: { ...defaultGeographicSettings('region'), source: 'sketch' },
    },
    400,
    'region',
  );
  const at = (p: MapPoint) =>
    result.diagnostics.cells[
      Math.floor(p.y / result.diagnostics.cellHeight) * result.diagnostics.columns +
        Math.floor(p.x / result.diagnostics.cellWidth)
    ];
  assert(!at({ x: 40, y: 40 }).land);
  assert(at({ x: 450, y: 330 }).land);
  assert(!at({ x: 610, y: 360 }).land);
  assert(at({ x: 490, y: 255 }).elevation > at({ x: 450, y: 330 }).elevation);
});
