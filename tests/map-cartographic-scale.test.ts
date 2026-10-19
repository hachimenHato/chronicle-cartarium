import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mapDetailProfile } from '../src/lib/map-scale';
import { generateSketchMapV2 } from '../src/lib/sketch-generation-v2';
import { makeClassicalRelief } from '../src/lib/classical-relief';
import { pointInPolygon } from '../src/lib/terrain';
import { bakeMapArtwork } from '../src/lib/cartography';
import { createSeed } from '../shared/seed';
import { validateWorkspace } from '../server/validation';
import type { AtlasMap } from '../shared/model';
import type { MapObject, SketchGenerationV2 } from '../shared/cartography';

const recipe: SketchGenerationV2 = {
  version: 2,
  detail: 'high',
  linework: 'organic',
  seed: 392,
  climate: 'temperate',
  settlements: 8,
  rivers: true,
  routes: true,
  elevation: { version: 1, preset: 'highlands', seed: 392, relief: 1, seaLevel: 0, strokes: [] },
};
const variants = new Map(
  (['world', 'region', 'town'] as AtlasMap['kind'][]).map(
    (kind) => [kind, generateSketchMapV2([], 1000, 640, recipe, undefined, kind)] as const,
  ),
);
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
const peaks = (objects: MapObject[]) => objects.filter((o) => o.name.endsWith('峰谷轮廓'));
const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('coverage overrides type, with consistent detail defaults on older maps', () => {
  assert.deepEqual(mapDetailProfile(undefined, 'world'), mapDetailProfile(12000));
  assert.deepEqual(mapDetailProfile(undefined, 'town'), mapDetailProfile(10));
  assert.deepEqual(mapDetailProfile(), mapDetailProfile(400, 'region'));
  assert.deepEqual(mapDetailProfile(80, 'world'), mapDetailProfile(80, 'town'));
  for (const value of [0, NaN, Infinity, -1])
    assert.deepEqual(mapDetailProfile(value, 'world'), mapDetailProfile(undefined, 'world'));
});

test('world ranges have more smaller peaks, finer branching rivers and more finer roads than local maps', () => {
  const world = variants.get('world')!,
    region = variants.get('region')!,
    town = variants.get('town')!;
  const peakWidth = (objects: MapObject[]) =>
    mean(
      peaks(objects).map(
        (o) => Math.max(...o.points.map((p) => p.x)) - Math.min(...o.points.map((p) => p.x)),
      ),
    );
  const riverWidth = (r: typeof world) =>
    mean(r.diagnostics.riverChannels.flatMap((c) => c.widths));
  const roadWidth = (r: typeof world) => r.objects.find((o) => o.name === '道路 1')!.strokeWidth;
  const tributaries = (r: typeof world) =>
    r.diagnostics.rivers.filter((path) => r.diagnostics.cells[path.at(-1)!].land).length;
  assert(peaks(world.objects).length > peaks(region.objects).length);
  assert(peaks(region.objects).length > peaks(town.objects).length);
  assert(peakWidth(world.objects) < peakWidth(region.objects) * 0.7);
  assert(peakWidth(region.objects) < peakWidth(town.objects));
  assert(world.stats.rivers > region.stats.rivers && region.stats.rivers > town.stats.rivers);
  assert(tributaries(world) > tributaries(region) && tributaries(region) > tributaries(town));
  assert(riverWidth(world) < riverWidth(region) && riverWidth(region) < riverWidth(town));
  assert(world.stats.roads > region.stats.roads && region.stats.roads > town.stats.roads);
  assert(roadWidth(world) < roadWidth(region) && roadWidth(region) < roadWidth(town));
  for (const result of variants.values()) {
    assert(result.objects.length <= 8000);
    assert(
      result.objects.every(
        (o) =>
          o.points.length <= 2000 &&
          o.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      ),
    );
  }
});

test('mountain silhouettes occlude overlapping rivers and roads, persist in the painter order and do not alter drainage', () => {
  const result = variants.get('world')!,
    data = createSeed(),
    map = data.maps[0];
  const beforeCells = fingerprint(result.diagnostics.cells);
  const masks = result.objects.filter((o) => o.name.endsWith('山体遮挡底色'));
  assert.equal(masks.length, peaks(result.objects).length);
  assert(masks.every((o) => o.kind === 'polygon' && o.opacity === 1 && o.color !== 'none'));
  const lastLine = result.objects
    .flatMap((o, i) => (/^河流 \d+|^道路/.test(o.name) ? [i] : []))
    .at(-1)!;
  assert(lastLine < result.objects.findIndex((o) => o.name.endsWith('山体遮挡底色')));
  assert(
    result.diagnostics.riverChannels.some((channel) =>
      channel.points.some((point) => masks.some((mask) => pointInPolygon(point, mask.points))),
    ),
    'the sample must contain an actual river passing behind a projected peak',
  );
  makeClassicalRelief(
    result.diagnostics.cells,
    result.diagnostics.columns,
    result.diagnostics.rows,
    1000,
    640,
    recipe.seed,
    { featureScale: 1.6 },
  );
  assert.equal(fingerprint(result.diagnostics.cells), beforeCells);
  Object.assign(map, {
    kind: 'world',
    width: 1000,
    height: 640,
    seed: 0,
    pins: [],
    strokes: [],
    editor: {
      version: 1,
      mode: 'sculpt',
      baseVisible: false,
      regions: [],
      objects: [],
      generation: recipe,
    },
  });
  const before = fingerprint(data);
  const frozen = bakeMapArtwork(map);
  assert.equal(fingerprint(data), before);
  const art = (objects: MapObject[]) => objects.map(({ id: _id, layer: _layer, ...o }) => o);
  assert.equal(fingerprint(art(frozen)), fingerprint(art(result.objects)));
  map.editor = { version: 1, mode: 'detail', baseVisible: false, regions: [], objects: frozen };
  assert.doesNotThrow(() => validateWorkspace(data));
  assert.deepEqual(JSON.parse(JSON.stringify(frozen)), frozen);
});

test('drawing size changes remain proportional without changing coverage or peak density', () => {
  const reference = variants.get('world')!,
    cells = reference.diagnostics.cells;
  const options = { featureScale: mapDetailProfile(undefined, 'world').mountainScale };
  const small = makeClassicalRelief(
    cells,
    reference.diagnostics.columns,
    reference.diagnostics.rows,
    1000,
    640,
    392,
    options,
  );
  const large = makeClassicalRelief(
    cells.map((c) => ({ ...c, x: c.x * 2, y: c.y * 2 })),
    reference.diagnostics.columns,
    reference.diagnostics.rows,
    2000,
    1280,
    392,
    options,
  );
  assert.equal(peaks(small).length, peaks(large).length);
  assert.deepEqual(
    peaks(large).map((o) => o.name),
    peaks(small).map((o) => o.name),
  );
  for (let i = 0; i < small.length; i++)
    for (let j = 0; j < small[i].points.length; j++) {
      assert(Math.abs(large[i].points[j].x - small[i].points[j].x * 2) <= 0.0011);
      assert(Math.abs(large[i].points[j].y - small[i].points[j].y * 2) <= 0.0011);
    }
});
