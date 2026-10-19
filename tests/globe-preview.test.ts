import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClimatePreview } from '../src/lib/world-climate-preview';
import { globePolygonPath } from '../src/lib/globe-projection';
import { extentAround } from '../shared/world-extent';
import { defaultGeographicSettings } from '../shared/geography';

test('globe polygons remain clipped and visible while their centers cross behind the limb', () => {
  const points = Array.from({ length: 80 }, (_, i) => ({
    latitude: Math.sin((i * Math.PI) / 40) * 18,
    longitude: 101 + Math.cos((i * Math.PI) / 40) * 30,
  }));
  assert(globePolygonPath(points, 0, 0).length > 100);
  assert.equal(globePolygonPath(points, 0, -90), '');
  for (const lat of [-89, -60, 0, 60, 89])
    for (const lon of [-180, -91, 0, 91, 180]) {
      const path = globePolygonPath(points, lat, lon);
      assert(!/NaN|Infinity|undefined/.test(path));
      const values = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      assert(values.every((v) => v >= 23.9 && v <= 336.1));
    }
});

test('climate preview uses deterministic terrain and responds to latitude, altitude and rain settings', () => {
  const equator = extentAround(0, 20, 20, 14),
    polar = extentAround(72, 20, 20, 14);
  const options = { seed: 37, kind: 'region' as const };
  const warm = createClimatePreview(equator, options),
    cold = createClimatePreview(polar, options);
  assert(warm.temperature.mean > cold.temperature.mean + 25);
  assert.deepEqual(warm, createClimatePreview(equator, options));
  assert.deepEqual(
    warm.cells.map((c) => c.elevation),
    cold.cells.map((c) => c.elevation),
  );
  assert(warm.biomes.some((b) => !['snow', 'tundra'].includes(b.biome)));
  assert(cold.biomes.some((b) => ['snow', 'tundra'].includes(b.biome)));
  const surface = {
    columns: 64,
    rows: 40,
    width: 1200,
    height: 800,
    values: Array(2560).fill(150),
    min: 150,
    max: 150,
  };
  const low = createClimatePreview(equator, { ...options, elevation: surface });
  const high = createClimatePreview(equator, {
    ...options,
    elevation: { ...surface, values: Array(2560).fill(2150) },
  });
  assert(Math.abs(low.temperature.mean - high.temperature.mean - 13) < 0.01);
  const wet = createClimatePreview(equator, {
    ...options,
    settings: { ...defaultGeographicSettings('region'), rainfall: 2 },
  });
  assert(wet.precipitation.mean > warm.precipitation.mean);
  // Wet equatorial slopes can reach the declared 6500 mm limit; the multiplier is applied before that cap.
  for (let i = 0; i < warm.cells.length; i++) {
    const expected = Math.min(6500, warm.cells[i].precipitation * 2);
    assert(Math.abs(wet.cells[i].precipitation - expected) < 0.003);
  }
  const dry = createClimatePreview(equator, {
    ...options,
    settings: { ...defaultGeographicSettings('region'), rainfall: 0.4 },
  });
  assert(dry.precipitation.mean < warm.precipitation.mean * 0.7);
  assert(
    warm.cells.every(
      (c) => Number.isFinite(c.temperature) && c.precipitation >= 10 && c.precipitation <= 6500,
    ),
  );
  assert(warm.biomes.reduce((sum, b) => sum + b.share, 0) <= 1.00001);
});
