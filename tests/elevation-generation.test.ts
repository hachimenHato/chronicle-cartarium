import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAP_EDITOR_LIMITS,
  type ElevationSettings,
  type ElevationStroke,
  type MapObject,
  type MapRegion,
  type SketchGenerationV2,
} from '../shared/cartography';
import { createSeed } from '../shared/seed';
import { validateWorkspace } from '../server/validation';
import { bakeMapArtwork } from '../src/lib/cartography';
import {
  applyElevation,
  applyElevationStrokes,
  elevationField,
  sampleElevation,
} from '../src/lib/elevation';
import { buildElevationArtwork, generateSketchMapV2 } from '../src/lib/sketch-generation-v2';
import type { SketchCell } from '../src/lib/sketch-generation-v1';

const width = 640;
const height = 400;
const recipe: SketchGenerationV2 = {
  version: 2,
  seed: 5273,
  detail: 'standard',
  linework: 'organic',
  climate: 'temperate',
  settlements: 5,
  rivers: true,
  routes: true,
};
function settings(preset: ElevationSettings['preset'] = 'continent'): ElevationSettings {
  return { version: 1, preset, seed: 5273, relief: 1, seaLevel: 0, strokes: [] };
}
const cache = new Map<string, ReturnType<typeof generateSketchMapV2>>();
function generated(elevation = settings()) {
  const key = JSON.stringify(elevation);
  let result = cache.get(key);
  if (!result) {
    result = generateSketchMapV2([], width, height, { ...recipe, elevation });
    cache.set(key, result);
  }
  return result;
}
function stroke(patch: Partial<ElevationStroke> = {}): ElevationStroke {
  return {
    id: 'test_height_stroke',
    operation: 'raise',
    points: [{ x: 205, y: 205 }],
    width: 120,
    strength: 0.5,
    target: 2200,
    ...patch,
  };
}
function brush(values: Float64Array, strokes: ElevationStroke[]) {
  applyElevationStrokes(values, 41, 41, 410, 410, strokes);
  return values;
}
function strictObjects(objects: MapObject[], mapWidth = width, mapHeight = height) {
  assert(objects.length > 0 && objects.length <= MAP_EDITOR_LIMITS.objects);
  assert.equal(new Set(objects.map((object) => object.id)).size, objects.length);
  for (const object of objects) {
    assert(object.points.length > 0 && object.points.length <= MAP_EDITOR_LIMITS.points);
    for (const point of object.points) {
      assert(Number.isFinite(point.x) && Number.isFinite(point.y));
      assert(point.x >= 0 && point.x <= mapWidth);
      assert(point.y >= 0 && point.y <= mapHeight);
    }
  }
}

test('height templates produce deterministic land, sea and relief without any painted regions', () => {
  const snapshots = [];
  for (const preset of ['continent', 'archipelago', 'highlands'] as const) {
    const elevation = settings(preset);
    const input = { ...recipe, elevation };
    const before = structuredClone(input);
    const result = generated(elevation);
    const again = generateSketchMapV2([], width, height, input);
    assert.deepEqual(result, again, `${preset} must replay exactly`);
    assert.deepEqual(input, before, 'generation must not write into saved authoring');
    assert.equal(result.diagnostics.columns, 192);
    assert(result.stats.landCells > 500);
    assert(result.stats.landCells < result.diagnostics.cells.length * 0.8);
    assert(result.elevation && result.elevation.min < 0 && result.elevation.max > 2000);
    assert.equal(result.elevation.values.length, result.diagnostics.cells.length);
    strictObjects(result.objects);
    snapshots.push(result.elevation.values);
  }
  assert.notDeepEqual(snapshots[0], snapshots[1], 'archipelago must not alias the continent');
  assert.notDeepEqual(snapshots[0], snapshots[2], 'highlands must not alias the continent');
  assert.notDeepEqual(
    generated().elevation!.values,
    generated({ ...settings(), seed: 8741 }).elevation!.values,
    'the height seed must change actual relief',
  );
});

test('raise, lower and flatten blend to the edge and leave all samples outside the brush unchanged', () => {
  const center = 20 * 41 + 20;
  for (const operation of ['raise', 'lower', 'flatten'] as const) {
    const edit = stroke({ operation });
    const original = structuredClone(edit);
    const values = brush(new Float64Array(41 * 41).fill(1000), [edit]);
    const central = operation === 'raise' ? 1900 : operation === 'lower' ? 100 : 1600;
    assert.equal(values[center], central);
    const changes = [0, 1, 3, 5, 6].map((offset) => Math.abs(values[center + offset] - 1000));
    for (let i = 1; i < changes.length; i++) assert(changes[i] < changes[i - 1]);
    assert.equal(changes.at(-1), 0, 'the edge itself remains untouched');
    for (let y = 0; y < 41; y++)
      for (let x = 0; x < 41; x++)
        if (Math.hypot(x - 20, y - 20) * 10 >= 60) assert.equal(values[y * 41 + x], 1000);
    assert.deepEqual(edit, original, 'replay must not mutate the stored stroke');
  }
});

test('smoothing removes a local spike while keeping a constant field and the outside exact', () => {
  const smooth = stroke({ operation: 'smooth', strength: 1 });
  const flat = new Float64Array(41 * 41).fill(1000);
  assert.deepEqual(brush(flat.slice(), [smooth]), flat);
  const center = 20 * 41 + 20;
  const input = flat.slice();
  input[center] = 5000;
  const result = brush(input.slice(), [smooth]);
  assert(result[center] > 1000 && result[center] < 2000, 'smooth the actual elevation spike');
  assert(result[center + 1] > 1000, 'spread relief into the local neighborhood');
  for (let y = 0; y < 41; y++)
    for (let x = 0; x < 41; x++)
      if (Math.hypot(x - 20, y - 20) * 10 >= 60)
        assert.equal(result[y * 41 + x], input[y * 41 + x]);
});

test('a stroke is applied once regardless of collinear mouse sampling, while separate edits remain ordered', () => {
  const from = { x: 105, y: 205 };
  const to = { x: 305, y: 205 };
  for (const operation of ['raise', 'lower', 'flatten', 'smooth'] as const) {
    const sparse = stroke({ operation, points: [from, to] });
    const dense = {
      ...sparse,
      points: Array.from({ length: 201 }, (_, i) => ({ x: from.x + i, y: from.y })),
    };
    const input = Float64Array.from({ length: 41 * 41 }, (_, i) => 1000 + (i % 9) * 30);
    assert.deepEqual(brush(input.slice(), [sparse]), brush(input.slice(), [dense]));
  }
  const input = new Float64Array(41 * 41).fill(1000);
  const raise = stroke({ strength: 1 });
  const flatten = stroke({ operation: 'flatten', strength: 1, target: 1500 });
  assert.equal(brush(input.slice(), [raise, flatten])[20 * 41 + 20], 1500);
  assert.equal(brush(input.slice(), [flatten, raise])[20 * 41 + 20], 3300);
});

test('raising the sea level submerges lowland instead of merely recoloring it', () => {
  const before = generated();
  const after = generated({ ...settings(), seaLevel: 800 });
  assert(after.stats.landCells < before.stats.landCells * 0.8);
  for (let i = 0; i < before.diagnostics.cells.length; i++) {
    const a = before.diagnostics.cells[i];
    const b = after.diagnostics.cells[i];
    assert(Math.abs((a.elevation - b.elevation) * 6000 - 800) < 1e-8);
    if (b.land) assert(a.land, 'raising the sea cannot create new land');
    if (a.elevation * 6000 <= 800) assert.equal(b.land, false);
  }
});

test('sculpted elevation changes drainage and road geometry and the rebuilt routes remain on land', () => {
  const before = generated();
  const edit = stroke({
    points: [
      { x: 300, y: 200 },
      { x: 400, y: 240 },
    ],
    width: 220,
    strength: 1,
  });
  const elevation = { ...settings(), strokes: [edit] };
  const original = structuredClone(elevation);
  const after = generated(elevation);
  assert.deepEqual(elevation, original);
  const changedDrainage = after.diagnostics.cells.filter(
    (cell, i) => cell.downstream !== before.diagnostics.cells[i].downstream,
  ).length;
  assert(changedDrainage > 100, 'water routing must use edited elevations');
  assert(before.stats.rivers > 0 && after.stats.rivers > 0);
  assert(before.stats.roads > 0 && after.stats.roads > 0);
  assert.notDeepEqual(before.diagnostics.riverChannels, after.diagnostics.riverChannels);
  assert.notDeepEqual(before.diagnostics.roadPaths, after.diagnostics.roadPaths);
  for (const cell of after.diagnostics.cells) {
    if (!cell.land || cell.downstream < 0) continue;
    assert(
      cell.drainageElevation > after.diagnostics.cells[cell.downstream].drainageElevation,
      'filled drainage still strictly descends after sculpting',
    );
  }
  for (const path of after.diagnostics.roadPaths)
    for (const point of path) {
      const x = Math.min(
        after.diagnostics.columns - 1,
        Math.floor(point.x / after.diagnostics.cellWidth),
      );
      const y = Math.min(
        after.diagnostics.rows - 1,
        Math.floor(point.y / after.diagnostics.cellHeight),
      );
      assert(after.diagnostics.cells[y * after.diagnostics.columns + x].land);
    }
});

test('a raised brush can create an island from a sketch with no existing land', () => {
  const empty = generated(settings('sketch'));
  assert.equal(empty.stats.landCells, 0);
  assert.equal(empty.objects.length, 1);
  const island = generated({
    ...settings('sketch'),
    strokes: [stroke({ points: [{ x: 320, y: 200 }], width: 200, strength: 1 })],
  });
  assert(island.stats.landCells > 100 && island.stats.landCells < 5000);
  assert(island.elevation!.max > 1000);
  strictObjects(island.objects);
});

test('a neutral sketch height layer preserves existing elevations including peaks above 6000 metres', () => {
  const cells: SketchCell[] = [-0.1, 0.2, 1.15, 0.3].map((elevation, i) => ({
    x: (i % 2) * 100 + 50,
    y: Math.floor(i / 2) * 100 + 50,
    land: elevation > 0,
    biome: elevation > 0 ? 'grass' : 'water',
    elevation,
    drainageElevation: elevation,
    downstream: -1,
    moisture: 0.5,
    slope: 0,
    accumulation: elevation > 0 ? 1 : 0,
  }));
  const before = structuredClone(cells);
  const coast = new Float64Array([-20, 20, 70, 30]);
  const originalCoast = coast.slice();
  applyElevation(cells, coast, 2, 2, 200, 200, settings('sketch'));
  assert.deepEqual(cells, before);
  assert.deepEqual(coast, originalCoast);
  const field = elevationField(cells, 2, 2, 200, 200);
  assert.equal(field.max, 6900);
  assert.equal(sampleElevation(field, { x: 50, y: 150 }), 6900);
  assert.equal(sampleElevation(field, { x: 100, y: 100 }), 2325);
});

test('enabling neutral height editing on a painted map preserves its drainage, roads and authoring', () => {
  const land: MapRegion = {
    id: 'height_test_land',
    name: '原始陆地',
    biome: 'grass',
    geometry: 'brush',
    points: [
      { x: 160, y: 200 },
      { x: 470, y: 200 },
    ],
    width: 300,
    seed: 41,
    roughness: 0.4,
    density: 0.5,
    visible: true,
    locked: false,
  };
  const sources: MapRegion[] = [
    land,
    {
      ...land,
      id: 'height_test_ridge',
      name: '原始山脊',
      biome: 'mountain',
      points: [
        { x: 290, y: 170 },
        { x: 350, y: 210 },
      ],
      width: 110,
      roughness: 0.8,
    },
  ];
  const original = structuredClone(sources);
  const originalRecipe = structuredClone(recipe);
  const before = generateSketchMapV2(sources, width, height, recipe);
  const after = generateSketchMapV2(sources, width, height, {
    ...recipe,
    elevation: settings('sketch'),
  });
  assert(before.elevation!.max > 6000, 'this fixture must expose old tall peaks');
  assert.deepEqual(sources, original);
  assert.deepEqual(
    recipe,
    originalRecipe,
    'generation does not attach editing fields to the source recipe',
  );
  assert.equal(Object.hasOwn(recipe, 'elevation'), false);
  assert.deepEqual(before.stats, after.stats);
  assert.deepEqual(before.diagnostics.riverChannels, after.diagnostics.riverChannels);
  assert.deepEqual(before.diagnostics.roadPaths, after.diagnostics.roadPaths);
  assert.deepEqual(before.diagnostics.settlements, after.diagnostics.settlements);
  before.diagnostics.cells.forEach((cell, i) => {
    const updated = after.diagnostics.cells[i];
    assert(Math.abs(cell.elevation - updated.elevation) < 1e-10);
    assert.equal(cell.land, updated.land);
    assert.equal(cell.downstream, updated.downstream);
  });
});

function terrainRegion(biome: MapRegion['biome'], patch: Partial<MapRegion> = {}): MapRegion {
  return {
    id: 'joint_terrain_region',
    name: '地形与海拔联合生成',
    biome,
    geometry: 'brush',
    points: [{ x: 320, y: 200 }],
    width: 180,
    seed: 41,
    roughness: 0.65,
    density: 0.5,
    visible: true,
    locked: false,
    ...patch,
  };
}

test('each height template combines painted relief and cover without discarding either input', () => {
  for (const preset of ['continent', 'archipelago', 'highlands'] as const) {
    const input = {
      ...recipe,
      rivers: false,
      routes: false,
      settlements: 0,
      elevation: settings(preset),
    };
    const sources = ['grass', 'forest', 'hill', 'mountain', 'water'].map((biome) =>
      terrainRegion(biome as MapRegion['biome']),
    );
    const originalSources = structuredClone(sources);
    const originalRecipe = structuredClone(input);
    const results = sources.map((region) => generateSketchMapV2([region], width, height, input));
    const [grass, forest, hill, mountain, water] = results;
    const center = grass.diagnostics.cells.flatMap((c, i) =>
      Math.hypot(c.x - 320, c.y - 200) < 30 ? [i] : [],
    );
    const average = (result: typeof grass) =>
      center.reduce((sum, i) => sum + result.elevation!.values[i], 0) / center.length;
    assert(average(hill) > average(grass) + 200, `${preset}: hills must raise actual heights`);
    assert(average(mountain) > average(hill) + 1000, `${preset}: mountain relief exceeds hills`);
    assert(average(water) < 0, `${preset}: water paint excavates the template`);
    assert.deepEqual(
      grass.elevation,
      forest.elevation,
      'land cover must not invent different relief',
    );
    for (const i of center) {
      assert(
        grass.diagnostics.cells[i].land,
        'grass paint anchors land while allowing climatic biomes',
      );
      assert.equal(forest.diagnostics.cells[i].biome, 'forest');
      assert.equal(mountain.diagnostics.cells[i].biome, 'mountain');
      assert.equal(water.diagnostics.cells[i].land, false);
    }
    const plain = generateSketchMapV2([], width, height, input);
    for (let i = 0; i < plain.diagnostics.cells.length; i++) {
      const c = plain.diagnostics.cells[i];
      if (Math.hypot(c.x - 320, c.y - 200) > 200)
        assert.equal(
          mountain.elevation!.values[i],
          plain.elevation!.values[i],
          'unpainted template survives exactly',
        );
    }
    if (preset === 'continent') {
      const land = terrainRegion('grass', { id: 'joint_order_land' });
      const lake = terrainRegion('water', { id: 'joint_order_water' });
      for (const regions of [
        [land, lake],
        [lake, land],
      ]) {
        const original = structuredClone(regions);
        const result = generateSketchMapV2(regions, width, height, input);
        const landWins = regions.at(-1)!.biome !== 'water';
        for (const i of center) {
          assert.equal(
            result.diagnostics.cells[i].land,
            landWins,
            'the later overlapping color determines land or water',
          );
          assert.equal(
            result.elevation!.values[i] > 0,
            landWins,
            'paint order changes actual height, not only its color',
          );
        }
        assert.deepEqual(
          regions,
          original,
          'overlap evaluation must not reorder or alter source regions',
        );
      }
    }
    assert.deepEqual(sources, originalSources, 'template blending must not alter source regions');
    assert.deepEqual(input, originalRecipe, 'template blending must not alter the saved recipe');
  }
});

test('template foothills fade past the old brush bound without a rectangular height cutoff', () => {
  const input = { ...recipe, rivers: false, routes: false, settlements: 0, elevation: settings() };
  const plain = generateSketchMapV2([], width, height, input);
  const painted = generateSketchMapV2(
    [terrainRegion('mountain', { width: 100 })],
    width,
    height,
    input,
  );
  const row = Math.floor(200 / painted.diagnostics.cellHeight);
  const columns = painted.diagnostics.columns;
  const differences = Array.from({ length: columns }, (_, x) => {
    const i = row * columns + x;
    return painted.elevation!.values[i] - plain.elevation!.values[i];
  });
  const oldBound = Math.ceil(400 / painted.diagnostics.cellWidth);
  assert(differences[oldBound] > 100, 'the old bounding box must not chop off the foothill');
  for (let x = oldBound - 1; x < oldBound + 6; x++)
    assert(
      Math.abs(differences[x + 1] - differences[x]) < 250,
      'foothill must fade over successive samples',
    );
  const beyond = Math.ceil(432 / painted.diagnostics.cellWidth);
  assert.equal(differences[beyond], 0, 'the distant template remains unchanged');
});

test('newly exposed painted land keeps its biome, while raised water becomes a real land biome', () => {
  const noNetworks = { ...recipe, rivers: false, routes: false, settlements: 0 };
  for (const biome of ['forest', 'mountain'] as const) {
    const region = terrainRegion(biome, { width: 80, roughness: 1 });
    const before = generateSketchMapV2([region], width, height, noNetworks);
    const after = generateSketchMapV2([region], width, height, {
      ...noNetworks,
      elevation: settings(),
    });
    const exposed = before.diagnostics.cells.flatMap((c, i) =>
      !c.land && Math.hypot(c.x - 320, c.y - 200) < 40 && after.diagnostics.cells[i].land
        ? [i]
        : [],
    );
    assert(exposed.length > 0, `${biome}: fixture must contain an exposed painted coast`);
    for (const i of exposed) assert.equal(after.diagnostics.cells[i].biome, biome);
  }
  const sea = terrainRegion('water');
  const raised = generateSketchMapV2([sea], width, height, {
    ...noNetworks,
    elevation: {
      ...settings(),
      strokes: [
        stroke({
          operation: 'flatten',
          points: [{ x: 320, y: 200 }],
          width: 180,
          strength: 1,
          target: 4200,
        }),
      ],
    },
  });
  const center = raised.diagnostics.cells.filter((c) => Math.hypot(c.x - 320, c.y - 200) < 10);
  assert(center.length > 0 && center.every((c) => c.land && c.biome === 'mountain'));
});

test('height strokes are replayed after terrain intent and can carve a mountain or raise painted water', () => {
  const noNetworks = { ...recipe, rivers: false, routes: false, settlements: 0 };
  for (const [biome, target] of [
    ['mountain', -1600],
    ['water', 4200],
  ] as const) {
    const region = terrainRegion(biome);
    const input = {
      ...settings(),
      strokes: [
        stroke({
          operation: 'flatten',
          points: [{ x: 320, y: 200 }],
          width: 180,
          strength: 1,
          target,
        }),
      ],
    };
    const result = generateSketchMapV2([region], width, height, {
      ...noNetworks,
      elevation: input,
    });
    const center = result.diagnostics.cells.filter((c) => Math.hypot(c.x - 320, c.y - 200) < 3);
    assert(center.length > 0);
    for (const c of center) {
      assert.equal(c.land, target > 0, `${biome}: explicit height editing must win over terrain`);
      if (target < 0) assert.equal(c.biome, 'water');
      assert(
        Math.abs(c.elevation * 6000 - target) < 300,
        'the final target must not be uplifted a second time',
      );
    }
  }
});

test('elevation artwork and frozen generated relief pass strict workspace validation without changing the recipe', () => {
  const data = createSeed();
  const map = data.maps[0];
  map.width = width;
  map.height = height;
  map.pins = [];
  map.strokes = [];
  map.editor = {
    version: 1,
    mode: 'sculpt',
    baseVisible: false,
    regions: [],
    objects: [],
    generation: { ...recipe, elevation: settings() },
  };
  const original = structuredClone(map);
  const result = generated();
  const artwork = buildElevationArtwork(result.elevation!);
  strictObjects(artwork);
  assert(artwork.some((object) => object.kind === 'path' && object.name.includes('等高线')));
  map.editor.objects = artwork;
  assert.deepEqual(validateWorkspace(data), data);
  map.editor.objects = [];
  const baked = bakeMapArtwork(map);
  assert.deepEqual(map, original, 'converting artwork must not mutate the live recipe');
  strictObjects(baked);
  const { generation: _generation, ...editor } = map.editor;
  map.editor = { ...editor, mode: 'detail', objects: baked };
  assert.deepEqual(validateWorkspace(data), data);
  assert.deepEqual(JSON.parse(JSON.stringify(data)), data);
});
