import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTerrain, pointInPolygon, distanceToSegment } from '../src/lib/terrain.ts';

test('world terrain is reproducible from its seed and changes with a new seed', () => {
  assert.deepEqual(generateTerrain(470), generateTerrain(470));
  assert.notDeepEqual(generateTerrain(470).land, generateTerrain(471).land);
  const map = generateTerrain(470);
  assert.ok(map.land.length >= 3 && map.symbols.length > 50 && map.rivers.length > 0);
  for (const symbol of map.symbols)
    assert.ok(map.land.some((land) => pointInPolygon(symbol, land.points)));
});
test('map generation honors dimensions and reserves zero for a manual canvas', () => {
  assert.equal(generateTerrain(0).land.length, 0);
  assert.equal(generateTerrain(0, 1000, 640, 'town').blocks.length, 0);
  const small = generateTerrain(42, 500, 320),
    large = generateTerrain(42, 1000, 640);
  assert.ok(Math.abs(small.land[0].points[12].x * 2 - large.land[0].points[12].x) < 0.02);
  for (const land of large.land)
    for (const p of land.points) assert.ok(p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 640);
});
test('town generation produces deterministic distinct blocks, streets, and wall', () => {
  const town = generateTerrain(137, 1000, 640, 'town');
  assert.deepEqual(town, generateTerrain(137, 1000, 640, 'town'));
  assert.ok(town.blocks.length > 20 && town.roads.length > 5 && town.wall.length > 20);
  assert.ok(town.blocks.every((b) => b.points.length === 4 && b.path.endsWith('Z')));
});
test('world and region coastlines stay inside the exportable canvas across seeds', () => {
  for (const kind of ['world', 'region'] as const)
    for (let seed = 1; seed <= 30; seed++) {
      for (const land of generateTerrain(seed, 1000, 640, kind).land)
        for (const point of land.points) {
          assert.ok(
            point.x >= 0 && point.x <= 1000 && point.y >= 0 && point.y <= 640,
            `${kind} ${seed} generated an out-of-bounds coastline`,
          );
        }
    }
});
test('eraser segment distance handles the middle of long segments and single dots', () => {
  assert.equal(distanceToSegment({ x: 50, y: 3 }, { x: 0, y: 0 }, { x: 100, y: 0 }), 3);
  assert.equal(distanceToSegment({ x: 103, y: 4 }, { x: 0, y: 0 }, { x: 100, y: 0 }), 5);
  assert.equal(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 }), 5);
});
