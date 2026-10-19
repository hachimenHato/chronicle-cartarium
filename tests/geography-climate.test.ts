import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateGeographicClimate, rainfallLatitudeFactor } from '../src/lib/geography-climate';
import { defaultGeographicSettings } from '../shared/geography';
import { ELEVATION_SCALE } from '../src/lib/elevation';

function climate(columns = 96, windAngle = 0, oceanDepth = 100, mountain = true) {
  const rows = 24,
    width = 1200,
    height = 300;
  const cells = Array.from({ length: columns * rows }, (_, i) => {
    const x = (((i % columns) + 0.5) / columns) * width,
      y = ((Math.floor(i / columns) + 0.5) / rows) * height;
    const land = x > 200 && x < 1000;
    return {
      x,
      y,
      land,
      elevation: land
        ? (100 + (mountain ? 2500 * Math.exp(-(((x - 600) / 85) ** 2)) : 0)) / ELEVATION_SCALE
        : -oceanDepth / ELEVATION_SCALE,
    };
  });
  const settings = {
    ...defaultGeographicSettings('world'),
    latitudeNorth: 35,
    latitudeSouth: 35,
    windAngle,
  };
  const input = {
    cells,
    coastDistance: cells.map((c) => (c.land ? Math.min(c.x - 200, 1000 - c.x) : -50)),
    columns,
    rows,
    width,
    height,
    coverageKm: 1200,
    settings,
    variation: () => 0.5,
  };
  return { ...generateGeographicClimate(input), cells, columns, input };
}
const meanAt = (c: ReturnType<typeof climate>, from: number, to: number) => {
  const ids = c.cells.flatMap((p, i) => (p.x >= from && p.x <= to ? [i] : []));
  return ids.reduce((sum, i) => sum + c.precipitation[i], 0) / ids.length;
};
test('prevailing wind produces windward rain and a downwind rain shadow that swap sides', () => {
  const east = climate(),
    west = climate(96, 180);
  assert(meanAt(east, 450, 560) > meanAt(east, 650, 760) * 1.5);
  assert(meanAt(west, 650, 760) > meanAt(west, 450, 560) * 1.5);
  assert.deepEqual(climate().precipitation, east.precipitation);
});
test('ocean bathymetry is not an atmospheric slope, and rain is stable across sampling densities', () => {
  const a = climate(),
    deep = climate(96, 0, 8000),
    fine = climate(192);
  assert.deepEqual(a.precipitation, deep.precipitation);
  for (const [from, to] of [
    [250, 400],
    [450, 560],
    [700, 900],
  ]) {
    const coarseRain = meanAt(a, from, to),
      fineRain = meanAt(fine, from, to);
    assert(
      Math.abs(coarseRain - fineRain) / fineRain < 0.22,
      `density changed mean rain: ${coarseRain}/${fineRain}`,
    );
  }
});
test('latitude belts, sea temperature and moisture transport replace constant ocean rainfall', () => {
  assert(rainfallLatitudeFactor(0) > rainfallLatitudeFactor(30));
  assert(rainfallLatitudeFactor(55) > rainfallLatitudeFactor(30));
  const c = climate(96, 17, 100, false);
  const result = generateGeographicClimate({
    ...c.input,
    settings: { ...c.input.settings, latitudeNorth: 75, latitudeSouth: 0 },
  });
  const sea = c.cells.flatMap((cell, i) => (!cell.land ? [result.precipitation[i]] : []));
  assert(Math.max(...sea) > Math.min(...sea) * 3);
  assert(Array.from(result.precipitation).every((v) => Number.isFinite(v) && v >= 10 && v <= 6500));
  assert(Array.from(result.temperature).every(Number.isFinite));
});

test('rain belts reverse the wet mountain face while preserving a drier lee side', () => {
  const c = climate();
  const atLatitude = (latitude: number) => ({
    ...c,
    ...generateGeographicClimate({
      ...c.input,
      settings: { ...c.input.settings, latitudeNorth: latitude, latitudeSouth: latitude },
    }),
  });
  const tropical = atLatitude(10),
    midlatitude = atLatitude(45);
  assert(meanAt(tropical, 650, 760) > meanAt(tropical, 450, 560) * 1.4);
  assert(meanAt(midlatitude, 450, 560) > meanAt(midlatitude, 650, 760) * 1.4);
});

test('both coasts receive moisture while the middle of a wide continent remains dry', () => {
  const columns = 300,
    rows = 10,
    width = 1200,
    height = 40;
  const cells = Array.from({ length: columns * rows }, (_, i) => {
    const x = (((i % columns) + 0.5) * width) / columns,
      y = ((Math.floor(i / columns) + 0.5) * height) / rows;
    return {
      x,
      y,
      land: x > 30 && x < 1170,
      elevation: x > 30 && x < 1170 ? 100 / ELEVATION_SCALE : -0.05,
    };
  });
  const result = generateGeographicClimate({
    cells,
    coastDistance: cells.map((c) => (c.land ? Math.min(c.x - 30, 1170 - c.x) : -5)),
    columns,
    rows,
    width,
    height,
    coverageKm: 12000,
    settings: {
      ...defaultGeographicSettings('world'),
      latitudeNorth: 35,
      latitudeSouth: 35,
      windAngle: 0,
    },
    variation: () => 0.5,
  });
  const sample = (from: number, to: number) =>
    cells.flatMap((c, i) => (c.x >= from && c.x <= to ? [result.precipitation[i]] : []));
  const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
  const west = mean(sample(40, 80)),
    east = mean(sample(1120, 1160)),
    interior = mean(sample(570, 630));
  assert(west > 400 && east > 120, `coastal moisture missing: ${west}/${east}`);
  assert(
    interior < 250 && interior < west * 0.6,
    `interior should retain continental dryness: ${interior}`,
  );
});

test('town-scale hills do not produce grid-sized rain deserts or extreme rain spikes', () => {
  const c = climate(192, 0, 100, true);
  const result = generateGeographicClimate({ ...c.input, coverageKm: 7 });
  const land = c.cells.flatMap((cell, i) => (cell.land ? [result.precipitation[i]] : []));
  assert(Math.min(...land) > 350);
  assert(Math.max(...land) / Math.min(...land) < 1.7);
  const twice = generateGeographicClimate({
    ...c.input,
    coverageKm: 7,
    settings: { ...c.input.settings, rainfall: 2 },
  });
  for (let i = 0; i < result.precipitation.length; i++)
    assert(Math.abs(twice.precipitation[i] / result.precipitation[i] - 2) < 1e-6);
});
