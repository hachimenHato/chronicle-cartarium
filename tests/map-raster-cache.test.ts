import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cacheTransform,
  MAP_RASTER_CACHE_MAX_DIMENSION,
  MAP_RASTER_CACHE_MAX_PIXELS,
  planMapRasterCache,
} from '../src/lib/map-raster-cache';

test('full-resolution cache covers the highest zoom and the root SVG letterboxing', () => {
  const horizontal = planMapRasterCache(1600, 1000, 1000, 800, 2)!;
  assert.equal(horizontal.fit, 0.625);
  assert.equal(horizontal.left, 0);
  assert.equal(horizontal.top, 87.5);
  assert.equal(horizontal.pixelWidth, 8000);
  assert.equal(horizontal.pixelHeight, 5000);
  assert.equal(horizontal.pixelWidth * horizontal.pixelHeight, MAP_RASTER_CACHE_MAX_PIXELS);

  const vertical = planMapRasterCache(1000, 1600, 800, 1000, 1)!;
  assert.equal(vertical.fit, 0.625);
  assert.equal(vertical.left, 87.5);
  assert.equal(vertical.top, 0);
  assert.equal(vertical.pixelWidth, 2500);
  assert.equal(vertical.pixelHeight, 4000);
});

test('fractional device-pixel dimensions round up independently without undersampling', () => {
  const plan = planMapRasterCache(1600, 1000, 733.3, 601.2, 1.25)!;
  assert.equal(plan.pixelWidth, Math.ceil(1600 * plan.fit * 1.25 * 4));
  assert.equal(plan.pixelHeight, Math.ceil(1000 * plan.fit * 1.25 * 4));
  assert.ok(plan.pixelWidth >= 1600 * plan.fit * plan.dpr * plan.maxZoom);
  assert.ok(plan.pixelHeight >= 1000 * plan.fit * plan.dpr * plan.maxZoom);
});

test('400% cache alignment matches the original vector camera including exterior bounds', () => {
  const bounds = { x: -75, y: -42, width: 1750, height: 1084 };
  const plan = planMapRasterCache(1600, 1000, 900, 740, 1, 4, bounds)!;
  for (const view of [
    { x: 0, y: 0, zoom: 1 },
    { x: -530.25, y: -217.5, zoom: 4 },
    { x: 132.375, y: -91.25, zoom: 0.5 },
  ]) {
    const matrix = cacheTransform(plan, view);
    assert.equal(matrix.b, 0);
    assert.equal(matrix.c, 0);
    assert.equal(matrix.a, matrix.d);
    for (const local of [
      { x: 0, y: 0 },
      { x: 875.125, y: 540.25 },
      { x: 1750, y: 1084 },
    ]) {
      const canvasX = matrix.a * local.x + matrix.e;
      const canvasY = matrix.d * local.y + matrix.f;
      const vectorX = plan.left + plan.fit * (view.x + (bounds.x + local.x) * view.zoom);
      const vectorY = plan.top + plan.fit * (view.y + (bounds.y + local.y) * view.zoom);
      assert.ok(Math.abs(canvasX - vectorX) < 1e-9);
      assert.ok(Math.abs(canvasY - vectorY) < 1e-9);
    }
  }
  bounds.x = 100;
  assert.equal(plan.bounds.x, -75, 'the plan retains its own immutable bounds snapshot');
});

test('excessive pixel area or edge dimensions fall back instead of lowering cache quality', () => {
  assert.equal(planMapRasterCache(1600, 1000, 1001, 800, 2), undefined);
  assert.equal(planMapRasterCache(1600, 1000, 1000, 800, 3), undefined);
  const edge = planMapRasterCache(16384, 1, 4096, 1, 1)!;
  assert.equal(edge.pixelWidth, MAP_RASTER_CACHE_MAX_DIMENSION);
  assert.equal(planMapRasterCache(16385, 1, 4096.25, 1, 1), undefined);
  assert.equal(
    planMapRasterCache(1600, 1000, 900, 740, 2, 4, {
      x: -800,
      y: -500,
      width: 3200,
      height: 2000,
    }),
    undefined,
  );
});

test('invalid dimensions, bounds or density cannot allocate a bitmap', () => {
  const valid = [1600, 1000, 900, 740, 1, 4];
  for (let index = 0; index < valid.length; index++) {
    for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
      const values = [...valid];
      values[index] = invalid;
      assert.equal(
        planMapRasterCache(values[0], values[1], values[2], values[3], values[4], values[5]),
        undefined,
      );
    }
  }
  for (const bounds of [
    { x: NaN, y: 0, width: 1600, height: 1000 },
    { x: 0, y: Infinity, width: 1600, height: 1000 },
    { x: 0, y: 0, width: 0, height: 1000 },
    { x: 0, y: 0, width: 1600, height: -1 },
  ])
    assert.equal(planMapRasterCache(1600, 1000, 900, 740, 1, 4, bounds), undefined);
  assert.equal(planMapRasterCache(Number.MAX_VALUE, Number.MIN_VALUE, 900, 740, 1), undefined);
});
