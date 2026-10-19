import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generationSignature,
  legacyGenerationSignature,
  matchesGenerationSignature,
  restoreElevation,
  snapshotElevation,
} from '../src/lib/generated-map';
import { frontierGraph, followFrontEdge, snapFrontPoint, lineOnFront } from '../src/lib/military';
import { assignGeographicCells } from '../src/lib/geographic-edits';
import type { GeneratedGeography } from '../shared/geography';
import type { SketchGenerationV2 } from '../shared/cartography';
import { createExampleWorkspace } from '../shared/example';
import { validateWorkspace } from '../server/validation';

function reverseObjectKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseObjectKeys) as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, reverseObjectKeys(child)]),
    ) as T;
  return value;
}
const g: GeneratedGeography = {
  version: 1,
  seed: 4,
  width: 100,
  height: 100,
  plates: [],
  areas: [],
  ports: [],
  seaRoutes: [],
  divisions: [
    { id: 'a', name: '甲国', kind: 'country', color: '#779977', center: { x: 25, y: 50 } },
    { id: 'b', name: '乙国', kind: 'country', color: '#997777', center: { x: 75, y: 50 } },
  ],
  cells: [0, 1].map((id) => ({
    id,
    center: { x: 25 + 50 * id, y: 50 },
    polygon: [
      { x: id * 50, y: 0 },
      { x: id * 50 + 50, y: 0 },
      { x: id * 50 + 50, y: 100 },
      { x: id * 50, y: 100 },
    ],
    neighbors: [1 - id],
    land: true,
    plate: 0,
    elevation: 50,
    temperature: 20,
    precipitation: 900,
    biome: 'grass',
    shelf: false,
    country: id ? 'b' : 'a',
  })),
  borders: [
    {
      id: 'edge',
      kind: 'cell',
      cells: [0, 1],
      points: [
        { x: 50, y: 0 },
        { x: 47, y: 50 },
        { x: 50, y: 100 },
      ],
    },
  ],
};
test('saved generation keys ignore authored names and change with physical inputs', () => {
  const recipe: SketchGenerationV2 = {
    version: 2,
    seed: 1,
    climate: 'temperate',
    detail: 'standard',
    rivers: true,
    routes: true,
    settlements: 4,
  };
  const key = generationSignature([], 100, 100, recipe, 400, 'region');
  assert.equal(
    generationSignature(
      [],
      100,
      100,
      { ...recipe, settlementNames: { town_0: '自定义' } },
      400,
      'region',
    ),
    key,
  );
  assert.notEqual(generationSignature([], 100, 100, { ...recipe, seed: 2 }, 400, 'region'), key);
  assert.notEqual(generationSignature([], 100, 100, recipe, 800, 'region'), key);
  const region = {
    id: 'r',
    name: '原名',
    biome: 'grass' as const,
    geometry: 'brush' as const,
    points: [{ x: 50, y: 50 }],
    width: 20,
    seed: 3,
    roughness: 0.5,
    density: 0.5,
    visible: true,
    locked: false,
  };
  assert.equal(
    generationSignature([region], 100, 100, recipe),
    generationSignature([{ ...region, name: '新名', locked: true }], 100, 100, recipe),
  );
  const field = {
    columns: 2,
    rows: 2,
    width: 100,
    height: 100,
    values: new Float32Array([-125.5, 0, 700.6, 998.4]),
    min: -125.5,
    max: 998.4,
  };
  const saved = snapshotElevation(field)!;
  assert.deepEqual(
    restoreElevation(JSON.parse(JSON.stringify(saved)))!.values,
    Float32Array.from([-125, 0, 701, 998]),
  );
});
test('generation signatures survive real server normalization of regions and nested recipes', () => {
  const data = JSON.parse(JSON.stringify(createExampleWorkspace())) as ReturnType<
    typeof createExampleWorkspace
  >;
  for (const map of data.maps) {
    map.editor!.generation = reverseObjectKeys(map.editor!.generation);
    map.editor!.regions = reverseObjectKeys(map.editor!.regions);
  }
  const normalized = validateWorkspace(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(normalized, data);
  for (let index = 0; index < data.maps.length; index++) {
    const before = data.maps[index],
      after = normalized.maps[index];
    const args = (map: typeof before) =>
      [
        map.editor!.regions,
        map.width,
        map.height,
        map.editor!.generation,
        map.scaleKm,
        map.kind,
      ] as const;
    assert.notEqual(
      legacyGenerationSignature(...args(before)),
      legacyGenerationSignature(...args(after)),
    );
    assert.equal(generationSignature(...args(before)), generationSignature(...args(after)));
  }
});
test('generation signatures sort nested keys while preserving array order and physical values', () => {
  const map = createExampleWorkspace().maps[0],
    regions = map.editor!.regions,
    recipe = map.editor!.generation as SketchGenerationV2;
  recipe.elevation!.strokes = [
    {
      id: 'stroke',
      operation: 'raise',
      points: [
        { x: 80, y: 100 },
        { x: 120, y: 160 },
      ],
      width: 30,
      strength: 0.4,
      target: 0,
    },
  ];
  const signature = generationSignature(
    regions,
    map.width,
    map.height,
    recipe,
    map.scaleKm,
    map.kind,
  );
  assert.equal(
    generationSignature(
      reverseObjectKeys(regions),
      map.width,
      map.height,
      reverseObjectKeys(recipe),
      map.scaleKm,
      map.kind,
    ),
    signature,
  );
  const optionalRecipe = { ...recipe, geography: undefined, elevation: undefined };
  assert.equal(
    generationSignature(regions, map.width, map.height, optionalRecipe, map.scaleKm, map.kind),
    generationSignature(
      regions,
      map.width,
      map.height,
      JSON.parse(JSON.stringify(optionalRecipe)),
      map.scaleKm,
      map.kind,
    ),
  );
  assert.notEqual(
    generationSignature(
      [...regions].reverse(),
      map.width,
      map.height,
      recipe,
      map.scaleKm,
      map.kind,
    ),
    signature,
  );
  const reversedStroke = structuredClone(recipe);
  reversedStroke.elevation!.strokes[0].points.reverse();
  assert.notEqual(
    generationSignature(regions, map.width, map.height, reversedStroke, map.scaleKm, map.kind),
    signature,
  );
  const changedHeight = structuredClone(recipe);
  changedHeight.elevation!.strokes[0].strength = 0.5;
  assert.notEqual(
    generationSignature(regions, map.width, map.height, changedHeight, map.scaleKm, map.kind),
    signature,
  );
});
test('legacy snapshots remain readable only for their unchanged physical recipe', () => {
  const recipe: SketchGenerationV2 = {
    version: 2,
    seed: 1,
    climate: 'temperate',
    detail: 'standard',
    rivers: true,
    routes: true,
    settlements: 4,
  };
  const legacy = legacyGenerationSignature([], 100, 100, recipe, 400, 'region'),
    canonical = generationSignature([], 100, 100, recipe, 400, 'region');
  assert.equal(
    legacy,
    '07b6c5ace68a95e4-86',
    'retain the original hash and serialized source exactly',
  );
  assert.notEqual(legacy, canonical);
  for (const signature of [legacy, canonical]) {
    assert(matchesGenerationSignature(signature, [], 100, 100, recipe, 400, 'region'));
    assert(
      matchesGenerationSignature(
        signature,
        [],
        100,
        100,
        {
          ...recipe,
          settlementNames: { town_0: '新名称' },
          settlementLinks: { town_0: 'new_location' },
        },
        400,
        'region',
      ),
    );
    assert(
      !matchesGenerationSignature(signature, [], 100, 100, { ...recipe, seed: 2 }, 400, 'region'),
    );
    assert(!matchesGenerationSignature(signature, [], 100, 100, recipe, 500, 'region'));
    assert(!matchesGenerationSignature(signature, [], 100, 100, recipe, 400, 'world'));
  }
  assert(!matchesGenerationSignature(undefined, [], 100, 100, recipe, 400, 'region'));
});
test('fronts follow bent shared cell edges and cannot shortcut interior terrain', () => {
  const graph = frontierGraph(g),
    first = snapFrontPoint({ x: 50, y: 0 }, graph, 10)!,
    last = snapFrontPoint({ x: 50, y: 100 }, graph, 10)!;
  const route = followFrontEdge(graph, first, last);
  assert.equal(route.length, 3);
  assert.equal(lineOnFront(route, g), true);
  assert.equal(
    lineOnFront(
      [
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ],
      g,
    ),
    false,
  );
  assert.equal(snapFrontPoint({ x: 0, y: 50 }, graph, 10), undefined);
});
test('changing cell ownership recomputes political boundaries and keeps geographic data', () => {
  const next = assignGeographicCells(g, 'a', new Set([1]));
  assert.equal(next.cells[1].country, 'a');
  assert.deepEqual(
    next.cells.map((c) => c.elevation),
    g.cells.map((c) => c.elevation),
  );
  assert.equal(next.borders.filter((b) => b.kind === 'country').length, 0);
  assert.equal(g.cells[1].country, 'b');
  assert.deepEqual(
    next.borders.filter((b) => b.kind === 'cell'),
    g.borders,
  );
});
