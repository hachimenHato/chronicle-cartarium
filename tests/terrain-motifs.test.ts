import assert from 'node:assert/strict';
import { test } from 'node:test';
import { biomeCatalog } from '../shared/cartography';
import type { TerrainBiome } from '../shared/cartography';
import { drawTerrainMotif, TERRAIN_MOTIF_VARIANTS, TerrainPen } from '../src/lib/terrain-motifs';

function engraving(biome: TerrainBiome, variant: number, detail = 0.8) {
  const pens = [
    new TerrainPen(0, 0, 1, 0),
    new TerrainPen(0, 0, 1, 0),
    new TerrainPen(0, 0, 1, 0),
  ] as const;
  drawTerrainMotif(biome, ...pens, (variant + 0.5) / TERRAIN_MOTIF_VARIANTS, detail);
  return pens.map((pen) => pen.value);
}

test('the thirteen land covers each provide eight distinct, deterministic engraving structures', () => {
  const all = new Set<string>();
  for (const biome of biomeCatalog.filter((biome) => biome.id !== 'water')) {
    const structures = new Set<string>();
    for (let variant = 0; variant < TERRAIN_MOTIF_VARIANTS; variant++) {
      const paths = engraving(biome.id, variant);
      assert.deepEqual(paths, engraving(biome.id, variant));
      assert(paths[0].length > 20, `${biome.id} ${variant} must have visible line geometry`);
      structures.add(paths[0]);
      all.add(paths.join(''));
    }
    assert.equal(structures.size, 8, biome.id);
  }
  assert.equal(all.size, 104, 'different vegetation and landforms must not reuse identical motifs');
  assert.deepEqual(engraving('water', 0), ['', '', '']);
});

test('every engraving stays within its nine-unit sampling guard and a bounded path budget', () => {
  for (const biome of biomeCatalog) {
    for (let variant = 0; variant < TERRAIN_MOTIF_VARIANTS; variant++) {
      for (const detail of [0, 0.5, 1]) {
        const joined = engraving(biome.id, variant, detail).join('');
        assert(!/NaN|Infinity|undefined/.test(joined));
        assert(joined.length < 1400, `${biome.id} ${variant}: path budget`);
        for (const pair of joined.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)) {
          assert(
            Math.hypot(Number(pair[1]), Number(pair[2])) <= 9.01,
            `${biome.id} ${variant}: ${pair[0]} escapes the shore/road guard`,
          );
        }
      }
    }
  }
});

test('the pen applies one coherent map transform to endpoints and curve controls', () => {
  const pen = new TerrainPen(100, 200, 2, Math.PI / 2, 1.5);
  pen.m(2, 3).l(-1, 0).q(1, 0, 0, 1).c(0, -1, -1, 0, 0, 0).close();
  assert.equal(pen.value, 'M94,206L100,197Q100,203 98,200C102,200 100,197 100,200Z');
  const before = pen.value;
  pen.m(0, 0);
  assert.equal(
    pen.value,
    `${before}M100,200`,
    'successive marks append without erasing prior geometry',
  );
});

test('a clamped variant selector retains the first and last complete structures', () => {
  for (const value of [-10, 0, 1, 10]) {
    const pens = [
      new TerrainPen(0, 0, 1, 0),
      new TerrainPen(0, 0, 1, 0),
      new TerrainPen(0, 0, 1, 0),
    ] as const;
    drawTerrainMotif('forest', ...pens, value, 0.8);
    assert.deepEqual(
      pens.map((pen) => pen.value),
      engraving('forest', value < 1 ? 0 : 7),
    );
  }
});
