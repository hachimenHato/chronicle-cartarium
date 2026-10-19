import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AtlasMap } from '../shared/model';
import type { MapObject, MapRegion, SketchGenerationSettings } from '../shared/cartography';
import { bakeMapArtwork, composeTerrainRegions, createMapObject } from '../src/lib/cartography';
import { generateSketchMap } from '../src/lib/sketch-generation';
import { parchmentObject, parchmentPigment, parchmentSea } from '../src/lib/map-palette';

const regions: MapRegion[] = [
  {
    id: 'paper_land',
    name: '陆地',
    biome: 'grass',
    geometry: 'brush',
    points: [
      { x: 280, y: 320 },
      { x: 720, y: 300 },
    ],
    width: 320,
    seed: 25,
    roughness: 0.35,
    density: 0.5,
    visible: true,
    locked: false,
  },
  {
    id: 'paper_forest',
    name: '林地',
    biome: 'forest',
    geometry: 'brush',
    points: [
      { x: 350, y: 300 },
      { x: 490, y: 340 },
    ],
    width: 140,
    seed: 79,
    roughness: 0.3,
    density: 0.6,
    visible: true,
    locked: false,
  },
];
const common = {
  seed: 471,
  climate: 'temperate' as const,
  rivers: true,
  routes: true,
  settlements: 3,
};
function map(generation?: SketchGenerationSettings): AtlasMap {
  return {
    id: 'parchment_map',
    worldId: 'parchment_world',
    name: '羊皮地图',
    summary: '',
    kind: 'world',
    width: 1000,
    height: 640,
    seed: 0,
    strokes: [],
    pins: [],
    editor: {
      version: 1,
      mode: 'sculpt',
      baseVisible: false,
      regions: structuredClone(regions),
      objects: [],
      ...(generation ? { generation } : {}),
    },
  };
}
function artwork(objects: MapObject[]) {
  return objects.map(({ id: _id, layer: _layer, ...object }) => object);
}

test('parchment presentation and freezing agree for legacy recipes and ungenerated terrain', () => {
  for (const generation of [undefined, { ...common, version: 1 as const }]) {
    const input = map(generation),
      before = structuredClone(input);
    const raw = generation
      ? generateSketchMap(input.editor!.regions, input.width, input.height, generation).objects
      : composeTerrainRegions(input.editor!.regions, input.width, input.height);
    const original = structuredClone(raw);
    const shown = raw.map(parchmentObject);
    assert.deepEqual(
      artwork(bakeMapArtwork(input)),
      artwork(shown),
      'freezing must store the colors shown by the legacy presentation adapter',
    );
    assert(
      shown.some(
        (object, index) => object.color !== raw[index].color || object.stroke !== raw[index].stroke,
      ),
      'the fixture must actually exercise a changed pigment',
    );
    assert.deepEqual(raw, original, 'styling must not mutate reproducible generation output');
    assert.deepEqual(input, before, 'presentation and freezing must not rewrite the authoring');
  }
  assert.equal(parchmentPigment('#abc8c9'), parchmentSea);
  assert.equal(parchmentPigment('none'), 'none');
});

test('v2 parchment pigments are frozen once, while manual and already-frozen pigments remain exact', () => {
  const input = map({ ...common, version: 2, detail: 'standard', linework: 'organic' });
  const generated = generateSketchMap(
    input.editor!.regions,
    input.width,
    input.height,
    input.editor!.generation!,
    input.scaleKm,
    input.kind,
  ).objects;
  assert.deepEqual(
    artwork(bakeMapArtwork(input)),
    artwork(generated),
    'v2 has its own pigments and must not pass through the legacy color adapter',
  );

  // Deliberately use known procedural palette colors: equality of RGB values
  // must never make author-selected colors eligible for automatic replacement.
  const base = createMapObject(
    'polygon',
    { x: 30, y: 30 },
    {
      id: 'authored_base',
      name: '作者底层',
      layer: 'base',
      color: '#abc8c9',
      stroke: '#96b8af',
      points: [
        { x: 30, y: 30 },
        { x: 130, y: 30 },
        { x: 30, y: 130 },
      ],
    },
  );
  const detail = createMapObject(
    'text',
    { x: 180, y: 140 },
    {
      id: 'authored_text',
      name: '作者文字',
      text: '保留原色',
      color: '#e9dfb9',
      stroke: '#578c99',
    },
  );
  input.editor!.objects = [base, detail];
  input.strokes = [
    {
      id: 'authored_ink',
      tool: 'brush',
      color: '#578c99',
      width: 5,
      points: [
        { x: 80, y: 180 },
        { x: 180, y: 190 },
      ],
    },
  ];
  const before = structuredClone(input),
    frozen = bakeMapArtwork(input);
  for (const object of [base, detail])
    assert.deepEqual(
      frozen.find((item) => item.id === object.id),
      { ...object, layer: 'base' },
    );
  assert.equal(frozen.at(-1)?.stroke, input.strokes[0].color);
  assert.deepEqual(input, before);
  const frozenMap: AtlasMap = {
    ...input,
    strokes: [],
    editor: {
      version: 1,
      mode: 'detail',
      baseVisible: false,
      regions: [],
      objects: frozen,
    },
  };
  assert.deepEqual(
    bakeMapArtwork(frozenMap),
    frozen,
    'repeated freezing must not warm pigments again or mutate formerly manual objects',
  );
});
