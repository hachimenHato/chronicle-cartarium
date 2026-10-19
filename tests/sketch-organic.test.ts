import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MapPoint } from '../shared/cartography';
import type { SketchCell } from '../src/lib/sketch-generation-v1';
import { generateRiverNetwork, generateRoadNetwork } from '../src/lib/sketch-networks';
import { distanceToSegment } from '../src/lib/terrain';

const width = 1000;
const height = 750;
const referenceUnit = width / 128;

function plain(columns = 128, rows = 96) {
  const cells = Array.from({ length: columns * rows }, (_, i): SketchCell => {
    const x = i % columns;
    const y = Math.floor(i / columns);
    return {
      x: ((x + 0.5) * width) / columns,
      y: ((y + 0.5) * height) / rows,
      land: true,
      biome: 'grass',
      elevation: 0.24 - (y / rows) * 0.1,
      drainageElevation: 0.24 - (y / rows) * 0.1,
      downstream: -1,
      moisture: 0.5,
      slope: 0.002,
      accumulation: 1,
    };
  });
  return { columns, rows, cells };
}

function straightRiver(columns = 128, tributary = false) {
  const rows = Math.round(columns * 0.75);
  const fixture = plain(columns, rows);
  const { cells } = fixture;
  const seaRow = Math.floor(rows * 0.94);
  const riverColumn = Math.floor(columns / 2);
  const unitArea = (width / columns) * (height / rows);
  for (let y = seaRow; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const cell = cells[y * columns + x];
      cell.land = false;
      cell.elevation = cell.drainageElevation = -0.1;
    }
  for (let y = Math.floor(rows * 0.1); y < seaRow; y++) {
    const i = y * columns + riverColumn;
    cells[i].downstream = i + columns;
    cells[i].accumulation = ((220 + (y / rows) * 1800) * referenceUnit ** 2) / unitArea;
  }
  if (tributary) {
    const joinRow = Math.floor(rows * 0.62);
    const length = Math.floor(columns * 0.2);
    for (let offset = length; offset > 0; offset--) {
      const i = (joinRow - offset) * columns + riverColumn - offset;
      cells[i].downstream = i + columns + 1;
      cells[i].accumulation = ((110 + (length - offset) * 5) * referenceUnit ** 2) / unitArea;
    }
  }
  return { ...fixture, mouth: seaRow * columns + riverColumn };
}

function length(points: MapPoint[]) {
  return points
    .slice(1)
    .reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
}

function transverseSpan(points: MapPoint[]) {
  const start = points[0];
  const end = points.at(-1)!;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  const offsets = points.map((p) => ((p.x - start.x) * -dy + (p.y - start.y) * dx) / chord);
  return Math.max(...offsets) - Math.min(...offsets);
}

function turnPercentile(points: MapPoint[], quantile: number) {
  const turns: number[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const ax = points[i].x - points[i - 1].x;
    const ay = points[i].y - points[i - 1].y;
    const bx = points[i + 1].x - points[i].x;
    const by = points[i + 1].y - points[i].y;
    const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (denominator > 1e-8)
      turns.push(Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / denominator))));
  }
  turns.sort((a, b) => a - b);
  return turns[Math.floor((turns.length - 1) * quantile)] ?? 0;
}

function samples(points: MapPoint[], step: number, assertion: (point: MapPoint) => void) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let j = 0; j <= count; j++)
      assertion({ x: a.x + ((b.x - a.x) * j) / count, y: a.y + ((b.y - a.y) * j) / count });
  }
}

function atPoint(fixture: ReturnType<typeof plain>, point: MapPoint) {
  const x = Math.floor((point.x / width) * fixture.columns);
  const y = Math.floor((point.y / height) * fixture.rows);
  if (x < 0 || y < 0 || x >= fixture.columns || y >= fixture.rows) return undefined;
  return fixture.cells[y * fixture.columns + x];
}

test('organic plain rivers have map-scale bends at both high and ultra resolution without jagged noise', () => {
  const spans = [288, 384].map((columns) => {
    const fixture = straightRiver(columns);
    const network = generateRiverNetwork(
      fixture.cells,
      fixture.columns,
      fixture.rows,
      width,
      height,
      187,
      true,
    );
    const main = network.channels
      .filter((channel) => channel.kind === 'river')
      .sort((a, b) => length(b.points) - length(a.points))[0];
    assert(main && length(main.points) > height * 0.7);
    const span = transverseSpan(main.points);
    assert(
      span > referenceUnit * 0.9,
      'a long straight lowland river bends visibly in physical map units',
    );
    assert(
      turnPercentile(main.points, 0.95) < Math.PI / 6,
      'curvature is gradual rather than a high-frequency sawtooth',
    );
    assert(turnPercentile(main.points, 1) < Math.PI / 2, 'no sharp reversals appear at the ends');
    assert(
      length(main.points) < height * 1.3,
      'meanders do not turn a direct catchment into decorative coils',
    );
    return span;
  });
  assert(
    Math.min(...spans) / Math.max(...spans) > 0.65,
    'raising precision does not shrink the visible bends with the grid',
  );
});

test('organic river geometry keeps shared confluences and sea outlets, stays on land, and is reproducible', () => {
  const fixture = straightRiver(128, true);
  const original = structuredClone(fixture.cells);
  const generate = () =>
    generateRiverNetwork(fixture.cells, fixture.columns, fixture.rows, width, height, 931, true);
  const network = generate();
  const channels = network.channels.filter((channel) => channel.kind === 'river');
  assert(channels.length >= 2, 'the fixture includes a main stem and tributary');
  const mouth = fixture.cells[fixture.mouth];
  assert(
    channels.some(
      (channel) => channel.points.at(-1)!.x === mouth.x && channel.points.at(-1)!.y === mouth.y,
    ),
    'the sea outlet remains at the routing mouth',
  );
  assert(
    channels.some((channel) =>
      channels.some(
        (parent) =>
          parent !== channel &&
          parent.points.some(
            (point) => point.x === channel.points.at(-1)!.x && point.y === channel.points.at(-1)!.y,
          ),
      ),
    ),
    'tributaries meet an exact point on the displayed main stem',
  );
  const unit = width / fixture.columns;
  for (const channel of channels) {
    assert.equal(channel.points.length, channel.widths.length);
    samples(channel.points, unit / 5, (point) => {
      const cell = atPoint(fixture, point);
      assert(cell, 'all displayed samples remain within the canvas');
      assert(
        cell.land || Math.hypot(point.x - mouth.x, point.y - mouth.y) <= unit * 1.5,
        'a meander only enters water at the actual river mouth',
      );
    });
  }
  assert.deepEqual(
    fixture.cells,
    original,
    'display curvature cannot rewrite the drainage topology or terrain',
  );
  assert.deepEqual(network, generate(), 'the same source and seed produce identical curves');
});

test('organic roads between level settlements visibly curve without moving towns or adding sharp corners', () => {
  const fixture = plain();
  const { cells, columns, rows } = fixture;
  const towns = [48 * columns + 8, 48 * columns + 119];
  const original = structuredClone(cells);
  const generate = () =>
    generateRoadNetwork(
      cells,
      columns,
      rows,
      width,
      height,
      towns,
      new Set(),
      624,
      undefined,
      true,
    );
  const network = generate();
  assert.equal(network.paths.length, 1);
  const path = network.paths[0];
  assert.deepEqual(path[0], { x: cells[towns[0]].x, y: cells[towns[0]].y });
  assert.deepEqual(path.at(-1), { x: cells[towns[1]].x, y: cells[towns[1]].y });
  assert(
    transverseSpan(path) > referenceUnit * 0.9,
    'a level road is not rendered as one long straight connection',
  );
  assert(
    turnPercentile(path, 0.95) < Math.PI / 6,
    'curves do not merely replace long straight lines with zigzags',
  );
  samples(path, width / columns / 5, (point) => assert(atPoint(fixture, point)?.land));
  assert.deepEqual(cells, original);
  assert.deepEqual(network, generate());
});

test('organic road smoothing respects lake shores and impassable slopes', () => {
  const fixture = plain();
  const { cells, columns, rows } = fixture;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const cell = cells[y * columns + x];
      if (((x - 64) / 18) ** 2 + ((y - 48) / 16) ** 2 < 1) cell.land = false;
      if (x > 48 && x < 76 && y > 61 && y < 70) cell.slope = 0.4;
    }
  const towns = [48 * columns + 8, 48 * columns + 119];
  const network = generateRoadNetwork(
    cells,
    columns,
    rows,
    width,
    height,
    towns,
    new Set(),
    437,
    undefined,
    true,
  );
  assert.equal(network.paths.length, 1);
  samples(network.paths[0], width / columns / 5, (point) => {
    const cell = atPoint(fixture, point);
    assert(cell?.land && cell.slope < 0.24, 'every smoothed segment remains on passable land');
  });
});

test('omitting organic curves preserves the previously published network geometry', () => {
  const fixture = straightRiver();
  const { cells, columns, rows } = fixture;
  assert.deepEqual(
    generateRiverNetwork(cells, columns, rows, width, height, 622),
    generateRiverNetwork(cells, columns, rows, width, height, 622, false),
  );
  const towns = [48 * columns + 8, 48 * columns + 119];
  assert.deepEqual(
    generateRoadNetwork(cells, columns, rows, width, height, towns, new Set(), 622),
    generateRoadNetwork(
      cells,
      columns,
      rows,
      width,
      height,
      towns,
      new Set(),
      622,
      undefined,
      false,
    ),
  );
});

test('roads bridge the displayed curved river instead of its old straight drainage cells', () => {
  const { cells, columns, rows } = straightRiver(288);
  const river = generateRiverNetwork(cells, columns, rows, width, height, 931, true);
  const towns = [
    Math.floor(rows / 2) * columns + 20,
    Math.floor(rows / 2) * columns + columns - 20,
  ];
  const roads = generateRoadNetwork(
    cells,
    columns,
    rows,
    width,
    height,
    towns,
    river.riverCells,
    735,
    river.coordinates,
    true,
    river.crossings,
  );
  assert.equal(roads.paths.length, 1);
  assert(roads.bridges.length > 0);
  for (const bridge of roads.bridges) {
    assert(
      roads.paths.some((path) =>
        path.some((p) => p.x === bridge.point.x && p.y === bridge.point.y),
      ),
    );
    assert(
      river.channels.some((channel) =>
        channel.points.some(
          (p, i) => i > 0 && distanceToSegment(bridge.point, channel.points[i - 1], p) < 1e-7,
        ),
      ),
      'a bridge crosses the actual displayed channel',
    );
  }
  for (const channel of river.channels)
    samples(channel.points, width / columns / 8, (point) => {
      const index =
        Math.floor((point.y / height) * rows) * columns + Math.floor((point.x / width) * columns);
      if (cells[index]?.land)
        assert(river.riverCells.has(index), 'visible water is represented in the routing mask');
    });
});
