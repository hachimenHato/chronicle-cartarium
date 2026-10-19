import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MapRegion, MapPoint } from '../shared/cartography';
import { createSeed } from '../shared/seed';
import {
  composeTerrainRegions,
  createEditorData,
  bakeMapArtwork,
  pointInRegion,
} from '../src/lib/cartography';
import { pointInPolygon } from '../src/lib/terrain';
import { makeSmartGroup } from '../src/lib/map-brushes';
import { validateWorkspace } from '../server/validation';

const region = (id: string, changes: Partial<MapRegion> = {}): MapRegion => ({
  id,
  name: id,
  biome: 'forest',
  geometry: 'brush',
  points: [
    { x: 180, y: 240 },
    { x: 590, y: 260 },
  ],
  width: 160,
  seed: 412,
  roughness: 0.5,
  density: 0.9,
  visible: true,
  locked: false,
  ...changes,
});
const contains = (objects: ReturnType<typeof composeTerrainRegions>, p: MapPoint) =>
  objects.filter(
    (o) => o.kind === 'polygon' && o.id.includes('_edge3_') && pointInPolygon(p, o.points),
  );

test('same biome strokes form one shared interior, soft edges and deterministic output', () => {
  const a = region('union_a', {
      biome: 'grass',
      width: 190,
      points: [
        { x: 230, y: 260 },
        { x: 420, y: 260 },
      ],
    }),
    b = region('union_b', {
      biome: 'grass',
      width: 190,
      points: [
        { x: 370, y: 290 },
        { x: 560, y: 290 },
      ],
    });
  const input = [a, b],
    before = structuredClone(input),
    out = composeTerrainRegions(input, 1000, 640);
  assert.equal(
    contains(out, { x: 390, y: 275 }).length,
    1,
    'overlap has one combined opaque surface, not two brush fills',
  );
  assert.equal(contains(out, { x: 240, y: 260 }).length, 1);
  assert.equal(contains(out, { x: 540, y: 290 }).length, 1);
  assert(
    out.some((o) => o.kind === 'polygon' && o.opacity > 0 && o.opacity < 1),
    'feather bands are generated',
  );
  assert.deepEqual(out, composeTerrainRegions(input, 1000, 640));
  assert.deepEqual(input, before);
});

test('later water cuts forest and its symbols; repainting land can reclaim it', () => {
  const forest = region('forest'),
    water = region('lake', {
      biome: 'water',
      width: 125,
      points: [
        { x: 360, y: 170 },
        { x: 380, y: 320 },
      ],
      density: 0.5,
    });
  const out = composeTerrainRegions([forest, water], 1000, 640);
  assert(
    out.some((o) => o.kind === 'symbol'),
    'forest retains trees outside the lake',
  );
  assert(
    out.filter((o) => o.kind === 'symbol').every((o) => !pointInRegion(o.points[0], water)),
    'no drowned automatic trees',
  );
  assert(contains(out, { x: 370, y: 240 }).every((o) => o.id.includes('_water_')));
  const reclaimed = composeTerrainRegions(
    [forest, water, region('grass', { biome: 'grass', points: [{ x: 370, y: 240 }], width: 70 })],
    1000,
    640,
  );
  assert(contains(reclaimed, { x: 370, y: 240 }).every((o) => o.id.includes('_grass_')));
});

test('composition retains an unpainted hole and ignores hidden regions', () => {
  const loop = region('loop', {
    points: [
      { x: 160, y: 160 },
      { x: 440, y: 160 },
      { x: 440, y: 440 },
      { x: 160, y: 440 },
      { x: 160, y: 160 },
    ],
    width: 70,
  });
  const out = composeTerrainRegions([loop], 600, 600);
  assert.equal(contains(out, { x: 300, y: 300 }).length, 0);
  assert.equal(composeTerrainRegions([{ ...loop, visible: false }], 600, 600).length, 0);
  assert(
    composeTerrainRegions([{ ...loop, density: 0 }], 600, 600).every(
      (o) => !o.id.includes('_decor_'),
    ),
  );
});

test('baked composition round-trips validation without changing source or other maps', () => {
  const data = createSeed(),
    map = data.maps[0];
  map.editor = {
    ...createEditorData(),
    baseVisible: false,
    regions: [
      region('forest'),
      region('lake', { biome: 'water', points: [{ x: 450, y: 270 }], width: 100 }),
    ],
  };
  const before = structuredClone(data),
    composed = composeTerrainRegions(map.editor.regions, map.width, map.height);
  const baked = bakeMapArtwork(map);
  assert.deepEqual(
    baked,
    composed.map((o) => ({ ...parchmentObject(o), layer: 'base' })),
  );
  assert.deepEqual(data, before);
  map.editor = { ...map.editor, regions: [], objects: baked };
  assert.deepEqual(validateWorkspace(data), data);
  assert.deepEqual(data.maps[1], before.maps[1]);
});

test('smart settlement groups use one landmark, mixed surroundings and avoid painted water', () => {
  const map = createSeed().maps[0];
  map.editor = createEditorData();
  const group = makeSmartGroup(map, { x: 400, y: 300 }, 'castle', 180, 36, 0.8, 91);
  assert.equal(group.objects.filter((o) => o.symbol === 'castle').length, 1);
  assert(group.objects.some((o) => o.symbol === 'house'));
  assert(group.objects.some((o) => o.symbol === 'farmland'));
  assert(group.objects.some((o) => o.kind === 'path'));
  map.editor.regions = [
    region('lake', { biome: 'water', points: [{ x: 400, y: 300 }], width: 200 }),
  ];
  assert.equal(
    makeSmartGroup(map, { x: 400, y: 300 }, 'castle', 180, 36, 0.8, 91).objects.length,
    0,
  );
  assert.equal(
    makeSmartGroup(
      { ...map, editor: createEditorData() },
      { x: 400, y: 300 },
      'port',
      180,
      36,
      0.8,
      91,
    ).objects.length,
    0,
  );
});

test('converting the visible terrain does not discard hidden authored regions', () => {
  const map = createSeed().maps[0];
  const hidden = region('hidden', { name: '保留的森林', visible: false, locked: true });
  map.editor = { ...createEditorData(), baseVisible: false, regions: [hidden] };
  const result = bakeMapArtwork(map);
  assert(result.length > 0);
  assert(
    result.every(
      (object) => !object.visible && object.locked && object.name.startsWith('保留的森林'),
    ),
  );
  assert.deepEqual(map.editor.regions, [hidden]);
});
import { parchmentObject } from '../src/lib/map-palette';
