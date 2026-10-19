import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MapPoint } from '../shared/cartography';
import type { MapSurface } from '../shared/map-surface';
import { isWaterPoint, isWaterSegment, sampleMapSurface } from '../shared/map-surface';
import { createWaterRouter } from '../src/lib/water-routing';

function field(height: (x: number, y: number) => number, columns = 100, rows = 100): MapSurface {
  return {
    columns,
    rows,
    width: 100,
    height: 100,
    values: Float32Array.from({ length: columns * rows }, (_, i) =>
      height(
        (((i % columns) + 0.5) * 100) / columns,
        ((Math.floor(i / columns) + 0.5) * 100) / rows,
      ),
    ),
  };
}
function assertWater(surface: MapSurface, points: MapPoint[]) {
  for (let i = 0; i < points.length; i++) {
    assert(isWaterPoint(surface, points[i], -5), 'all vertices have shore clearance');
    if (i)
      assert(
        isWaterSegment(surface, points[i - 1], points[i], -5),
        'every complete rendered segment is in water',
      );
  }
}
test('water segment detects an interior bilinear land maximum missed by endpoints and midpoint', () => {
  const surface: MapSurface = {
    columns: 2,
    rows: 2,
    width: 20,
    height: 20,
    values: [-2.24, 15.76, 15.76, -66.24],
  };
  const from = { x: 5, y: 5 },
    to = { x: 15, y: 15 };
  assert(sampleMapSurface(surface, from) < 0);
  assert(sampleMapSurface(surface, to) < 0);
  assert(sampleMapSurface(surface, { x: 10, y: 10 }) < 0);
  assert.equal(isWaterSegment(surface, from, to), false);
  assert.equal(isWaterSegment(surface, to, from), false);
});
test('fine island inside a coarse water area is avoided and detour bends are rounded', () => {
  const surface = field((x, y) => (x >= 40 && x <= 60 && y >= 35 && y <= 65 ? 1600 : -250));
  const from = { x: 10.5, y: 50.5 },
    to = { x: 90.5, y: 50.5 };
  assert.equal(isWaterSegment(surface, from, to), false);
  const router = createWaterRouter(surface),
    route = router.route(from, to, 73);
  assert(route.length > 12, 'detour persists sampled soft curves rather than sharp grid corners');
  assert.deepEqual(route[0], from);
  assert.deepEqual(route[route.length - 1], to);
  assert(route.some((p) => p.y < 35 || p.y > 65));
  assert(
    route.some((p) => Math.abs(p.x * 2 - Math.round(p.x * 2)) > 0.01),
    'rounded curve leaves raster center lattice',
  );
  assertWater(surface, route);
  assert.deepEqual(router.route(from, to, 73), route);
  const rounded = { ...surface, values: Array.from(surface.values, Math.round) };
  assertWater(rounded, route);
});
test('open-water connections form gentle deterministic arcs and retain endpoints', () => {
  const surface = field(() => -500),
    router = createWaterRouter(surface);
  const from = { x: 10.5, y: 50.5 },
    to = { x: 90.5, y: 50.5 };
  const route = router.route(from, to, 55);
  assert(route.length > 12);
  assert(route.some((p) => Math.abs(p.y - from.y) >= 3));
  assert.deepEqual(route[0], from);
  assert.deepEqual(route[route.length - 1], to);
  assertWater(surface, route);
  assert.deepEqual(router.route(from, to, 55), route);
  assert.notDeepEqual(router.route(from, to, 54), route);
});
test('shipping does not connect disconnected water basins or accept overland endpoints', () => {
  const surface = field((x) => (x >= 48 && x <= 52 ? 1800 : -800)),
    router = createWaterRouter(surface);
  assert.deepEqual(router.route({ x: 10.5, y: 50.5 }, { x: 90.5, y: 50.5 }), []);
  assert.deepEqual(router.route({ x: 50.5, y: 50.5 }, { x: 90.5, y: 50.5 }), []);
});
test('harbors use fine near-shore water and never a coarse area center on a small island', () => {
  const surface = field((x) => (x <= 30 || (x >= 58 && x <= 72) ? 800 : -100));
  const router = createWaterRouter(surface),
    site = { x: 29.5, y: 50.5 };
  const harbor = router.findHarbor(site, 8);
  assert(harbor);
  assert(harbor.x > 30 && harbor.x < 37);
  assert(isWaterPoint(surface, harbor, -5));
  assert(distance(site, harbor) < 8);
  assert.equal(router.findHarbor({ x: 10.5, y: 50.5 }, 5), undefined);
});
test('an enclosed lake touching ocean samples diagonally across a land saddle stays inland', () => {
  const surface = field(
    (x, y) => ((x < 20 && y < 20) || (x >= 20 && x < 40 && y >= 20 && y < 40) ? -100 : 1000),
    5,
    5,
  );
  const router = createWaterRouter(surface),
    ocean = { x: 10, y: 10 },
    lake = { x: 30, y: 30 };
  assert(router.isOcean(ocean));
  assert(!router.isOcean(lake));
  assert.notEqual(router.basinAt(ocean), router.basinAt(lake));
  assert.deepEqual(router.route(ocean, lake), []);
  assert.equal(router.findHarbor({ x: 30, y: 40 }, 12, true), undefined);
  assert(router.findHarbor({ x: 30, y: 40 }, 12));
  assert.equal(router.isOcean({ x: -10, y: 10 }), false);
});
const distance = (a: MapPoint, b: MapPoint) => Math.hypot(a.x - b.x, a.y - b.y);
