import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AtlasMap } from '../shared/model.ts';
import type { MapRegion, TerrainBiome } from '../shared/cartography.ts';
import { biomeCatalog, symbolCatalog } from '../shared/cartography.ts';
import {
  bakeMapArtwork,
  composeTerrainRegions,
  createEditorData,
  createMapObject,
  generateRegionObjects,
  pointInRegion,
} from '../src/lib/cartography.ts';
import { generateTerrain, pointInPolygon } from '../src/lib/terrain.ts';
import { parchmentObject } from '../src/lib/map-palette';

const region = (changes: Partial<MapRegion> = {}): MapRegion => ({
  id: 'region_forest',
  name: '晨雾森林',
  biome: 'forest',
  geometry: 'brush',
  points: [
    { x: 120, y: 220 },
    { x: 360, y: 200 },
    { x: 600, y: 260 },
  ],
  width: 180,
  seed: 8421,
  roughness: 0.7,
  density: 0.8,
  visible: true,
  locked: false,
  ...changes,
});
const map = (changes: Partial<AtlasMap> = {}): AtlasMap => ({
  id: 'map_test',
  worldId: 'world_test',
  name: '验收地图',
  summary: '',
  kind: 'world',
  seed: 47,
  width: 1000,
  height: 640,
  pins: [],
  strokes: [],
  ...changes,
});

test('cartography catalogs cover fourteen biomes and sixty-six editable map symbols', () => {
  assert.equal(biomeCatalog.length, 14);
  assert.equal(new Set(biomeCatalog.map((b) => b.id)).size, 14);
  assert.equal(symbolCatalog.length, 66);
  assert.equal(new Set(symbolCatalog.map((s) => s.id)).size, 66);
  assert.deepEqual(createEditorData(), {
    version: 1,
    mode: 'sketch',
    baseVisible: true,
    regions: [],
    objects: [],
  });
  const object = createMapObject('symbol', { x: 2, y: 3 }, { symbol: 'castle', color: 'none' });
  assert.equal(object.symbol, 'castle');
  assert.equal(object.color, 'none');
  assert.deepEqual(object.points, [{ x: 2, y: 3 }]);
});

test('natural brush generation is repeatable with an organic polygon and stable identities', () => {
  const input = region();
  const before = structuredClone(input);
  const a = generateRegionObjects(input, 1000, 640);
  assert.deepEqual(a, generateRegionObjects(structuredClone(input), 1000, 640));
  assert.deepEqual(input, before);
  assert.ok(a.some((o) => o.kind === 'polygon' && o.points.length > 30));
  assert.ok(a.some((o) => o.kind === 'symbol'));
  assert.notDeepEqual(a, generateRegionObjects(region({ seed: 8422 }), 1000, 640));
  assert.equal(a.filter((o) => o.kind === 'symbol').length <= 160, true);
  assert.equal(a.length, new Set(a.map((o) => o.id)).size);
});

test('a bent painted brush retains its bay instead of becoming a convex hull', () => {
  const u = region({
    points: [
      { x: 100, y: 100 },
      { x: 100, y: 320 },
      { x: 340, y: 320 },
      { x: 340, y: 100 },
    ],
    width: 70,
    roughness: 0.5,
  });
  const objects = generateRegionObjects(u, 500, 440).filter((o) => o.kind === 'polygon');
  assert.ok(pointInRegion({ x: 100, y: 220 }, u));
  assert.ok(!pointInRegion({ x: 220, y: 180 }, u));
  assert.ok(objects.some((o) => pointInPolygon({ x: 100, y: 220 }, o.points)));
  assert.ok(objects.every((o) => !pointInPolygon({ x: 220, y: 180 }, o.points)));
});

test('closed painted loops retain interior holes in the generated editable surface', () => {
  const ring = region({
    points: [
      { x: 100, y: 100 },
      { x: 340, y: 100 },
      { x: 340, y: 340 },
      { x: 100, y: 340 },
      { x: 100, y: 100 },
    ],
    width: 70,
    roughness: 0.4,
  });
  const objects = generateRegionObjects(ring, 460, 460).filter((o) => o.kind === 'polygon');
  assert.ok(objects.length > 0);
  assert.ok(objects.some((o) => pointInPolygon({ x: 100, y: 220 }, o.points)));
  assert.ok(objects.every((o) => !pointInPolygon({ x: 220, y: 220 }, o.points)));
});

test('long narrow painted regions simplify sampling vertices without filling their gaps', () => {
  const points = [];
  for (let y = 20, row = 0; y <= 620; y += 50, row++) {
    points.push({ x: row % 2 ? 960 : 40, y }, { x: row % 2 ? 40 : 960, y });
  }
  assert.equal(points.length, 26);
  for (const width of [20, 40]) {
    const input = region({ points, width, seed: 3, roughness: 0.4 });
    const before = structuredClone(input);
    const surfaces = generateRegionObjects(input, 1000, 640).filter((o) => o.kind === 'polygon');
    assert.ok(surfaces.length > 0);
    assert.ok(surfaces.every((o) => o.points.length <= 2000));
    for (let y = 20; y <= 620; y += 50) {
      assert.ok(
        surfaces.some((o) => pointInPolygon({ x: 500, y }, o.points)),
        'painted band was lost',
      );
      if (y + 50 <= 620)
        assert.ok(
          surfaces.every((o) => !pointInPolygon({ x: 500, y: y + 25 }, o.points)),
          'gap between painted bands was filled',
        );
    }
    assert.deepEqual(input, before, 'simplification must not mutate the original painted stroke');
  }
});

test('region outlines and the complete generated symbol footprint stay inside the map', () => {
  const input = region({
    points: [
      { x: 0, y: 0 },
      { x: 170, y: 90 },
      { x: 400, y: 300 },
    ],
    width: 200,
    density: 1,
  });
  const objects = generateRegionObjects(input, 400, 300);
  for (const object of objects)
    for (const p of object.points)
      assert.ok(
        p.x >= 0 && p.x <= 400 && p.y >= 0 && p.y <= 300,
        `${object.name} has an out-of-bounds vertex`,
      );
  const surfaces = objects.filter((o) => o.kind === 'polygon');
  for (const object of objects.filter((o) => o.kind === 'symbol')) {
    const origin = object.points[0];
    for (let i = 0; i < 24; i++) {
      const p = {
        x: origin.x + Math.cos((i / 24) * Math.PI * 2) * object.size * 1.65,
        y: origin.y + Math.sin((i / 24) * Math.PI * 2) * object.size * 1.65,
      };
      assert.ok(p.x >= 0 && p.x <= 400 && p.y >= 0 && p.y <= 300);
      assert.ok(
        surfaces.some((o) => pointInPolygon(p, o.points)),
        'symbol spills over its own region boundary',
      );
    }
  }
});

test('biome semantics control automatic content and density zero disables generated decorations', () => {
  const expected: Record<TerrainBiome, string[]> = {
    water: [],
    grass: ['hill', 'tree'],
    forest: ['tree', 'pine'],
    mountain: ['mountain', 'rock', 'hill'],
    desert: ['dune', 'rock'],
    swamp: ['reeds', 'tree'],
    snow: ['mountain', 'pine', 'rock'],
    hill: ['hill', 'tree', 'rock'],
    plateau: ['hill', 'rock'],
    taiga: ['pine', 'rock'],
    rainforest: ['tree', 'reeds'],
    savanna: ['tree', 'hill'],
    tundra: ['rock', 'reeds'],
    badlands: ['rock', 'mountain', 'hill'],
  };
  for (const biome of Object.keys(expected) as TerrainBiome[]) {
    const objects = generateRegionObjects(region({ biome }), 1000, 640);
    const symbols = objects.filter((o) => o.kind === 'symbol');
    assert.ok(symbols.every((o) => expected[biome].includes(o.symbol!)));
    if (biome !== 'water')
      assert.ok(symbols.length > 0, `${biome} missing its expected decorations`);
  }
  assert.ok(
    generateRegionObjects(region({ density: 0 }), 1000, 640).every((o) => o.kind === 'polygon'),
  );
});

test('polygon regions preserve concavity and hidden / locked state for every generated object', () => {
  const input = region({
    geometry: 'polygon',
    points: [
      { x: 60, y: 60 },
      { x: 370, y: 60 },
      { x: 370, y: 130 },
      { x: 150, y: 130 },
      { x: 150, y: 370 },
      { x: 60, y: 370 },
    ],
    roughness: 0,
    visible: false,
    locked: true,
  });
  const objects = generateRegionObjects(input, 440, 440);
  assert.ok(objects.length > 0 && objects.every((o) => !o.visible && o.locked));
  assert.ok(pointInRegion({ x: 100, y: 220 }, input));
  assert.ok(!pointInRegion({ x: 240, y: 240 }, input));
  assert.ok(
    objects
      .filter((o) => o.kind === 'polygon')
      .every((o) => !pointInPolygon({ x: 240, y: 240 }, o.points)),
  );
});

test('baking preserves all existing editor objects and strokes without modifying input', () => {
  const text = createMapObject(
    'text',
    { x: 25, y: 36 },
    { id: 'test_text', text: '远古城邦', visible: false, locked: true },
  );
  const input = map({
    editor: { ...createEditorData(), baseVisible: false, regions: [region()], objects: [text] },
    strokes: [
      {
        id: 'road_test',
        color: '#765432',
        width: 4,
        tool: 'road',
        points: [
          { x: 3, y: 3 },
          { x: 40, y: 80 },
        ],
      },
      { id: 'dot_test', color: '#123456', width: 6, tool: 'brush', points: [{ x: 1000, y: 640 }] },
    ],
  });
  const before = structuredClone(input);
  const result = bakeMapArtwork(input);
  assert.deepEqual(
    result.find((o) => o.id === text.id),
    { ...text, layer: 'base' },
  );
  assert.equal(result.filter((o) => o.name.startsWith('原手绘道路')).length, 2);
  assert.ok(result.some((o) => o.name === '原手绘笔画' && o.points.length === 2));
  assert.ok(result.every((o) => o.name !== '底图背景'));
  assert.deepEqual(result, bakeMapArtwork(input));
  assert.deepEqual(input, before);
  assert.equal(result.length, new Set(result.map((o) => o.id)).size);
});

test('legacy world, region and town bases become independently editable vectors', () => {
  for (const kind of ['world', 'region', 'town'] as const) {
    const result = bakeMapArtwork(map({ kind }));
    assert.ok(result.some((o) => o.name === '底图背景' && o.kind === 'polygon'));
    assert.ok(result.some((o) => o.kind === 'symbol'));
    assert.ok(result.some((o) => o.name.startsWith('河流') && o.kind === 'path'));
    if (kind === 'town') {
      assert.ok(result.some((o) => o.name.startsWith('建筑') && o.kind === 'polygon'));
      assert.ok(result.some((o) => o.name === '城墙'));
    } else assert.ok(result.some((o) => o.name.startsWith('大陆') && o.kind === 'polygon'));
    for (const object of result) {
      assert.ok(/^[a-zA-Z0-9_-]{1,100}$/.test(object.id));
      assert.ok(object.points.length <= 2000);
      assert.ok(object.points.every((p) => p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 640));
    }
  }
  assert.equal(bakeMapArtwork(map({ seed: 0 })).length, 1);
});

test('repeated baking preserves new stroke stacking above the previous opaque background', () => {
  const original = map();
  const baked = bakeMapArtwork(original);
  const withInk = map({
    editor: { ...createEditorData(), mode: 'detail', baseVisible: false, objects: baked },
    strokes: [
      {
        id: 'ink_after_baking',
        tool: 'brush',
        color: '#123456',
        width: 20,
        points: [
          { x: 100, y: 100 },
          { x: 300, y: 300 },
        ],
      },
    ],
  });
  const result = bakeMapArtwork(withInk);
  assert.deepEqual(result.slice(0, baked.length), baked);
  assert.equal(result.at(-1)?.name, '原手绘笔画');
  assert.equal(result.at(-1)?.stroke, '#123456');
});

test('baking retains base, region, detail and ink order before freezing all into the base layer', () => {
  const background = createMapObject(
    'polygon',
    { x: 0, y: 0 },
    {
      id: 'saved_background',
      layer: 'base',
      points: [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 640 },
        { x: 0, y: 640 },
      ],
    },
  );
  const detail = createMapObject(
    'symbol',
    { x: 300, y: 300 },
    { id: 'placed_castle', layer: 'detail', symbol: 'castle' },
  );
  const input = map({
    editor: {
      ...createEditorData(),
      baseVisible: false,
      objects: [detail, background],
      regions: [region()],
    },
    strokes: [
      {
        id: 'top_ink',
        tool: 'river',
        color: '#123456',
        width: 5,
        points: [
          { x: 5, y: 5 },
          { x: 100, y: 100 },
        ],
      },
    ],
  });
  const result = bakeMapArtwork(input);
  const detailIndex = result.findIndex((object) => object.id === detail.id);
  assert.equal(result[0].id, background.id);
  assert.ok(detailIndex > 1, 'new terrain must cover the old frozen background');
  assert.deepEqual(
    result.slice(1, detailIndex),
    composeTerrainRegions(input.editor!.regions, input.width, input.height).map((object) => ({
      ...parchmentObject(object),
      layer: 'base',
    })),
  );
  assert.equal(result.at(-1)?.name, '原手绘河流');
  assert.ok(result.every((object) => object.layer === 'base'));
  assert.deepEqual(
    bakeMapArtwork(map({ editor: { ...createEditorData(), baseVisible: false, objects: result } })),
    result,
  );
});

test('baked legacy symbols retain their native rendered height with the editable glyph scale', () => {
  const input = map();
  const legacy = generateTerrain(input.seed, input.width, input.height, input.kind).symbols;
  const baked = bakeMapArtwork(input).filter((o) => o.name === '底图树木' || o.name === '底图山峰');
  assert.equal(baked.length, legacy.length);
  for (let i = 0; i < legacy.length; i++) {
    const tree = legacy[i].kind === 'tree';
    const oldHeight = (legacy[i].size / 10) * (tree ? 20 : 22);
    const newHeight = (baked[i].size / 32) * (tree ? 28 : 25);
    assert.ok(Math.abs(oldHeight - newHeight) < 0.000001);
  }
});

test('baking rejects capacity excess instead of truncating user content', () => {
  const object = createMapObject('text', { x: 2, y: 3 });
  assert.throws(
    () =>
      bakeMapArtwork(map({ editor: { ...createEditorData(), objects: Array(8001).fill(object) } })),
    /容量/,
  );
  assert.throws(
    () =>
      bakeMapArtwork(
        map({ editor: { ...createEditorData(), regions: Array(201).fill(region()) } }),
      ),
    /容量/,
  );
  assert.throws(
    () => generateRegionObjects(region({ points: Array(2001).fill({ x: 20, y: 30 }) }), 400, 300),
    /2000/,
  );
  assert.throws(
    () =>
      bakeMapArtwork(
        map({
          editor: {
            ...createEditorData(),
            baseVisible: false,
            objects: [{ ...object, points: Array(2001).fill({ x: 20, y: 30 }) }],
          },
        }),
      ),
    /2000/,
  );
});
