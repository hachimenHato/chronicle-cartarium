import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  biomeCatalog,
  MAP_EDITOR_LIMITS,
  type MapPoint,
  type MapRegion,
  type SketchGenerationSettings,
  type TerrainBiome,
} from '../shared/cartography';
import { createSeed } from '../shared/seed';
import { validateWorkspace } from '../server/validation';
import { bakeMapArtwork } from '../src/lib/cartography';
import { generateSketchMap, type SketchMapResult } from '../src/lib/sketch-generation';
import type { RefinedSketchDiagnostics } from '../src/lib/sketch-generation-v2';

const width = 1000,
  height = 700;
const recipe: SketchGenerationSettings = {
  version: 1,
  seed: 2741,
  climate: 'temperate',
  settlements: 7,
  rivers: true,
  routes: true,
};
const makeRegion = (
  id: string,
  biome: TerrainBiome,
  points: [number, number][],
  width: number,
): MapRegion => ({
  id: `refine_${id}`,
  name: id,
  biome,
  geometry: 'brush',
  points: points.map(([x, y]) => ({ x, y })),
  width,
  seed: 105,
  roughness: 0.35,
  density: 0.75,
  visible: true,
  locked: false,
});
const sources = [
  makeRegion(
    'land_north',
    'grass',
    [
      [245, 300],
      [740, 315],
    ],
    320,
  ),
  makeRegion(
    'land_south',
    'grass',
    [
      [340, 385],
      [700, 410],
    ],
    280,
  ),
  makeRegion(
    'ridge',
    'mountain',
    [
      [410, 225],
      [635, 265],
    ],
    95,
  ),
  makeRegion(
    'woods',
    'forest',
    [
      [300, 340],
      [425, 390],
    ],
    125,
  ),
  makeRegion(
    'lake',
    'water',
    [
      [675, 390],
      [725, 400],
    ],
    70,
  ),
];
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cache = new Map<string, SketchMapResult>();
function generated(detail: 'v1' | 'standard' | 'high' | 'ultra') {
  const previous = cache.get(detail);
  if (previous) return previous;
  const settings: SketchGenerationSettings =
    detail === 'v1' ? recipe : { ...recipe, version: 2, detail };
  const result = generateSketchMap(sources, width, height, settings);
  cache.set(detail, result);
  return result;
}
function cellAt(result: SketchMapResult, point: MapPoint) {
  const { columns, rows, cellWidth, cellHeight, cells } = result.diagnostics;
  return cells[
    Math.min(rows - 1, Math.max(0, Math.floor(point.y / cellHeight))) * columns +
      Math.min(columns - 1, Math.max(0, Math.floor(point.x / cellWidth)))
  ];
}
function checkArtwork(result: SketchMapResult) {
  assert(result.objects.length > 30);
  assert(result.objects.length <= MAP_EDITOR_LIMITS.objects);
  assert.equal(new Set(result.objects.map((object) => object.id)).size, result.objects.length);
  for (const object of result.objects) {
    assert(object.points.length <= MAP_EDITOR_LIMITS.points, `${object.name} exceeds point limit`);
    for (const point of object.points) {
      assert(Number.isFinite(point.x) && Number.isFinite(point.y), `${object.name} is not finite`);
      assert(point.x >= 0 && point.x <= width, `${object.name} exceeds map width`);
      assert(point.y >= 0 && point.y <= height, `${object.name} exceeds map height`);
    }
  }
}

test('saved v1 recipes retain their pre-refinement geometry byte for byte', () => {
  // Captured from the shipped v1 engine before its v2 replacement. A comparison
  // against another live implementation alone would miss accidental shared drift.
  assert.equal(
    fingerprint(generated('v1').objects),
    'de7a0cf85c0f271d92cc21e39ae1cc77da2f3df3bb6572163c2eff00f9d9bfe2',
  );
});

test('v2 detail choices add genuine terrain samples and preserve source intent deterministically', () => {
  const original = structuredClone(sources);
  let previous = generated('v1');
  for (const detail of ['standard', 'high', 'ultra'] as const) {
    const result = generated(detail);
    assert.equal(result.diagnostics.columns, { standard: 192, high: 288, ultra: 384 }[detail]);
    assert(result.diagnostics.columns > previous.diagnostics.columns, `${detail} adds columns`);
    assert(result.diagnostics.rows > previous.diagnostics.rows, `${detail} adds rows`);
    assert(result.diagnostics.cells.length > previous.diagnostics.cells.length);
    assert.notEqual(fingerprint(result.objects), fingerprint(previous.objects));
    assert.equal(cellAt(result, { x: 80, y: 70 }).land, false);
    assert.equal(cellAt(result, { x: 550, y: 375 }).land, true);
    assert.equal(cellAt(result, { x: 700, y: 395 }).land, false);
    assert.equal(cellAt(result, { x: 510, y: 243 }).biome, 'mountain');
    assert.equal(cellAt(result, { x: 360, y: 363 }).biome, 'forest');
    assert.equal(
      fingerprint(generateSketchMap(sources, width, height, { ...recipe, version: 2, detail })),
      fingerprint(result),
    );
    previous = result;
  }
  assert.deepEqual(sources, original, 'sampling must not rewrite original color blocks');
});

test('refined water and roads retain finite connected channels, flow direction and land routing', () => {
  const result = generated('high');
  const { cells, rivers, riverChannels, roadPaths, bridges, settlements } =
    result.diagnostics as RefinedSketchDiagnostics;
  assert(rivers.length > 1 && riverChannels.length > 1, 'a real drainage network is present');
  assert(roadPaths.length > 0 && settlements.length > 1, 'suitable settlements are connected');
  for (const cell of cells)
    if (cell.land && cell.downstream >= 0) {
      assert(
        cells[cell.downstream].drainageElevation < cell.drainageElevation,
        'every drainage edge descends, so cycles cannot form',
      );
    }
  for (const route of rivers)
    for (let i = 1; i < route.length; i++) {
      assert.equal(
        cells[route[i - 1]].downstream,
        route[i],
        'channel topology follows the drainage tree',
      );
    }
  const pointKey = (point: MapPoint) => `${point.x},${point.y}`;
  const shared = new Map<string, Set<number>>();
  riverChannels.forEach((channel, index) => {
    assert.equal(channel.points.length, channel.widths.length);
    assert(channel.points.length >= 2 && channel.points.length <= MAP_EDITOR_LIMITS.points);
    channel.points.forEach((point, at) => {
      assert(Number.isFinite(point.x) && Number.isFinite(point.y));
      assert(point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height);
      assert(
        Number.isFinite(channel.widths[at]) && channel.widths[at] > 0 && channel.widths[at] <= 5,
      );
      const key = pointKey(point),
        owners = shared.get(key) ?? new Set<number>();
      owners.add(index);
      shared.set(key, owners);
    });
  });
  assert(
    [...shared.values()].some((owners) => owners.size > 1),
    'tributaries share exact junction coordinates',
  );
  for (const channel of riverChannels.filter((channel) => channel.kind === 'distributary')) {
    assert(
      (shared.get(pointKey(channel.points[0]))?.size ?? 0) > 1,
      'a split starts on the main channel',
    );
    assert.equal(
      cellAt(result, channel.points[channel.points.length - 1]).land,
      false,
      'a coastal split reaches water',
    );
  }
  let curvedRoads = 0;
  for (const path of roadPaths) {
    assert(path.length >= 3 && path.length <= MAP_EDITOR_LIMITS.points);
    let length = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i];
      length += Math.hypot(b.x - a.x, b.y - a.y);
      const count = Math.max(
        1,
        Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (result.diagnostics.cellWidth * 0.25)),
      );
      for (let step = 0; step <= count; step++) {
        const t = step / count,
          sample = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        assert(cellAt(result, sample).land, 'every displayed road segment avoids lakes and sea');
      }
    }
    const chord = Math.hypot(path.at(-1)!.x - path[0].x, path.at(-1)!.y - path[0].y);
    if (length > chord * 1.04) curvedRoads++;
  }
  assert(
    curvedRoads > 0,
    'roads retain meaningful terrain bends instead of all becoming straight chords',
  );
  for (const bridge of bridges) {
    assert(Number.isFinite(bridge.angle) && Math.abs(bridge.angle) <= 180);
    assert(cellAt(result, bridge.point).land);
    assert(
      roadPaths.some((path) =>
        path.some(
          (point) =>
            Math.hypot(point.x - bridge.point.x, point.y - bridge.point.y) <
            result.diagnostics.cellWidth * 2,
        ),
      ),
      'bridges belong to an actual routed road',
    );
  }
});

test('changing a lowland forest seed never cuts a new elevation seam through the mainland', () => {
  const settings: SketchGenerationSettings = {
    ...recipe,
    version: 2,
    detail: 'standard',
    settlements: 0,
  };
  const original = generateSketchMap(sources, width, height, settings);
  const changed = generateSketchMap(
    sources.map((source) => (source.biome === 'forest' ? { ...source, seed: 90147 } : source)),
    width,
    height,
    settings,
  );
  for (const point of [
    { x: 325, y: 352 },
    { x: 345, y: 360 },
    { x: 362, y: 372 },
    { x: 395, y: 383 },
  ]) {
    assert.equal(cellAt(changed, point).land, true);
    assert.equal(cellAt(original, point).elevation, cellAt(changed, point).elevation);
  }
});

test('fourteen terrain choices preserve explicit intent within a shared mainland', () => {
  const expected = [
    'water',
    'grass',
    'forest',
    'mountain',
    'desert',
    'swamp',
    'snow',
    'hill',
    'plateau',
    'taiga',
    'rainforest',
    'savanna',
    'tundra',
    'badlands',
  ];
  assert.deepEqual(new Set(biomeCatalog.map((biome) => biome.id)), new Set(expected));
  const mainland: MapRegion = {
    ...makeRegion(
      'biome_mainland',
      'grass',
      [
        [50, 50],
        [950, 50],
        [950, 650],
        [50, 650],
      ],
      100,
    ),
    geometry: 'polygon',
  };
  const patches = biomeCatalog.map((biome, index) =>
    makeRegion(
      `intent_${biome.id}`,
      biome.id,
      [[150 + (index % 4) * 230, 125 + Math.floor(index / 4) * 150]],
      112,
    ),
  );
  const result = generateSketchMap([mainland, ...patches], width, height, {
    ...recipe,
    version: 2,
    detail: 'high',
    settlements: 0,
  });
  for (const patch of patches) {
    const cell = cellAt(result, patch.points[0]);
    assert.equal(cell.land, patch.biome !== 'water', `${patch.biome} controls land versus water`);
    // Plain grass represents generic habitable land and may derive other cover
    // from climate; every more specific color is an explicit authored constraint.
    if (patch.biome !== 'grass') assert.equal(cell.biome, patch.biome);
  }
  checkArtwork(result);
});

test('high and ultra results fit persistent geometry capacity and freeze without losing authoring', () => {
  for (const detail of ['high', 'ultra'] as const) {
    const result = generated(detail);
    checkArtwork(result);
    const data = createSeed();
    const map = data.maps[0];
    map.width = width;
    map.height = height;
    map.kind = 'region';
    map.strokes = [];
    map.editor = {
      version: 1,
      mode: 'sketch',
      baseVisible: false,
      generation: { ...recipe, version: 2, detail },
      regions: structuredClone(sources),
      objects: [],
    };
    const before = structuredClone(data);
    const objects = bakeMapArtwork(map);
    assert.deepEqual(data, before, 'freezing cannot mutate either map or source strokes');
    assert.equal(objects.length, result.objects.length, 'freezing preserves all visible artwork');
    assert.deepEqual(
      objects.map(({ id: _id, layer: _layer, ...object }) => object),
      result.objects.map(({ id: _id, layer: _layer, ...object }) => object),
    );
    map.editor = { version: 1, mode: 'detail', baseVisible: false, regions: [], objects };
    assert.deepEqual(validateWorkspace(data), data);
    assert.deepEqual(map.pins, before.maps[0].pins);
    assert.deepEqual(data.maps[1], before.maps[1]);
  }
});

for (const biome of ['rainforest', 'mountain', 'badlands'] as const) {
  test(`ultra full-canvas ${biome} remains strictly saveable at maximum decoration density`, () => {
    const region: MapRegion = {
      ...makeRegion(
        `full_${biome}`,
        biome,
        [
          [0, 0],
          [width, 0],
          [width, height],
          [0, height],
        ],
        100,
      ),
      geometry: 'polygon',
      density: 1,
    };
    const result = generateSketchMap([region], width, height, {
      ...recipe,
      version: 2,
      detail: 'ultra',
    });
    checkArtwork(result);
    const data = createSeed();
    Object.assign(data.maps[0], {
      width,
      height,
      strokes: [],
      editor: {
        version: 1,
        mode: 'detail',
        baseVisible: false,
        regions: [],
        objects: result.objects,
      },
    });
    assert.deepEqual(
      validateWorkspace(data),
      data,
      `${biome} fits the same strict saved geometry contract`,
    );
  });
}
