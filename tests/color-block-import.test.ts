import { test } from 'node:test';
import assert from 'node:assert/strict';
import { biomeCatalog, MAP_EDITOR_LIMITS, type TerrainBiome } from '../shared/cartography';
import { createSeed } from '../shared/seed';
import { validateWorkspace } from '../server/validation';
import {
  colorBlockPalette,
  colorBlockRegions,
  nearestColorBlockBiome,
  parseColorBlockPixels,
  type ColorBlockPixels,
} from '../src/lib/color-block-import';
import { pointInPolygon } from '../src/lib/terrain';

function image(
  width: number,
  height: number,
  biomeAt: (x: number, y: number) => TerrainBiome | 'transparent',
): ColorBlockPixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const biome = biomeAt(x, y),
        offset = (y * width + x) * 4;
      if (biome === 'transparent') continue;
      const color = colorBlockPalette.find((entry) => entry.id === biome)!;
      data.set([...color.rgb, 255], offset);
    }
  return { width, height, data };
}
function biomeAt(result: ReturnType<typeof parseColorBlockPixels>, x: number, y: number) {
  let biome: TerrainBiome = 'water';
  for (const block of result.blocks)
    if (pointInPolygon({ x, y }, block.points)) biome = block.biome;
  return biome;
}

test('color-block palette displays unambiguous hexadecimal and decimal values for all 14 terrains', () => {
  assert.equal(colorBlockPalette.length, 14);
  for (const biome of colorBlockPalette) {
    assert.equal(nearestColorBlockBiome(biome.rgb), biome.id);
    assert.equal(biome.decimal, biome.rgb[0] * 65536 + biome.rgb[1] * 256 + biome.rgb[2]);
    assert.equal('#' + biome.decimal.toString(16).padStart(6, '0'), biome.color);
    assert.equal(
      nearestColorBlockBiome(biome.rgb.map((channel) => Math.min(255, channel + 1))),
      biome.id,
    );
  }
  assert.deepEqual(
    colorBlockPalette.map((entry) => entry.id),
    biomeCatalog.map((entry) => entry.id),
  );
  assert.throws(() => nearestColorBlockBiome([1, 2, Infinity]));
  assert.throws(() => nearestColorBlockBiome([-1, 0, 0]));
});

test('connected color-block cells merge into editable outer polygons rather than pixel objects', () => {
  const result = parseColorBlockPixels(image(40, 24, () => 'forest'));
  assert.equal(result.blocks.length, 2);
  assert.equal(result.blocks[1].points.length, 4);
  assert.equal(result.blocks[1].biome, 'forest');
  assert.deepEqual(result.counts, { forest: 960 });
  assert.equal(result.reduced, false);
  assert.equal(biomeAt(result, 0.5, 0.5), 'forest');
});

test('water backdrop, coast, inland lake and island retain their nested topology', () => {
  const result = parseColorBlockPixels(
    image(9, 9, (x, y) => {
      if (x === 0 || y === 0 || x === 8 || y === 8) return 'water';
      if (x === 4 && y === 4) return 'forest';
      if (x >= 2 && x <= 6 && y >= 2 && y <= 6) return 'water';
      return 'grass';
    }),
  );
  assert.equal(result.blocks.length, 4);
  assert.equal(biomeAt(result, 0.05, 0.5), 'water');
  assert.equal(biomeAt(result, 1.5 / 9, 4.5 / 9), 'grass');
  assert.equal(biomeAt(result, 3.5 / 9, 4.5 / 9), 'water');
  assert.equal(biomeAt(result, 4.5 / 9, 4.5 / 9), 'forest');
});

test('transparent pixels become sea and diagonal islands remain distinct', () => {
  const result = parseColorBlockPixels(image(4, 4, (x, y) => (x === y ? 'grass' : 'transparent')));
  assert.equal(result.blocks.length, 5);
  assert.equal(result.counts.water, 12);
  assert.equal(result.counts.grass, 4);
  for (let i = 0; i < 4; i++) assert.equal(biomeAt(result, (i + 0.5) / 4, (i + 0.5) / 4), 'grass');
});

test('complex noisy images lower sampling automatically to stay within storage and drawing budgets', () => {
  const result = parseColorBlockPixels(
    image(64, 64, (x, y) => ((x + y) % 2 ? 'mountain' : 'forest')),
    64,
  );
  assert.ok(result.reduced);
  assert.ok(result.blocks.length <= MAP_EDITOR_LIMITS.regions);
  assert.ok(result.blocks.every((block) => block.points.length <= MAP_EDITOR_LIMITS.points));
  assert.ok(result.blocks.reduce((sum, block) => sum + block.points.length, 0) <= 16000);
  assert.ok(
    result.blocks.every((block) =>
      block.points.every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1),
    ),
  );
});

test('import geometry adapts to map size after import and round-trips through workspace validation', () => {
  const result = parseColorBlockPixels(image(16, 8, (x) => (x < 8 ? 'grass' : 'water')));
  const regions = colorBlockRegions(result, 2000, 1000, 42);
  assert.equal(regions.length, 2);
  assert.ok(regions[1].points.some((point) => point.x === 1000));
  assert.ok(regions[1].points.some((point) => point.y === 1000));
  assert.ok(
    regions.every((region) => !region.locked && region.visible && region.geometry === 'polygon'),
  );
  const data = createSeed();
  data.maps[0] = {
    ...data.maps[0],
    width: 2000,
    height: 1000,
    pins: [],
    strokes: [],
    editor: { version: 1, mode: 'sketch', baseVisible: false, regions, objects: [] },
  };
  assert.deepEqual(
    validateWorkspace(JSON.parse(JSON.stringify(data))).maps[0].editor?.regions,
    regions,
  );
  const resized = colorBlockRegions(result, 400, 800, 42);
  assert.ok(resized[1].points.some((point) => point.x === 200));
  assert.ok(resized[1].points.some((point) => point.y === 800));
});

test('invalid pixel data, resolution, seed and destination dimensions are rejected', () => {
  assert.throws(() => parseColorBlockPixels({ width: 1, height: 1, data: new Uint8Array(3) }));
  assert.throws(() => parseColorBlockPixels({ width: 0, height: 1, data: new Uint8Array(0) }));
  assert.throws(() =>
    parseColorBlockPixels(
      image(1, 1, () => 'water'),
      80 as 40,
    ),
  );
  const result = parseColorBlockPixels(image(1, 1, () => 'water'));
  assert.throws(() => colorBlockRegions(result, 99, 100, 42));
  assert.throws(() => colorBlockRegions(result, 100, 100, -1));
  assert.throws(() => colorBlockRegions(result, 100, 100, 3.5));
});
