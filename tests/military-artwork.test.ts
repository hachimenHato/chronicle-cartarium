import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { MapMilitaryLine } from '../shared/generated-map';
import { buildMilitaryArtwork } from '../src/lib/military-artwork';
import { linePath } from '../src/lib/terrain';

const line = (
  kind: MapMilitaryLine['kind'],
  points = [
    { x: 20, y: 20 },
    { x: 90, y: 20 },
    { x: 90, y: 90 },
    { x: 170, y: 150 },
  ],
): MapMilitaryLine => ({
  id: 'plan',
  name: '计划',
  kind,
  points,
  color: '#ac6248',
  width: 2,
  visible: true,
});
test('advance uses a finite closed tapered ribbon with rounded authored bends', () => {
  const plan = line('advance'),
    original = structuredClone(plan);
  const artwork = buildMilitaryArtwork(plan);
  assert.ok(artwork.ribbon?.endsWith(' Z'));
  assert.ok(artwork.ribbon?.includes('170,150'));
  assert.ok(artwork.centerline !== linePath(plan.points));
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(artwork)));
  assert.deepEqual(plan, original, 'derived military art never changes saved control points');
});
test('front retains every exact shared-edge point while marks are derived separately', () => {
  const plan = line('front'),
    artwork = buildMilitaryArtwork(plan);
  assert.equal(artwork.centerline, linePath(plan.points));
  assert.ok(artwork.marks.length > 0);
  assert.equal(artwork.ribbon, undefined);
});
test('defensive teeth face one side of the drawing direction and reverse predictably', () => {
  const east = buildMilitaryArtwork(
    line('defense', [
      { x: 10, y: 10 },
      { x: 210, y: 10 },
    ]),
  );
  const west = buildMilitaryArtwork(
    line('defense', [
      { x: 210, y: 10 },
      { x: 10, y: 10 },
    ]),
  );
  assert.ok(east.marks.length > 2);
  assert.ok(east.marks.every((m) => m.tip.y > m.base.y && m.path.endsWith(' Z')));
  assert.ok(west.marks.every((m) => m.tip.y < m.base.y));
});
test('short, duplicate, vertical and retreat plans never create invalid geometry', () => {
  for (const kind of ['front', 'advance', 'retreat', 'defense'] as const)
    for (const points of [
      [
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ],
      [
        { x: 1, y: 1 },
        { x: 1, y: 1.02 },
      ],
      [
        { x: 2, y: 1 },
        { x: 2, y: 100 },
      ],
    ]) {
      const artwork = buildMilitaryArtwork(line(kind, points));
      assert.ok(!/NaN|Infinity/.test(JSON.stringify(artwork)));
      if (kind === 'retreat' && points[0].y !== points[1].y) assert.ok(artwork.arrowhead);
    }
});
