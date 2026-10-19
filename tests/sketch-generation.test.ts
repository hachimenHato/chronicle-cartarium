import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAP_EDITOR_LIMITS,
  type MapPoint,
  type MapRegion,
  type SketchGenerationSettings,
} from '../shared/cartography';
import { createSeed } from '../shared/seed';
import { validateWorkspace } from '../server/validation';
import { generateSketchMap } from '../src/lib/sketch-generation';
import { bakeMapArtwork } from '../src/lib/cartography';
import { createEditorFixture } from './fixtures/map-editor';

const settings: SketchGenerationSettings = {
  version: 1,
  seed: 2741,
  climate: 'temperate',
  settlements: 7,
  rivers: true,
  routes: true,
};
const region = (
  id: string,
  biome: MapRegion['biome'],
  points: MapPoint[],
  width: number,
): MapRegion => ({
  id,
  name: id,
  biome,
  points,
  width,
  geometry: 'brush',
  seed: 105,
  roughness: 0.35,
  density: 0.75,
  visible: true,
  locked: false,
});
const source: MapRegion[] = [
  region(
    'sketch_land_north',
    'grass',
    [
      { x: 245, y: 300 },
      { x: 740, y: 315 },
    ],
    320,
  ),
  region(
    'sketch_land_south',
    'grass',
    [
      { x: 340, y: 385 },
      { x: 700, y: 410 },
    ],
    280,
  ),
  region(
    'sketch_ridge',
    'mountain',
    [
      { x: 410, y: 225 },
      { x: 635, y: 265 },
    ],
    95,
  ),
  region(
    'sketch_woods',
    'forest',
    [
      { x: 300, y: 340 },
      { x: 425, y: 390 },
    ],
    125,
  ),
  region(
    'sketch_lake',
    'water',
    [
      { x: 675, y: 390 },
      { x: 725, y: 400 },
    ],
    70,
  ),
];
const generate = (regions = source, recipe = settings, width = 1000, height = 700) =>
  generateSketchMap(regions, width, height, recipe);
type Result = ReturnType<typeof generate>;
function cellAt(result: Result, point: MapPoint) {
  const { columns, rows, cellWidth, cellHeight, cells } = result.diagnostics;
  const column = Math.max(0, Math.min(columns - 1, Math.floor(point.x / cellWidth)));
  const row = Math.max(0, Math.min(rows - 1, Math.floor(point.y / cellHeight)));
  return cells[row * columns + column];
}

test('sketch generation is deterministic, produces a complete map and does not change authored sources', () => {
  const input = structuredClone(source),
    recipe = structuredClone(settings);
  const result = generate(input, recipe);
  assert.deepEqual(result, generate(input, recipe));
  assert.deepEqual(input, source);
  assert.deepEqual(recipe, settings);
  assert(result.objects.length > 30, 'the result includes artwork beyond authored color blocks');
  assert(result.stats.rivers > 0, 'a broad mainland supports a river network');
  assert(result.stats.settlements >= 2, 'a broad mainland supports settlements');
  assert(result.stats.settlements <= settings.settlements);
  assert(result.stats.roads > 0, 'accessible settlements are connected');
});

test('new seeds vary details while retaining painted land, mountain, forest and water intent', () => {
  const first = generate();
  const varied = generate(source, { ...settings, seed: settings.seed + 1 });
  assert.notDeepEqual(first.objects, varied.objects);
  for (const result of [first, varied]) {
    assert.equal(cellAt(result, { x: 80, y: 70 }).land, false);
    assert.equal(cellAt(result, { x: 550, y: 375 }).land, true);
    assert.equal(cellAt(result, { x: 700, y: 395 }).land, false);
    assert.equal(cellAt(result, { x: 510, y: 243 }).biome, 'mountain');
    assert.equal(cellAt(result, { x: 360, y: 363 }).biome, 'forest');
    assert(
      cellAt(result, { x: 510, y: 243 }).elevation > cellAt(result, { x: 550, y: 375 }).elevation,
    );
  }
});

test('drainage descends to water or the boundary without loops and rivers follow that network', () => {
  const { diagnostics } = generate();
  const { cells, columns, rows, rivers } = diagnostics;
  assert(rivers.length > 0);
  for (let start = 0; start < cells.length; start++) {
    if (!cells[start].land) continue;
    const visited = new Set<number>();
    let index = start;
    while (cells[index].downstream !== -1) {
      assert(!visited.has(index), `drainage cycle from ${start}`);
      visited.add(index);
      const next = cells[index].downstream;
      assert(Number.isInteger(next) && next >= 0 && next < cells.length);
      assert(
        cells[next].drainageElevation <= cells[index].drainageElevation,
        'flow cannot climb its drainage surface',
      );
      index = next;
    }
    const boundary =
      index < columns ||
      index >= columns * (rows - 1) ||
      index % columns === 0 ||
      index % columns === columns - 1;
    assert(!cells[index].land || boundary, 'land drainage terminates only at a map boundary');
  }
  for (const river of rivers) {
    assert(river.length >= 2);
    for (let i = 1; i < river.length; i++) {
      assert.equal(cells[river[i - 1]].downstream, river[i]);
    }
  }
});

test('forest cover and settlements avoid final painted water, including later lake strokes', () => {
  const result = generate();
  const { cells, vegetation, settlements } = result.diagnostics;
  assert(vegetation.length > 0);
  assert(settlements.length > 0);
  assert(
    [...vegetation, ...settlements].every(
      (index) => cells[index].land && cells[index].biome !== 'water',
    ),
  );
  for (const object of result.objects.filter(
    (item) => item.symbol === 'city' || item.symbol === 'village',
  )) {
    assert(cellAt(result, object.points[0]).land);
  }
  const flooded = generate([...source, region('sketch_flood', 'water', [{ x: 360, y: 360 }], 180)]);
  assert.equal(cellAt(flooded, { x: 360, y: 360 }).land, false);
  assert(flooded.diagnostics.vegetation.every((index) => flooded.diagnostics.cells[index].land));
  assert(flooded.diagnostics.settlements.every((index) => flooded.diagnostics.cells[index].land));
});

test('roads remain on connected land and do not join separated islands through the sea', () => {
  const islands = [
    region(
      'island_west',
      'grass',
      [
        { x: 210, y: 250 },
        { x: 250, y: 445 },
      ],
      240,
    ),
    region(
      'island_east',
      'grass',
      [
        { x: 740, y: 250 },
        { x: 780, y: 445 },
      ],
      240,
    ),
  ];
  const result = generate(islands, { ...settings, settlements: 10 });
  const { cells, routes } = result.diagnostics;
  assert(result.stats.settlements > 1);
  for (const route of routes) {
    assert(route.length > 1);
    assert(route.every((index) => cells[index].land));
    const firstSide = cells[route[0]].x < 500;
    assert(route.every((index) => cells[index].x < 500 === firstSide));
  }
  for (const object of result.objects.filter((item) => item.name.startsWith('道路'))) {
    for (let i = 1; i < object.points.length; i++) {
      const a = object.points[i - 1],
        b = object.points[i];
      for (let step = 0; step <= 4; step++) {
        assert(
          cellAt(result, { x: a.x + ((b.x - a.x) * step) / 4, y: a.y + ((b.y - a.y) * step) / 4 })
            .land,
          'rendered road segments cannot cut across water',
        );
      }
    }
  }
});

test('blank or hidden sketches generate no land; disabled optional systems leave no artifacts', () => {
  const empty = generate([]),
    hidden = generate(source.map((item) => ({ ...item, visible: false })));
  assert.equal(empty.objects.length, 0);
  assert.equal(hidden.objects.length, 0);
  assert.equal(empty.stats.landCells, 0);
  assert.equal(hidden.stats.settlements, 0);
  const result = generate(source, { ...settings, settlements: 0, rivers: false, routes: false });
  assert.equal(result.stats.rivers, 0);
  assert.equal(result.stats.settlements, 0);
  assert.equal(result.stats.roads, 0);
  assert.equal(result.diagnostics.rivers.length, 0);
  assert.equal(result.diagnostics.settlements.length, 0);
  assert.equal(result.diagnostics.routes.length, 0);
  assert(!result.objects.some((item) => /^(河流|道路|聚落)/.test(item.name)));
});

test('derived artwork stays within storage capacity, finite map bounds and strict workspace validation', () => {
  const data = createSeed(),
    before = structuredClone(data.maps[1]);
  const map = data.maps[0];
  map.width = 1000;
  map.height = 700;
  const result = generate();
  assert(result.objects.length <= MAP_EDITOR_LIMITS.objects);
  assert.equal(new Set(result.objects.map((item) => item.id)).size, result.objects.length);
  for (const object of result.objects) {
    assert(object.points.length <= MAP_EDITOR_LIMITS.points);
    for (const point of object.points) {
      assert(Number.isFinite(point.x) && Number.isFinite(point.y));
      assert(point.x >= 0 && point.x <= map.width, `${object.name} outside horizontal bounds`);
      assert(point.y >= 0 && point.y <= map.height, `${object.name} outside vertical bounds`);
    }
  }
  map.editor = {
    version: 1,
    mode: 'detail',
    baseVisible: false,
    regions: [],
    objects: result.objects,
  };
  assert.deepEqual(validateWorkspace(data), data);
  assert.deepEqual(data.maps[1], before);
});

test('freezing matching recipes on two maps keeps manual content, hidden authoring and pins with globally unique IDs', () => {
  const data = createSeed();
  const manual = createEditorFixture().objects;
  data.maps.forEach((map, index) => {
    map.width = 1000;
    map.height = 700;
    map.editor = {
      version: 1,
      mode: 'sketch',
      baseVisible: false,
      generation: { ...settings },
      regions: source.map((item) => ({ ...structuredClone(item), id: `map${index}_${item.id}` })),
      objects: index === 0 ? structuredClone(manual) : [],
    };
    map.strokes = [];
  });
  const first = data.maps[0];
  first.editor!.regions.push({
    ...region('hidden_sketch_woods', 'forest', [{ x: 160, y: 500 }], 60),
    name: '隐藏构思',
    visible: false,
    locked: true,
  });
  const before = structuredClone(data);
  const frozen = data.maps.map((map) => bakeMapArtwork(map));
  assert.deepEqual(data, before, 'freezing computes an independent snapshot');
  assert(
    frozen[0].some((item) => item.name.startsWith('隐藏构思') && !item.visible && item.locked),
  );
  for (const authored of manual) {
    assert.deepEqual(
      frozen[0].find((item) => item.id === authored.id),
      { ...authored, layer: 'base' },
    );
  }
  const allIds = frozen.flat().map((item) => item.id);
  assert.equal(
    new Set(allIds).size,
    allIds.length,
    'identical recipes must not collide across maps',
  );
  data.maps.forEach((map, index) => {
    map.editor = {
      version: 1,
      mode: 'detail',
      baseVisible: false,
      regions: [],
      objects: frozen[index],
    };
    assert.deepEqual(map.pins, before.maps[index].pins);
  });
  assert.deepEqual(validateWorkspace(data), data);
});

test('one full-canvas color remains exportable and editable for each land biome', () => {
  const data = createSeed();
  const map = data.maps[0];
  map.width = 1000;
  map.height = 700;
  for (const biome of ['grass', 'forest', 'mountain', 'desert', 'swamp', 'snow'] as const) {
    const solid: MapRegion = {
      ...region(
        'solid_sketch',
        biome,
        [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 1000, y: 700 },
          { x: 0, y: 700 },
        ],
        160,
      ),
      geometry: 'polygon',
    };
    const result = generate([solid]);
    assert(result.stats.landCells > 0);
    assert(result.objects.length <= MAP_EDITOR_LIMITS.objects, `${biome} exceeds object capacity`);
    assert(
      result.objects.every((item) => item.points.length <= MAP_EDITOR_LIMITS.points),
      `${biome} exceeds contour capacity`,
    );
    map.editor = {
      version: 1,
      mode: 'detail',
      baseVisible: false,
      regions: [],
      objects: result.objects,
    };
    assert.deepEqual(
      validateWorkspace(data),
      data,
      `${biome} must survive strict persistence validation`,
    );
  }
});

test('region density controls generated details and mountain roughness changes relief', () => {
  const bare = generate(source.map((item) => ({ ...item, density: 0 })));
  assert.equal(bare.diagnostics.vegetation.length, 0);
  assert(!bare.objects.some((item) => /^(林冠|草甸纹理|沙丘细纹|山坡排线)/.test(item.name)));
  assert(generate().diagnostics.vegetation.length > 0);
  const gentle = generate(source.map((item) => ({ ...item, roughness: 0 })));
  const rugged = generate(source.map((item) => ({ ...item, roughness: 1 })));
  assert(
    cellAt(rugged, { x: 510, y: 243 }).elevation > cellAt(gentle, { x: 510, y: 243 }).elevation,
  );
});
