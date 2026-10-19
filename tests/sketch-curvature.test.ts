import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MapPoint } from '../shared/cartography';
import { softenRoute } from '../src/lib/sketch-curves';
import type { SketchCell } from '../src/lib/sketch-generation-v1';
import { generateRiverNetwork } from '../src/lib/sketch-networks';

const width = 1000;
const height = 700;
const scale = width / 128;

function polylineLength(points: MapPoint[]) {
  return points.slice(1).reduce((sum, point, i) => {
    return sum + Math.hypot(point.x - points[i].x, point.y - points[i].y);
  }, 0);
}

function span(points: MapPoint[]) {
  const start = points[0];
  const end = points.at(-1)!;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  const offsets = points.map((p) => ((p.x - start.x) * -dy + (p.y - start.y) * dx) / chord);
  return Math.max(...offsets) - Math.min(...offsets);
}

function maximumTurn(points: MapPoint[]) {
  let maximum = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const ax = points[i].x - points[i - 1].x;
    const ay = points[i].y - points[i - 1].y;
    const bx = points[i + 1].x - points[i].x;
    const by = points[i + 1].y - points[i].y;
    const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (denominator > 1e-8)
      maximum = Math.max(
        maximum,
        Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / denominator))),
      );
  }
  return maximum;
}

function straight(length: number, resolution = 288) {
  const count = Math.ceil(length / (width / resolution));
  return Array.from({ length: count + 1 }, (_, i) => ({
    x: 150 + (length * i) / count,
    y: 320,
  }));
}

test('short and medium routes bend visibly between fixed endpoints across map resolutions', () => {
  for (const kind of ['river', 'road'] as const) {
    for (const length of [120, 200, 320]) {
      for (const seed of [17, 187, 624]) {
        const spans = [192, 288, 384].map((resolution) => {
          const source = straight(length, resolution);
          const output = softenRoute(source, {
            scale,
            seed,
            kind,
            pinned: new Set(),
            allowed: () => true,
          });
          const context = `${kind}, length ${length}, seed ${seed}, resolution ${resolution}`;
          assert.deepEqual(output[0], source[0], context);
          assert.deepEqual(output.at(-1), source.at(-1), context);
          const transverse = span(output);
          assert(
            transverse >= Math.min(28, length * 0.1),
            `${context}: ${transverse.toFixed(2)} map units of bend is too small`,
          );
          const sinuosity = polylineLength(output) / length;
          assert(sinuosity >= 1.025, `${context}: the route remains almost straight`);
          assert(sinuosity <= 1.32, `${context}: the route folds into excessive coils`);
          assert(maximumTurn(output) < Math.PI / 4, `${context}: a bend introduces a sharp corner`);
          return transverse;
        });
        assert(
          Math.min(...spans) / Math.max(...spans) >= 0.8,
          `${kind}, length ${length}, seed ${seed}: curvature shrinks with sampling quality`,
        );
      }
    }
  }
});

test('confluence anchors preserve visible bends on both adjoining reaches', () => {
  const source = straight(360);
  const first = Math.round((source.length - 1) / 3);
  const second = Math.round(((source.length - 1) * 2) / 3);
  const pinned = new Set([first, second]);
  const output = softenRoute(source, {
    scale,
    seed: 187,
    kind: 'river',
    pinned,
    allowed: () => true,
    strength: () => 0.75,
  });
  for (const index of [0, first, second, source.length - 1])
    assert.deepEqual(output[index], source[index], 'junction coordinates must remain exact');
  const ends = [0, first, second, source.length - 1];
  for (let i = 1; i < ends.length; i++) {
    const reach = output.slice(ends[i - 1], ends[i] + 1);
    assert(span(reach) >= 9, 'a moderately sloped reach between junctions must still visibly bend');
  }
});

/** A broad downhill valley with genuine transverse relief and changing slope.
 * The channel starts as a D8 line; available floodplain is much wider than a sample cell.
 */
function valley(columns: number) {
  const rows = Math.round((columns * height) / width);
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const riverColumn = Math.floor(columns / 2);
  const mouthRow = Math.floor(rows * 0.91);
  const center = (riverColumn + 0.5) * cellWidth;
  const area = cellWidth * cellHeight;
  const cells = Array.from({ length: columns * rows }, (_, index): SketchCell => {
    const gridX = index % columns;
    const gridY = Math.floor(index / columns);
    const x = (gridX + 0.5) * cellWidth;
    const y = (gridY + 0.5) * cellHeight;
    const land = gridY < mouthRow;
    const elevation = land ? 0.3 - y * 0.00025 + ((x - center) / 180) ** 2 * 0.1 : -0.1;
    return {
      x,
      y,
      land,
      biome: 'grass',
      elevation,
      drainageElevation: elevation,
      downstream: -1,
      moisture: 0.6,
      slope: 0.025 + ((Math.sin(y / 65) + 1) / 2) * 0.045,
      accumulation: 1,
    };
  });
  for (let y = Math.floor(rows * 0.14); y < mouthRow; y++) {
    const index = y * columns + riverColumn;
    cells[index].downstream = index + columns;
    cells[index].accumulation = ((220 + (y / rows) * 1800) * scale ** 2) / area;
  }
  return { cells, columns, rows, mouth: mouthRow * columns + riverColumn };
}

test('sloping broad valleys retain map-scale meanders instead of collapsing to grid-scale offsets', () => {
  const spans = [192, 288, 384].map((resolution) => {
    const fixture = valley(resolution);
    const original = structuredClone(fixture.cells);
    const network = generateRiverNetwork(
      fixture.cells,
      fixture.columns,
      fixture.rows,
      width,
      height,
      931,
      true,
    );
    const channel = network.channels
      .filter((item) => item.kind === 'river')
      .sort((a, b) => polylineLength(b.points) - polylineLength(a.points))[0];
    assert(channel && polylineLength(channel.points) > 450);
    assert(
      span(channel.points) >= 24,
      'a wide lowland valley must show more than a few pixels of sway',
    );
    const start = channel.points[0];
    const end = channel.points.at(-1)!;
    assert(polylineLength(channel.points) / Math.hypot(end.x - start.x, end.y - start.y) >= 1.025);
    assert.deepEqual(end, {
      x: fixture.cells[fixture.mouth].x,
      y: fixture.cells[fixture.mouth].y,
    });
    assert.deepEqual(fixture.cells, original, 'display curves cannot mutate drainage or terrain');
    return span(channel.points);
  });
  assert(Math.min(...spans) / Math.max(...spans) >= 0.8);
});
