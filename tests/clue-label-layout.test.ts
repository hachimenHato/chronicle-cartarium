import assert from 'node:assert/strict';
import test from 'node:test';
import {
  placeClueLabels,
  lineIntersectsRect,
  type ClueLabelGeometry,
} from '../src/lib/clue-label-layout';

const crossing: ClueLabelGeometry[] = [
  {
    id: 'horizontal',
    width: 84,
    height: 26,
    preferred: { x: 500, y: 0 },
    points: Array.from({ length: 51 }, (_, index) => ({ x: index * 20, y: 0 })),
  },
  {
    id: 'vertical',
    width: 72,
    height: 26,
    preferred: { x: 500, y: 0 },
    points: Array.from({ length: 51 }, (_, index) => ({ x: 500, y: -200 + index * 8 })),
  },
  {
    id: 'unlabelled',
    width: 0,
    height: 0,
    preferred: { x: 500, y: 60 },
    points: [
      { x: 0, y: 60 },
      { x: 1000, y: 60 },
    ],
  },
];
test('connection notes avoid every route, other labels and cards, including crossings and unlabelled routes', () => {
  const cards = [
    { x: -240, y: -53, width: 240, height: 106 },
    { x: 1000, y: -53, width: 240, height: 106 },
  ];
  const result = placeClueLabels(crossing, cards);
  assert.equal(Object.keys(result).length, 2);
  assert.deepEqual(placeClueLabels([...crossing].reverse(), cards), result);
  for (const edge of crossing.filter((edge) => edge.width)) {
    const note = result[edge.id];
    assert(note.clear);
    const rect = {
      x: note.x - edge.width / 2,
      y: note.y - edge.height / 2,
      width: edge.width,
      height: edge.height,
    };
    for (const route of crossing)
      for (let i = 1; i < route.points.length; i++)
        assert(!lineIntersectsRect(route.points[i - 1], route.points[i], rect));
    assert(
      Math.hypot(note.anchor.x - 500, note.anchor.y) >= 10,
      'Leader should start away from the crossing',
    );
  }
});
test('line intersection handles parallel, zero-length and diagonal paths', () => {
  const rect = { x: 10, y: 10, width: 20, height: 20 };
  assert(lineIntersectsRect({ x: 0, y: 0 }, { x: 50, y: 50 }, rect));
  assert(!lineIntersectsRect({ x: 0, y: 0 }, { x: 50, y: 0 }, rect));
  assert(lineIntersectsRect({ x: 20, y: 20 }, { x: 20, y: 20 }, rect));
  assert(!lineIntersectsRect({ x: 40, y: 20 }, { x: 40, y: 20 }, rect));
});
