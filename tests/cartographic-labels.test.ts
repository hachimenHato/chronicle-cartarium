import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GeneratedGeography, GeographicCell } from '../shared/geography';
import { layoutCartographicLabels } from '../src/lib/cartographic-labels';
import { pointInPolygon } from '../src/lib/terrain';

function geography(): GeneratedGeography {
  const columns = 10,
    rows = 6;
  const cells: GeographicCell[] = Array.from({ length: columns * rows }, (_, id) => {
    const x = id % columns,
      y = Math.floor(id / columns),
      land = y < 4;
    return {
      id,
      center: { x: x * 100 + 50, y: y * 100 + 50 },
      polygon: [
        { x: x * 100, y: y * 100 },
        { x: (x + 1) * 100, y: y * 100 },
        { x: (x + 1) * 100, y: (y + 1) * 100 },
        { x: x * 100, y: (y + 1) * 100 },
      ],
      neighbors: [],
      land,
      plate: 0,
      elevation: land ? 100 : -100,
      temperature: 18,
      precipitation: 800,
      biome: land ? 'grass' : 'water',
      shelf: !land,
      ...(land ? { country: x < 5 ? 'west' : 'east' } : {}),
    };
  });
  return {
    version: 1,
    seed: 1,
    width: 1000,
    height: 600,
    cells,
    divisions: [
      {
        id: 'west',
        kind: 'country',
        name: '西境王国',
        color: '#98765a',
        center: { x: 250, y: 200 },
        entityId: 'west-page',
      },
      {
        id: 'east',
        kind: 'country',
        name: '东岚联邦',
        color: '#678e76',
        center: { x: 750, y: 200 },
      },
    ],
    areas: [
      {
        id: 'ocean',
        kind: 'ocean',
        name: '暮潮海',
        center: { x: 500, y: 500 },
        cells: cells.filter((c) => !c.land).map((c) => c.id),
      },
    ],
    plates: [
      {
        id: 0,
        name: '主大陆板块',
        center: { x: 500, y: 300 },
        velocity: { x: 1, y: 0 },
        kind: 'continental',
        color: '#ad9576',
      },
    ],
    borders: [],
    ports: [],
    seaRoutes: [],
  };
}
const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test('cartographic names follow gentle curves inside their territory and sea', () => {
  const g = geography(),
    labels = layoutCartographicLabels({ geography: g });
  assert.equal(labels.length, 3);
  assert.equal(labels.find((l) => l.id === 'west')?.entityId, 'west-page');
  assert.ok(labels.some((l) => l.path.includes(' C')));
  for (const label of labels) {
    const cells = g.cells.filter((c) =>
      label.kind === 'water' ? !c.land : c.country === label.id,
    );
    assert.ok(label.bounds.x >= 0 && label.bounds.y >= 0);
    assert.ok(label.bounds.x + label.bounds.width <= g.width);
    assert.ok(label.bounds.y + label.bounds.height <= g.height);
    for (const p of label.points)
      assert.ok(
        cells.some((c) => pointInPolygon(p, c.polygon)),
        `${label.name} leaves its area`,
      );
  }
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++)
      assert.equal(overlaps(labels[i].bounds, labels[j].bounds), false);
  assert.deepEqual(labels, layoutCartographicLabels({ geography: g }));
});

test('settlement names and links have priority and territory names avoid landmarks', () => {
  const g = geography(),
    site = {
      id: 'capital',
      kind: 'city' as const,
      name: '王都雪桥城',
      x: 250,
      y: 200,
      entityId: 'capital-page',
    };
  const labels = layoutCartographicLabels({ geography: g, sites: [site] });
  const town = labels.find((l) => l.id === site.id)!;
  assert.ok(town);
  assert.equal(town.entityId, 'capital-page');
  assert.equal(town.kind, 'settlement');
  const landmark = { x: 244, y: 191, width: 12, height: 15 };
  for (const label of labels) {
    assert.equal(overlaps(label.bounds, landmark), false);
    if (label !== town) assert.equal(overlaps(label.bounds, town.bounds), false);
  }
});

test('too narrow or obscured regions omit names rather than overlap or spill', () => {
  const g = geography();
  const labels = layoutCartographicLabels({
    geography: g,
    obstacles: [{ x: 0, y: 0, width: 500, height: 400 }],
  });
  assert.equal(
    labels.some((l) => l.id === 'west'),
    false,
  );
  assert.equal(
    labels.some((l) => l.id === 'east'),
    true,
  );
  g.divisions[1].name = '长'.repeat(200);
  assert.equal(
    layoutCartographicLabels({ geography: g }).some((l) => l.id === 'east'),
    false,
  );
});

test('settlement labels avoid the real large miniature and surrounding buildings', () => {
  const g = geography();
  const site = { id: 'fort', kind: 'castle' as const, name: '星垣堡', x: 250, y: 200 };
  const objects = [
    {
      id: 'castle',
      name: '聚落 1 · 地标',
      kind: 'symbol' as const,
      points: [{ x: 250, y: 200 }],
      symbol: 'castle' as const,
      size: 100,
      color: '#98765a',
      stroke: '#876549',
      strokeWidth: 1,
      text: '',
      opacity: 1,
      rotation: 0,
      visible: true,
      locked: false,
    },
    {
      id: 'house',
      name: '聚落 1 · 周边建筑 1 · 屋面',
      kind: 'polygon' as const,
      points: [
        { x: 200, y: 225 },
        { x: 305, y: 225 },
        { x: 305, y: 275 },
        { x: 200, y: 275 },
      ],
      size: 1,
      color: '#98765a',
      stroke: '#876549',
      strokeWidth: 1,
      text: '',
      opacity: 1,
      rotation: 0,
      visible: true,
      locked: false,
    },
  ];
  const labels = layoutCartographicLabels({ geography: g, sites: [site], objects });
  const label = labels.find((l) => l.id === site.id);
  assert.ok(label);
  const realFootprint = {
    x: 200,
    y: 200 - ((43 * 100) / 32) * 0.52,
    width: 105,
    height: 275 - (200 - ((43 * 100) / 32) * 0.52),
  };
  for (const name of labels) assert.equal(overlaps(name.bounds, realFootprint), false);
});

test('coarse coastal polygons cannot put water names on fine-grid land', () => {
  const g = geography();
  const values = Array.from({ length: 60 }, (_, id) => (Math.floor(id / 10) < 5 ? 100 : -100));
  const labels = layoutCartographicLabels({
    geography: g,
    elevation: { columns: 10, rows: 6, width: 1000, height: 600, values, min: -100, max: 100 },
  });
  const sea = labels.find((l) => l.id === 'ocean');
  assert.ok(sea);
  for (const p of sea.points)
    assert.ok(p.y > 500, 'water name must move off land present only in the fine grid');
});
