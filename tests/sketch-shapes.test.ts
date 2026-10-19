import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MapPoint, MapRegion, SketchGenerationV2 } from '../shared/cartography';
import { defaultGeographicSettings, validGeographicSettings } from '../shared/geography';
import { buildSketchShapeField, randomizedIsland } from '../src/lib/sketch-shapes';
import { generateSketchMap } from '../src/lib/sketch-generation';
import { generationSignature } from '../src/lib/generated-map';
import { geographicSettingsSchema } from '../server/geographic-validation';
import { pointInPolygon } from '../src/lib/terrain';

const region = (
  id: string,
  points: MapPoint[],
  biome: MapRegion['biome'] = 'grass',
): MapRegion => ({
  id,
  name: id,
  points,
  biome,
  seed: 11,
  width: 70,
  geometry: 'polygon',
  roughness: 0.8,
  density: 0.7,
  visible: true,
  locked: false,
});
const rectangle = (x: number, y: number, w: number, h: number) => [
  { x: x - w / 2, y: y - h / 2 },
  { x: x + w / 2, y: y - h / 2 },
  { x: x + w / 2, y: y + h / 2 },
  { x: x - w / 2, y: y + h / 2 },
];
const circle = (x: number, y: number, r: number) =>
  Array.from({ length: 96 }, (_, i) => ({
    x: x + Math.cos((i * Math.PI) / 48) * r,
    y: y + Math.sin((i * Math.PI) / 48) * r,
  }));
const overlap = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let intersection = 0,
    union = 0;
  for (let i = 0; i < a.length; i++) {
    intersection += Number(a[i] > 0 && b[i] > 0);
    union += Number(a[i] > 0 || b[i] > 0);
  }
  return intersection / Math.max(1, union);
};
const build = (regions: MapRegion[], mode: 'randomized' | 'balanced' | 'strict', seed = 219) =>
  buildSketchShapeField(regions, 160, 104, 1000, 650, seed, mode);

test('A interprets equal-area, equal-centroid shapes independently of their original outline', () => {
  const round = build([region('round', circle(500, 325, 130))], 'randomized');
  const stretched = build(
    [region('rectangle', rectangle(500, 325, 380, (Math.PI * 130 ** 2) / 380))],
    'randomized',
  );
  assert(
    overlap(round.field, stretched.field) > 0.96,
    'raster integration tolerance only; source aspect does not shape the island',
  );
  assert.deepEqual(build([region('round', circle(500, 325, 130))], 'randomized'), round);
  const seed = { center: { x: 500, y: 325 }, area: 25000 };
  const a = randomizedIsland(seed, 123),
    b = randomizedIsland(structuredClone(seed), 123),
    c = randomizedIsland(seed, 456);
  const samples = circle(500, 325, 100);
  assert.deepEqual(samples.map(a), samples.map(b));
  assert.notDeepEqual(
    samples.map(a),
    samples.map(c),
    'the chosen seed actually varies the generated silhouette',
  );
});

test('A ignores source area, admits tiny unsampled dots and varies continental size and satellite counts by seed', () => {
  const inputs = [
    region('small', circle(190, 190, 65)),
    region('large', circle(680, 370, 145)),
    region('middle', circle(220, 475, 85)),
  ];
  const result = build(inputs, 'randomized');
  const resized = [
    region('small', circle(190, 190, 110)),
    region('large', circle(680, 370, 3)),
    region('middle', circle(220, 475, 12)),
  ];
  assert.deepEqual(
    result,
    build(resized, 'randomized'),
    'input widths and areas do not enter A at all',
  );
  const examples = Array.from({ length: 12 }, (_, i) =>
    build([region('dot', circle(500, 325, 1))], 'randomized', i + 1),
  );
  const counts = examples.map((r) => Array.from(r.field).filter((v) => v > 0).length);
  assert(
    Math.max(...counts) > 160 * 104 * 0.18,
    'one nearly invisible dot can produce a large continent',
  );
  assert(
    Math.max(...counts) > Math.min(...counts) * 3,
    'seeds vary area strongly instead of preserving the painted area',
  );
  assert(
    new Set(examples.map((r) => r.landSeeds.length)).size > 1,
    'island count is randomized too',
  );
  const b = build(inputs, 'balanced');
  assert(
    overlap(result.field, b.field) < 0.75,
    'maximum randomness visibly separates from balanced outlines',
  );
});

test('B partially respects source geography; C exactly preserves sampled coastlines and painted inland water', () => {
  const inputs = [
    region('long', rectangle(500, 325, 660, 210)),
    region('lake', circle(580, 325, 38), 'water'),
  ];
  const a = build(inputs, 'randomized'),
    b = build(inputs, 'balanced'),
    c = build(inputs, 'strict');
  assert(overlap(b.field, c.field) > overlap(a.field, c.field) + 0.07);
  assert(
    overlap(b.field, c.field) < 0.98,
    'B is visibly more than a preserved outline with decoration',
  );
  for (let i = 0; i < c.field.length; i++) {
    const p = { x: (((i % 160) + 0.5) * 1000) / 160, y: ((Math.floor(i / 160) + 0.5) * 650) / 104 };
    const expected = pointInPolygon(p, inputs[0].points) && !pointInPolygon(p, inputs[1].points);
    assert.equal(
      c.field[i] > 0,
      expected,
      'strict coastline and inland water only change at sampling resolution',
    );
  }
});

test('ABC settings are explicit for new maps, optional for saved recipes, validated and cache-significant', () => {
  const settings = defaultGeographicSettings('world');
  assert.equal(settings.sketchMode, 'balanced');
  const { sketchMode: _mode, ...legacy } = settings;
  assert.deepEqual(
    geographicSettingsSchema.parse(legacy),
    legacy,
    'reading old recipes must not silently rewrite them',
  );
  assert(validGeographicSettings(legacy));
  assert(!geographicSettingsSchema.safeParse({ ...settings, sketchMode: 'other' }).success);
  assert(!validGeographicSettings({ ...settings, sketchMode: 'other' as 'strict' }));
  const recipe: SketchGenerationV2 = {
    version: 2,
    detail: 'standard',
    linework: 'organic',
    seed: 482,
    climate: 'temperate',
    settlements: 0,
    rivers: true,
    routes: false,
    geography: { ...settings, source: 'sketch', ports: false, regionDensity: 0.5 },
  };
  const inputs = [region('land', rectangle(500, 325, 540, 320))];
  const signatures = ['randomized', 'balanced', 'strict'].map((mode) =>
    generationSignature(
      inputs,
      1000,
      650,
      { ...recipe, geography: { ...recipe.geography!, sketchMode: mode as 'strict' } },
      1200,
      'region',
    ),
  );
  assert.equal(new Set(signatures).size, 3);
  const c = generateSketchMap(
    inputs,
    1000,
    650,
    { ...recipe, geography: { ...recipe.geography!, sketchMode: 'strict' } },
    1200,
    'region',
  );
  assert(c.elevation && c.geography);
  for (const cell of c.diagnostics.cells)
    assert.equal(
      cell.land,
      pointInPolygon(cell, inputs[0].points),
      'strict choice survives the entire tectonic/climate/drainage pipeline',
    );
});
