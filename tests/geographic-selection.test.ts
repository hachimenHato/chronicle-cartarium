import test from 'node:test';
import assert from 'node:assert/strict';
import type { GeneratedGeography } from '../shared/geography';
import { selectGeographicCells, selectableGeographicCell } from '../src/lib/geographic-selection';
import { assignGeographicCells, clearGeographicCells } from '../src/lib/geographic-edits';
import type { ElevationField } from '../src/lib/elevation';

function fixture(): GeneratedGeography {
  return {
    version: 1,
    seed: 1,
    width: 600,
    height: 100,
    plates: [],
    areas: [],
    ports: [],
    seaRoutes: [],
    divisions: [
      { id: 'country_a', kind: 'country', name: '甲', color: '#779977', center: { x: 100, y: 50 } },
      { id: 'country_b', kind: 'country', name: '乙', color: '#997777', center: { x: 300, y: 50 } },
      {
        id: 'culture_a',
        kind: 'culture',
        name: '文化',
        color: '#779999',
        center: { x: 100, y: 50 },
      },
    ],
    cells: [0, 1, 2, 3, 4, 5].map((id) => ({
      id,
      center: { x: id * 100 + 50, y: 50 },
      polygon: [
        { x: id * 100, y: 0 },
        { x: id * 100 + 100, y: 0 },
        { x: id * 100 + 100, y: 100 },
        { x: id * 100, y: 100 },
      ],
      neighbors: [id - 1, id + 1].filter((n) => n >= 0 && n <= 5),
      land: id !== 4,
      plate: 0,
      elevation: id === 4 ? -200 : 200,
      temperature: 20,
      precipitation: 800,
      biome: id === 4 ? 'water' : 'grass',
      shelf: false,
      ...(id === 4
        ? {}
        : { country: id < 2 || id === 5 ? 'country_a' : 'country_b', culture: 'culture_a' }),
    })),
    borders: [0, 1, 2, 3, 4].map((id) => ({
      id: `edge_${id}`,
      kind: 'cell',
      cells: [id, id + 1],
      points: [
        { x: (id + 1) * 100, y: 0 },
        { x: (id + 1) * 100, y: 100 },
      ],
    })),
  };
}

test('cell selection is reversible and never writes ownership until explicitly filled', () => {
  const g = fixture(),
    before = structuredClone(g);
  const selected = selectGeographicCells(g, new Set(), 0);
  const added = selectGeographicCells(g, selected, 1);
  assert.deepEqual([...selected], [0]);
  assert.deepEqual([...added], [0, 1]);
  assert.deepEqual([...selectGeographicCells(g, added, 1)], [0]);
  assert.deepEqual(g, before);
  const filled = assignGeographicCells(g, 'country_b', selected);
  assert.equal(filled.cells[0].country, 'country_b');
  assert.equal(g.cells[0].country, 'country_a');
  assert.equal(filled.cells[0].culture, 'culture_a');
  assert.deepEqual(filled.cells[0].polygon, g.cells[0].polygon);
  assert.deepEqual(
    filled.borders.filter((b) => b.kind === 'cell'),
    g.borders,
  );
  assert.deepEqual(
    filled.borders.filter((b) => b.kind === 'country').map((b) => b.cells),
    [
      [0, 1],
      [1, 2],
    ],
  );
  const cleared = clearGeographicCells(filled, 'culture', selected);
  assert.equal(cleared.cells[0].culture, undefined);
  assert.equal(cleared.cells[0].country, 'country_b');
  assert.equal(cleared.cells[1].culture, 'culture_a');
});

test('Shift selection follows connected land and does not bridge an ocean gap', () => {
  const g = fixture();
  assert.deepEqual(
    [...selectGeographicCells(g, new Set([0]), 3, 0, { extend: true })].sort(),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    [...selectGeographicCells(g, new Set([0]), 5, 0, { extend: true })].sort(),
    [0, 5],
  );
  assert.deepEqual([...selectGeographicCells(g, new Set([0]), 4, 0, { extend: true })], [0]);
});

test('Ctrl selection groups only connected cells with the active kind of ownership', () => {
  const g = fixture();
  assert.deepEqual(
    [...selectGeographicCells(g, new Set(), 0, undefined, { group: true, kind: 'country' })].sort(),
    [0, 1],
  );
  assert.deepEqual(
    [...selectGeographicCells(g, new Set(), 0, undefined, { group: true, kind: 'culture' })].sort(),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    [...selectGeographicCells(g, new Set(), 5, undefined, { group: true, kind: 'country' })],
    [5],
  );
});

test('mixed coastal cells reject fine water clicks even though their mesh flag says land', () => {
  const g = fixture();
  const surface: ElevationField = {
    columns: 6,
    rows: 2,
    width: 600,
    height: 100,
    values: Float32Array.from([200, -100, 200, 200, -200, 200, 200, -100, 200, 200, -200, 200]),
    min: -200,
    max: 200,
  };
  assert.equal(g.cells[1].land, true);
  assert.equal(selectableGeographicCell(g, { x: 150, y: 50 }, surface), undefined);
  assert.equal(selectableGeographicCell(g, { x: 50, y: 50 }, surface)?.id, 0);
  assert.equal(selectableGeographicCell(g, { x: 450, y: 50 }, surface), undefined);
});
