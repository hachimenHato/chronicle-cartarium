import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MapPoint } from '../shared/cartography';
import type { SketchCell } from '../src/lib/sketch-generation-v1';
import {
  buildDrainage,
  generateRiverNetwork,
  generateRoadNetwork,
} from '../src/lib/sketch-networks';

function grid(
  columns: number,
  rows: number,
  sample: (x: number, y: number) => Partial<SketchCell> = () => ({}),
) {
  return Array.from({ length: columns * rows }, (_, i): SketchCell => {
    const x = i % columns,
      y = Math.floor(i / columns);
    return {
      x: x + 0.5,
      y: y + 0.5,
      land: true,
      biome: 'grass',
      elevation: 0.1,
      drainageElevation: 0.1,
      downstream: -1,
      moisture: 0.5,
      slope: 0.005,
      accumulation: 1,
      ...sample(x, y),
    };
  });
}
function sampleSegments(points: MapPoint[], assertion: (point: MapPoint) => void) {
  for (let i = 1; i < points.length; i++)
    for (let step = 0; step <= 8; step++) {
      assertion({
        x: points[i - 1].x + ((points[i].x - points[i - 1].x) * step) / 8,
        y: points[i - 1].y + ((points[i].y - points[i - 1].y) * step) / 8,
      });
    }
}

test('filled drainage preserves elevations, has strict descent, and conserves catchment area at outlets', () => {
  const columns = 39,
    rows = 31;
  const cells = grid(columns, rows, (x, y) => ({
    land: !(x < 2 || y > rows - 4),
    elevation:
      x < 2 || y > rows - 4 ? -0.1 : 0.12 + Math.sin(x * 0.37) * 0.08 + Math.cos(y * 0.28) * 0.09,
  }));
  const elevations = cells.map((c) => c.elevation);
  buildDrainage(cells, columns, rows);
  assert.deepEqual(
    cells.map((c) => c.elevation),
    elevations,
  );
  for (let i = 0; i < cells.length; i++) {
    let at = i;
    const seen = new Set<number>();
    while (cells[at].downstream >= 0) {
      assert(!seen.has(at));
      seen.add(at);
      const next = cells[at].downstream;
      assert(cells[next].drainageElevation < cells[at].drainageElevation);
      assert(cells[next].accumulation >= cells[at].accumulation);
      at = next;
    }
    assert(
      !cells[at].land ||
        at % columns === 0 ||
        at % columns === columns - 1 ||
        at < columns ||
        at >= columns * (rows - 1),
    );
  }
  assert.equal(
    cells.filter((c) => c.downstream < 0).reduce((sum, c) => sum + c.accumulation, 0),
    cells.filter((c) => c.land).length,
  );
});

test('tributaries meet the same rendered point as their parent and widen downstream', () => {
  const columns = 72,
    rows = 64;
  const cells = grid(columns, rows, (x, y) => ({
    land: y < rows - 3,
    elevation:
      y < rows - 3
        ? (rows - y) * 0.002 + Math.abs(x - 36) * 0.004 + Math.sin(y * 0.4) * 0.001
        : -0.1,
  }));
  buildDrainage(cells, columns, rows);
  const result = generateRiverNetwork(cells, columns, rows, columns, rows, 2741);
  assert(result.rivers.length > 1);
  assert.equal(
    new Set(result.rivers.map((path) => path.join(','))).size,
    result.rivers.length,
    'a tributary is emitted once even when its endpoint is a parent confluence',
  );
  const directedEdges = result.rivers.flatMap((path) =>
    path.slice(1).map((n, i) => `${path[i]}:${n}`),
  );
  assert.equal(
    new Set(directedEdges).size,
    directedEdges.length,
    'flow edges cannot be painted repeatedly by re-queued tributaries',
  );
  const byCell = new Map<number, MapPoint>();
  let joined = 0;
  result.rivers.forEach((path, index) => {
    const channel = result.channels[index];
    assert.equal(channel.widths.length, channel.points.length);
    assert(channel.points.length < 2000);
    path.forEach((cell, i) => {
      const point = channel.points[i * 2];
      if (byCell.has(cell)) {
        assert.deepEqual(point, byCell.get(cell));
        joined++;
      }
      byCell.set(cell, point);
      if (i > 0) assert.equal(cells[path[i - 1]].downstream, cell);
    });
    for (let i = 1; i < channel.widths.length; i++)
      assert(channel.widths[i] >= channel.widths[i - 1]);
  });
  assert(joined > 0, 'the fixture contains a visible tributary confluence');
  assert.deepEqual(result, generateRiverNetwork(cells, columns, rows, columns, rows, 2741));
});

test('a low coastal main stem can split into a descending distributary, but an inland lake cannot', () => {
  const columns = 56,
    rows = 56;
  const cells = grid(columns, rows, (_x, y) => ({
    land: y < 50,
    elevation: y < 50 ? (50 - y) * 0.003 : -0.1,
  }));
  // Construct a main stem with enough collected rainfall on a gently sloping coastal plain.
  for (let y = 5; y < 50; y++) {
    const i = y * columns + 28;
    cells[i].downstream = i + columns;
    cells[i].accumulation = 150 + y * 15;
  }
  cells.forEach((c) => {
    c.drainageElevation = c.elevation;
  });
  const result = generateRiverNetwork(cells, columns, rows, columns, rows, 61);
  const delta = result.channels.find((c) => c.kind === 'distributary');
  assert(delta, 'the low, broad estuary fixture supports a separate mouth');
  assert(
    result.channels
      .filter((c) => c.kind === 'river')
      .some((c) => c.points.some((p) => p.x === delta.points[0].x && p.y === delta.points[0].y)),
  );
  let previousElevation = Infinity;
  sampleSegments(delta.points, (point) => {
    const cell = cells[Math.floor(point.y) * columns + Math.floor(point.x)];
    assert(cell.elevation <= previousElevation + 1e-6);
    previousElevation = cell.elevation;
  });
  const inland = structuredClone(cells);
  for (let y = 50; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      if (y === rows - 1 || x < 20 || x > 36) {
        inland[y * columns + x].land = true;
        inland[y * columns + x].elevation = 0.5;
      }
    }
  assert(
    !generateRiverNetwork(inland, columns, rows, columns, rows, 61).channels.some(
      (c) => c.kind === 'distributary',
    ),
  );
});

test('roads bend around a lake and keep the full smoothed path on passable land', () => {
  const columns = 64,
    rows = 40;
  const cells = grid(columns, rows, (x, y) => ({ land: !((x - 32) ** 2 + (y - 20) ** 2 < 75) }));
  const towns = [20 * columns + 5, 20 * columns + 58];
  const result = generateRoadNetwork(cells, columns, rows, columns, rows, towns, new Set(), 10);
  assert.equal(result.routes.length, 1);
  assert(result.paths[0].some((point) => Math.abs(point.y - 20.5) > 8));
  sampleSegments(result.paths[0], (p) =>
    assert(cells[Math.floor(p.y) * columns + Math.floor(p.x)]?.land),
  );
  assert.deepEqual(
    result,
    generateRoadNetwork(cells, columns, rows, columns, rows, towns, new Set(), 10),
  );
});

test('roads cross narrow rivers using bridges, reject broad crossings, and never cross sea gaps', () => {
  const columns = 40,
    rows = 24;
  const cells = grid(columns, rows);
  const rivers = new Set<number>();
  for (let y = 0; y < rows; y++) {
    const i = y * columns + 20;
    rivers.add(i);
    cells[i].accumulation = 100;
    cells[i].downstream = y < rows - 1 ? i + columns : -1;
  }
  const towns = [12 * columns + 5, 12 * columns + 34];
  const coordinates = new Map(
    [...rivers].map((i) => [i, { x: cells[i].x + 0.3, y: cells[i].y + 0.2 }]),
  );
  const result = generateRoadNetwork(
    cells,
    columns,
    rows,
    columns,
    rows,
    towns,
    rivers,
    4,
    coordinates,
  );
  assert.equal(result.routes.length, 1);
  assert(result.bridges.length > 0);
  assert(
    result.bridges.every(
      (b) => Number.isFinite(b.point.x) && Number.isFinite(b.point.y) && Number.isFinite(b.angle),
    ),
  );
  for (const bridge of result.bridges) {
    assert(
      [...coordinates.values()].some(
        (point) => point.x === bridge.point.x && point.y === bridge.point.y,
      ),
    );
    assert(
      result.paths.some((path) =>
        path.some((point) => point.x === bridge.point.x && point.y === bridge.point.y),
      ),
      'the visible road passes through the displayed river anchor',
    );
  }
  sampleSegments(result.paths[0], (p) =>
    assert(cells[Math.floor(p.y) * columns + Math.floor(p.x)]?.land),
  );
  for (const i of rivers) cells[i].accumulation = 100_000;
  assert.equal(
    generateRoadNetwork(cells, columns, rows, columns, rows, towns, rivers, 4).routes.length,
    0,
  );
  for (const i of rivers) cells[i].land = false;
  assert.equal(
    generateRoadNetwork(cells, columns, rows, columns, rows, towns, new Set(), 4).routes.length,
    0,
  );
});

test('raising sample resolution preserves widths for the same physical catchment area', () => {
  const maximumWidths = [128, 192, 384].map((resolution) => {
    const unit = 1000 / resolution;
    const cells = grid(resolution, resolution, (x, y) => ({
      x: (x + 0.5) * unit,
      y: (y + 0.5) * unit,
      land: y < resolution - 2,
      elevation: y < resolution - 2 ? ((resolution - y) / resolution) * 0.5 : -0.1,
    }));
    const column = Math.floor(resolution / 2);
    for (let y = 2; y < resolution - 2; y++) {
      const index = y * resolution + column;
      cells[index].downstream = index + resolution;
      cells[index].accumulation = (800 + (y / (resolution - 3)) * 18000) / (unit * unit);
    }
    const result = generateRiverNetwork(cells, resolution, resolution, 1000, 1000, 51);
    assert(result.channels.length > 0);
    return Math.max(
      ...result.channels
        .filter((channel) => channel.kind === 'river')
        .flatMap((channel) => channel.widths),
    );
  });
  assert(Math.max(...maximumWidths) - Math.min(...maximumWidths) < 1e-10);
});
