import { test } from 'node:test';
import assert from 'node:assert/strict';
import { objectLegend, authoredLegend } from '../src/lib/map-legend';
import { createMapObject } from '../src/lib/cartography';
import { createSeed } from '../shared/seed';
test('map legend follows rendered geometry and layer visibility rather than requested generator settings', () => {
  const river = createMapObject('path', { x: 10, y: 20 }, { name: '河流 1', stroke: '#657d79' });
  const hidden = createMapObject(
    'symbol',
    { x: 20, y: 40 },
    { symbol: 'mountain', visible: false },
  );
  const tree = createMapObject('symbol', { x: 30, y: 50 }, { symbol: 'tree' });
  assert.deepEqual(
    objectLegend([river, hidden, tree]).map((i) => i.id),
    ['river', 'forest'],
  );
  const map = createSeed().maps[0];
  map.strokes = [{ id: 's', tool: 'road', color: '#777777', width: 4, points: [{ x: 10, y: 10 }] }];
  assert.equal(authoredLegend(map, false, false).length, 0);
  assert.equal(authoredLegend(map, false, true)[0].id, 'road');
});
