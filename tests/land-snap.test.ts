import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeed } from '../shared/seed';
import type { AtlasMap } from '../shared/model';
import type { DivisionPaint, MapPoint } from '../shared/cartography';
import {
  coastIndex,
  coastlinesFromObjects,
  snapDivisionToLand,
  splitClosedRings,
} from '../src/lib/land-snap';
import { bakeMapArtwork, createEditorData, joinContours } from '../src/lib/cartography';
import { divisionAt } from '../src/lib/divisions';
import { validateWorkspace } from '../server/validation';

const shore: MapPoint[] = [
  { x: 100, y: 100 },
  { x: 350, y: 100 },
  { x: 355, y: 130 },
  { x: 340, y: 160 },
  { x: 365, y: 190 },
  { x: 345, y: 220 },
  { x: 350, y: 280 },
  { x: 100, y: 280 },
];
function stroke(id: string, points: MapPoint[], divisionId = 'country'): DivisionPaint {
  return {
    id,
    divisionId,
    operation: 'paint',
    geometry: 'polygon',
    points,
    width: 5,
    roughness: 0,
    seed: 3,
  };
}
function mapWith(paints: DivisionPaint[]): AtlasMap {
  return {
    ...createSeed().maps[0],
    width: 500,
    height: 400,
    pins: [],
    strokes: [],
    editor: {
      ...createEditorData(),
      divisions: [
        { id: 'country', kind: 'country', name: 'Country', color: '#a36550', visible: true },
        { id: 'neighbor', kind: 'country', name: 'Neighbor', color: '#49765c', visible: true },
        { id: 'culture', kind: 'culture', name: 'Culture', color: '#587b7f', visible: true },
      ],
      divisionPaint: paints,
    },
  };
}
test('nearest shore uses segments, distance cutoff, inner lakes and ignores artificial frame or hole bridges', () => {
  const hole = [
    { x: 190, y: 150 },
    { x: 210, y: 150 },
    { x: 210, y: 170 },
    { x: 190, y: 170 },
  ];
  const compound = joinContours([shore, hole])[0];
  assert.equal(splitClosedRings(compound).length, 2);
  const index = coastIndex([compound], 500, 400);
  assert.equal(index.nearest({ x: 220, y: 160 }, 9), undefined);
  assert.deepEqual(index.nearest({ x: 220, y: 160 }, 10)?.point, { x: 210, y: 160 });
  assert.equal(
    coastIndex(
      [
        [
          { x: 0, y: 0 },
          { x: 500, y: 0 },
          { x: 500, y: 400 },
          { x: 0, y: 400 },
        ],
      ],
      500,
      400,
    ).nearest({ x: 5, y: 200 }, 30),
    undefined,
  );
  const bridgeMid = { x: 145, y: 125 };
  const bridgeHit = index.nearest(bridgeMid, 3);
  assert.equal(bridgeHit, undefined, 'the bridge between coast and lake is not a real shoreline');
});
test('snap follows a curved coastal arc, preserves far inland boundary, layer order and other themes', () => {
  const target = stroke('range', [
    { x: 200, y: 125 },
    { x: 360, y: 125 },
    { x: 360, y: 245 },
    { x: 200, y: 245 },
  ]);
  const neighbor = stroke(
    'neighbor-stroke',
    [
      { x: 180, y: 110 },
      { x: 220, y: 110 },
      { x: 220, y: 260 },
      { x: 180, y: 260 },
    ],
    'neighbor',
  );
  const culture = stroke('culture-stroke', shore, 'culture');
  const map = mapWith([target, neighbor, culture]),
    before = structuredClone(map);
  const result = snapDivisionToLand(map, 'country', [shore], 20);
  assert.equal(result.changed, 1);
  assert.deepEqual(map, before);
  assert.equal(result.paints[1], neighbor);
  assert.equal(result.paints[2], culture);
  assert(result.paints[0].points.some((p) => p.x === 200 && p.y === 125));
  assert(result.paints[0].points.some((p) => p.x === 200 && p.y === 245));
  const coastal = result.paints[0].points.filter((p) => p.x > 340);
  assert(coastal.length >= 6, 'coast alignment retains bay bends instead of a straight chord');
  const index = coastIndex([shore], 500, 400);
  for (const p of coastal)
    assert(index.nearest(p, 0.7), 'snapped coastal control points must lie on the shore');
  const snapped = { ...map, editor: { ...map.editor!, divisionPaint: result.paints } };
  assert.equal(divisionAt(snapped, 'country', { x: 205, y: 200 })?.id, 'neighbor');
  assert.equal(divisionAt(snapped, 'culture', { x: 205, y: 200 })?.id, 'culture');
  assert.equal(snapDivisionToLand(map, 'country', [shore], 0).changed, 0);
  assert.equal(
    snapDivisionToLand(
      mapWith([
        stroke('far', [
          { x: 180, y: 145 },
          { x: 230, y: 145 },
          { x: 230, y: 235 },
          { x: 180, y: 235 },
        ]),
      ]),
      'country',
      [shore],
      20,
    ).changed,
    0,
  );
});
test('brush outlines and erased holes convert to precise persisted polygons with no unrelated edits', () => {
  const paint = {
    ...stroke('brush', [
      { x: 335, y: 135 },
      { x: 335, y: 245 },
    ]),
    geometry: 'brush' as const,
    width: 50,
    roughness: 0.3,
  };
  const erase = {
    ...stroke('hole', [
      { x: 323, y: 182 },
      { x: 332, y: 182 },
      { x: 332, y: 195 },
      { x: 323, y: 195 },
    ]),
    operation: 'erase' as const,
  };
  const map = mapWith([paint, erase]);
  const result = snapDivisionToLand(map, 'country', [shore], 14);
  assert.equal(result.changed, 1);
  assert(result.paints[0].geometry === 'polygon' && result.paints[0].roughness === 0);
  assert.equal(result.paints[1], erase);
  const next = { ...map, editor: { ...map.editor!, divisionPaint: result.paints } };
  assert.equal(divisionAt(next, 'country', { x: 327, y: 188 }), undefined);
  const workspace = createSeed();
  workspace.maps[0] = next;
  assert.doesNotThrow(() => validateWorkspace(JSON.parse(JSON.stringify(workspace))));
});
test('compound holes survive repeated snapping; invalid or collapsed ranges fail without mutating input', () => {
  const outer = [
      { x: 200, y: 125 },
      { x: 360, y: 125 },
      { x: 360, y: 245 },
      { x: 200, y: 245 },
    ],
    hole = [
      { x: 245, y: 170 },
      { x: 265, y: 170 },
      { x: 265, y: 195 },
      { x: 245, y: 195 },
    ];
  const map = mapWith([stroke('compound', joinContours([outer, hole])[0])]);
  const result = snapDivisionToLand(map, 'country', [shore], 20);
  const next = { ...map, editor: { ...map.editor!, divisionPaint: result.paints } };
  assert.equal(splitClosedRings(result.paints[0].points).length, 2);
  assert.equal(divisionAt(next, 'country', { x: 250, y: 185 }), undefined);
  const repeated = snapDivisionToLand(next, 'country', [shore], 20);
  assert.equal(splitClosedRings(repeated.paints[0].points).length, 2);
  assert.throws(() => snapDivisionToLand(map, 'country', [shore], NaN), /有效/);
  assert.throws(() => snapDivisionToLand(map, 'country', [], 10), /没有/);
  const thin = mapWith([
    stroke('thin', [
      { x: 355, y: 225 },
      { x: 357, y: 225 },
      { x: 357, y: 240 },
      { x: 355, y: 240 },
    ]),
  ]);
  const before = structuredClone(thin);
  assert.throws(
    () =>
      snapDivisionToLand(
        thin,
        'country',
        [
          [
            { x: 100, y: 100 },
            { x: 350, y: 100 },
            { x: 350, y: 300 },
            { x: 100, y: 300 },
          ],
        ],
        20,
      ),
    /交叉或坍缩/,
  );
  assert.deepEqual(thin, before);
});

test('a legacy map frozen into editable objects retains its real mainland coast for snapping', () => {
  const seed = createSeed().maps[0];
  const objects = bakeMapArtwork(seed);
  const coasts = coastlinesFromObjects(objects);
  assert(coasts.length > 0);
  for (const ring of coasts) assert(ring.length >= 3);
  const map = mapWith([
    stroke('legacy-range', [
      { x: 420, y: 240 },
      { x: 620, y: 240 },
      { x: 620, y: 440 },
      { x: 420, y: 440 },
    ]),
  ]);
  map.width = seed.width;
  map.height = seed.height;
  assert.doesNotThrow(() => snapDivisionToLand(map, 'country', coasts, 0));
});
