import type { MapPoint } from '../../shared/cartography';
import type { SketchCell } from './sketch-generation-v1';
import { softenRoute } from './sketch-curves';

export interface RiverChannel {
  points: MapPoint[];
  /** Full channel width in map units, not a radius. */
  widths: number[];
  kind: 'river' | 'distributary';
}
export interface RiverNetwork {
  rivers: number[][];
  channels: RiverChannel[];
  riverCells: Set<number>;
  /** Rendered cell anchors shared with bridge placement; never stored in the map document. */
  coordinates: Map<number, MapPoint>;
  /** Visible river width/tangent at road crossing cells, populated for organic linework. */
  crossings?: Map<number, { width: number; tangent: MapPoint }>;
}
export interface RoadNetwork {
  routes: number[][];
  paths: MapPoint[][];
  /** Angle in degrees, measured along the road. */
  bridges: { point: MapPoint; angle: number }[];
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const directions = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;

class MinHeap {
  private values: { id: number; cost: number }[] = [];
  get length() {
    return this.values.length;
  }
  push(id: number, cost: number) {
    const item = { id, cost };
    let index = this.values.length;
    this.values.push(item);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      const other = this.values[parent];
      if (other.cost < cost || (other.cost === cost && other.id < id)) break;
      this.values[index] = other;
      index = parent;
    }
    this.values[index] = item;
  }
  pop() {
    const first = this.values[0],
      last = this.values.pop()!;
    if (this.values.length) {
      let index = 0;
      while (index * 2 + 1 < this.values.length) {
        let child = index * 2 + 1;
        const right = child + 1;
        if (
          right < this.values.length &&
          (this.values[right].cost < this.values[child].cost ||
            (this.values[right].cost === this.values[child].cost &&
              this.values[right].id < this.values[child].id))
        )
          child = right;
        const other = this.values[child];
        if (last.cost < other.cost || (last.cost === other.cost && last.id < other.id)) break;
        this.values[index] = other;
        index = child;
      }
      this.values[index] = last;
    }
    return first;
  }
}

function validGrid(cells: SketchCell[], columns: number, rows: number) {
  return (
    Number.isInteger(columns) &&
    Number.isInteger(rows) &&
    columns > 0 &&
    rows > 0 &&
    cells.length === columns * rows
  );
}
function eachNeighbor(
  index: number,
  columns: number,
  rows: number,
  callback: (id: number, distance: number) => void,
) {
  const x = index % columns,
    y = Math.floor(index / columns);
  for (const [dx, dy] of directions) {
    const nx = x + dx,
      ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < columns && ny < rows)
      callback(ny * columns + nx, dx && dy ? Math.SQRT2 : 1);
  }
}
function hash(x: number, y: number, seed: number) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, y: number, seed: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  let tx = x - ix,
    ty = y - iy;
  tx = tx * tx * (3 - 2 * tx);
  ty = ty * ty * (3 - 2 * ty);
  return (
    (hash(ix, iy, seed) * (1 - tx) + hash(ix + 1, iy, seed) * tx) * (1 - ty) +
    (hash(ix, iy + 1, seed) * (1 - tx) + hash(ix + 1, iy + 1, seed) * tx) * ty
  );
}

/** Fill depressions only on the routing surface. The authored elevation is never changed. */
export function buildDrainage(cells: SketchCell[], columns: number, rows: number): void {
  if (!validGrid(cells, columns, rows)) return;
  const seen = new Uint8Array(cells.length),
    heap = new MinHeap();
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i],
      x = i % columns,
      y = Math.floor(i / columns);
    cell.downstream = -1;
    cell.drainageElevation = Number.isFinite(cell.elevation) ? cell.elevation : 0;
    cell.accumulation = cell.land ? 1 : 0;
    if (!cell.land || x === 0 || y === 0 || x === columns - 1 || y === rows - 1) {
      seen[i] = 1;
      heap.push(i, cell.drainageElevation);
    }
  }
  while (heap.length) {
    const { id } = heap.pop();
    eachNeighbor(id, columns, rows, (next) => {
      if (seen[next]) return;
      seen[next] = 1;
      cells[next].drainageElevation = Math.max(
        cells[next].drainageElevation,
        cells[id].drainageElevation + 1e-7,
      );
      cells[next].downstream = id;
      heap.push(next, cells[next].drainageElevation);
    });
  }
  // Choose the steepest lower filled-surface neighbor. Strict descent makes cycles impossible.
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i].land) continue;
    let steepest = 0;
    eachNeighbor(i, columns, rows, (next, distance) => {
      const fall = (cells[i].drainageElevation - cells[next].drainageElevation) / distance;
      if (fall > steepest) {
        steepest = fall;
        cells[i].downstream = next;
      }
    });
  }
  const order = Array.from({ length: cells.length }, (_, i) => i).sort(
    (a, b) => cells[b].drainageElevation - cells[a].drainageElevation || b - a,
  );
  for (const i of order) {
    const next = cells[i].downstream;
    if (next >= 0) cells[next].accumulation += cells[i].accumulation;
  }
}

function geometry(
  cells: SketchCell[],
  columns: number,
  rows: number,
  width: number,
  height: number,
) {
  const cellWidth = width / columns,
    cellHeight = height / rows,
    unit = Math.min(cellWidth, cellHeight);
  const referenceUnit = Math.max(width, height) / 128;
  // Accumulation counts samples, not discharge: normalize their area before styling or thresholds.
  const catchmentScale = (cellWidth * cellHeight) / (referenceUnit * referenceUnit);
  const indexAt = (point: MapPoint) => {
    if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) return -1;
    return Math.floor(point.y / cellHeight) * columns + Math.floor(point.x / cellWidth);
  };
  const center = (i: number): MapPoint => ({ x: cells[i].x, y: cells[i].y });
  const segmentOkay = (a: MapPoint, b: MapPoint, allowed: (i: number) => boolean) => {
    const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (unit * 0.28)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps,
        index = indexAt({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      if (index < 0 || !allowed(index)) return false;
    }
    return true;
  };
  // Split at every grid boundary; fixed-distance sampling can miss a short corner crossing.
  const walkSegment = (
    a: MapPoint,
    b: MapPoint,
    visit: (index: number, start: number, end: number) => void,
  ) => {
    const cuts = [0, 1];
    for (const [axis, size] of [
      ['x', cellWidth],
      ['y', cellHeight],
    ] as const) {
      const delta = b[axis] - a[axis];
      if (Math.abs(delta) < 1e-10) continue;
      for (
        let grid = Math.ceil(Math.min(a[axis], b[axis]) / size);
        grid <= Math.floor(Math.max(a[axis], b[axis]) / size);
        grid++
      ) {
        const t = (grid * size - a[axis]) / delta;
        if (t > 0 && t < 1) cuts.push(t);
      }
    }
    cuts.sort((a, b) => a - b);
    const pointAt = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    visit(indexAt(a), 0, 0);
    for (let i = 1; i < cuts.length; i++) {
      if (cuts[i] - cuts[i - 1] > 1e-12)
        visit(indexAt(pointAt((cuts[i] + cuts[i - 1]) / 2)), cuts[i - 1], cuts[i]);
      visit(indexAt(pointAt(cuts[i])), cuts[i], cuts[i]);
    }
  };
  const segmentClear = (a: MapPoint, b: MapPoint, allowed: (i: number) => boolean) => {
    let clear = true;
    walkSegment(a, b, (index) => {
      if (index < 0 || !allowed(index)) clear = false;
    });
    return clear;
  };
  return {
    unit,
    referenceUnit,
    catchmentScale,
    indexAt,
    center,
    segmentOkay,
    walkSegment,
    segmentClear,
  };
}

const channelWidth = (accumulation: number) =>
  clamp(0.52 + Math.sqrt(Math.max(0, accumulation)) * 0.066, 0.6, 5);

/** Interpolating cubic midpoints retain every confluence/bridge anchor exactly. */
function roundedPath(
  points: MapPoint[],
  allowed: (a: MapPoint, b: MapPoint) => boolean,
): MapPoint[] {
  if (points.length < 3) return points.map((p) => ({ ...p }));
  const output: MapPoint[] = [{ ...points[0] }];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0, i - 1)],
      b = points[i],
      c = points[i + 1],
      d = points[Math.min(points.length - 1, i + 2)];
    const middle = {
      x: (-a.x + 9 * b.x + 9 * c.x - d.x) / 16,
      y: (-a.y + 9 * b.y + 9 * c.y - d.y) / 16,
    };
    output.push(
      allowed(b, middle) && allowed(middle, c)
        ? middle
        : { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 },
      { ...c },
    );
  }
  return output;
}

function chunks(path: number[], maximum = 850): number[][] {
  const output: number[][] = [];
  for (let start = 0; start < path.length - 1; start += maximum - 1)
    output.push(path.slice(start, start + maximum));
  return output;
}

/** A drainage tree becomes shared-coordinate main stems and tributaries, never independent painted lines. */
export function generateRiverNetwork(
  cells: SketchCell[],
  columns: number,
  rows: number,
  width: number,
  height: number,
  seed: number,
  organic = false,
  featureScale = 1,
  options: { widthScale?: number; maxChannels?: number } = {},
): RiverNetwork {
  const result: RiverNetwork = {
    rivers: [],
    channels: [],
    riverCells: new Set(),
    coordinates: new Map(),
  };
  if (!validGrid(cells, columns, rows) || width <= 0 || height <= 0) return result;
  const geo = geometry(cells, columns, rows, width, height);
  const landCount = cells.reduce((sum, c) => sum + Number(c.land), 0);
  const threshold =
    (Math.max(12, Math.sqrt(landCount * geo.catchmentScale) * 0.42) / geo.catchmentScale) *
    (featureScale * featureScale);
  const widthAt = (index: number) =>
    channelWidth(cells[index].accumulation * geo.catchmentScale) *
    featureScale *
    (options.widthScale ?? 1);
  const upstream: number[][] = Array.from({ length: cells.length }, () => []);
  const mouths: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell.land || cell.accumulation < threshold) continue;
    if (cell.downstream >= 0 && cells[cell.downstream]?.land) upstream[cell.downstream].push(i);
    else mouths.push(i);
  }
  for (const branches of upstream)
    branches.sort((a, b) => cells[b].accumulation - cells[a].accumulation || a - b);
  mouths.sort((a, b) => cells[b].accumulation - cells[a].accumulation || a - b);
  const queue: { tip: number; join: number }[] = mouths.map((tip) => ({
    tip,
    join: cells[tip].downstream,
  }));
  const fullPaths: number[][] = [];
  const expanded = new Set<number>();
  while (queue.length && fullPaths.length < (options.maxChannels ?? 96)) {
    const branch = queue.shift()!;
    const reverse = branch.join >= 0 ? [branch.join] : [];
    let at = branch.tip;
    const local = new Set<number>();
    while (at >= 0 && !local.has(at) && reverse.length < cells.length) {
      reverse.push(at);
      local.add(at);
      at = upstream[at]?.[0] ?? -1;
    }
    const path = reverse.reverse();
    if (path.length < 5) continue;
    fullPaths.push(path);
    path.forEach((i) => {
      if (cells[i].land) result.riverCells.add(i);
    });
    for (const i of path) {
      if (expanded.has(i)) continue;
      expanded.add(i);
      for (const child of upstream[i].slice(1)) queue.push({ tip: child, join: i });
    }
    // Prefer larger tributaries if the explicit rendering cap is reached.
    queue.sort((a, b) => cells[b.tip].accumulation - cells[a.tip].accumulation || a.tip - b.tip);
  }
  const coordinates = result.coordinates;
  for (const path of fullPaths)
    for (const i of path) {
      if (coordinates.has(i)) continue;
      const cell = cells[i],
        base = geo.center(i),
        child = upstream[i][0],
        next = cell.downstream;
      const a = child === undefined ? base : geo.center(child),
        b = next < 0 ? base : geo.center(next);
      const dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.hypot(dx, dy) || 1;
      const softness = clamp(1 - cell.slope * 16, 0, 1);
      const wave =
        Math.sin((base.x * 0.12 + base.y * 0.16) / geo.unit + (seed % 997)) * 0.55 +
        (noise(base.x / (geo.unit * 12), base.y / (geo.unit * 12), seed) - 0.5) * 1.15;
      let offset = clamp(wave * geo.unit * softness * 1.35, -geo.unit * 0.44, geo.unit * 0.44);
      let point = base;
      for (let attempt = 0; attempt < 4 && cell.land; attempt++, offset *= 0.5) {
        const candidate = {
          x: clamp(base.x - (dy / length) * offset, 0.001, width - 0.001),
          y: clamp(base.y + (dx / length) * offset, 0.001, height - 0.001),
        };
        const index = geo.indexAt(candidate);
        if (
          index === i &&
          cells[index].land &&
          geo.segmentOkay(base, candidate, (n) => cells[n].land)
        ) {
          point = candidate;
          break;
        }
      }
      coordinates.set(i, point);
    }
  // Relax a shared graph, not separate polylines, so every tributary still joins
  // the exact same point and bridges can reuse that point. Cell confinement keeps
  // the hydrology mask aligned with the visible water while removing D8 corners.
  for (let iteration = 0; iteration < 4; iteration++) {
    const changes = new Map<number, MapPoint>();
    for (const [i, point] of coordinates) {
      const children = upstream[i].filter((n) => coordinates.has(n));
      const next = cells[i].downstream;
      if (!cells[i].land || children.length !== 1 || !coordinates.has(next)) continue;
      const a = coordinates.get(children[0])!,
        b = coordinates.get(next)!;
      const candidate = { x: (a.x + point.x * 2 + b.x) / 4, y: (a.y + point.y * 2 + b.y) / 4 };
      if (geo.indexAt(candidate) !== i) continue;
      if (
        geo.segmentOkay(a, candidate, (n) => cells[n].land) &&
        geo.segmentOkay(candidate, b, (n) => cells[n].land || n === next)
      )
        changes.set(i, candidate);
    }
    for (const [i, point] of changes) coordinates.set(i, point);
  }
  const makeChannel = (
    path: number[],
    kind: RiverChannel['kind'],
    start?: MapPoint,
    scale = 1,
  ): RiverChannel => {
    const raw = path.map((i) => coordinates.get(i) ?? geo.center(i));
    if (start) raw[0] = start;
    const endpoint = path[path.length - 1];
    const points = roundedPath(raw, (a, b) =>
      geo.segmentOkay(a, b, (i) => cells[i].land || i === endpoint),
    );
    const baseWidths = path.map((i) => widthAt(i) * scale);
    if ((!cells[endpoint].land || upstream[endpoint].length > 1) && baseWidths.length > 1)
      baseWidths[baseWidths.length - 1] = baseWidths[baseWidths.length - 2];
    const widths: number[] = [];
    for (let i = 0; i < baseWidths.length; i++) {
      if (i > 0 && points.length > raw.length) widths.push((baseWidths[i - 1] + baseWidths[i]) / 2);
      widths.push(clamp(baseWidths[i], 0.6, 5));
    }
    return { points, widths, kind };
  };
  for (const path of fullPaths)
    for (const part of chunks(path)) {
      result.rivers.push(part);
      result.channels.push(makeChannel(part, 'river'));
    }

  // Only boundary-connected water is sea: an inland lake never receives a decorative delta.
  const sea = new Uint8Array(cells.length),
    coastDistance = new Int32Array(cells.length).fill(-1),
    waterQueue: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    const x = i % columns,
      y = Math.floor(i / columns);
    if (!cells[i].land && (x === 0 || y === 0 || x === columns - 1 || y === rows - 1)) {
      sea[i] = 1;
      waterQueue.push(i);
    }
  }
  for (let head = 0; head < waterQueue.length; head++)
    eachNeighbor(waterQueue[head], columns, rows, (next) => {
      if (!cells[next].land && !sea[next]) {
        sea[next] = 1;
        waterQueue.push(next);
      }
    });
  const coastQueue = [...waterQueue];
  for (const i of waterQueue) coastDistance[i] = 0;
  for (let head = 0; head < coastQueue.length; head++) {
    const at = coastQueue[head];
    if (coastDistance[at] >= 18) continue;
    eachNeighbor(at, columns, rows, (next) => {
      if (coastDistance[next] < 0 && cells[next].land) {
        coastDistance[next] = coastDistance[at] + 1;
        coastQueue.push(next);
      }
    });
  }
  let deltaCount = 0;
  for (const main of fullPaths) {
    if (deltaCount >= Math.max(1, Math.round(2 / featureScale))) break;
    const mouth = main[main.length - 1];
    if (
      !sea[mouth] ||
      main.length < 14 ||
      cells[main[main.length - 2]].accumulation < threshold * 5
    )
      continue;
    const start = main[Math.max(0, main.length - 11)];
    if (
      cells[start].elevation > 0.2 ||
      cells[start].slope > 0.045 ||
      coastDistance[start] < 4 ||
      coastDistance[start] > 14
    )
      continue;
    const distances = new Map<number, number>([[start, 0]]),
      previous = new Map<number, number>(),
      heap = new MinHeap();
    heap.push(start, 0);
    let end = -1,
      visited = 0;
    while (heap.length && visited++ < 1400) {
      const { id, cost } = heap.pop();
      if (cost !== distances.get(id)) continue;
      if (sea[id]) {
        if (
          Math.hypot(cells[id].x - cells[mouth].x, cells[id].y - cells[mouth].y) >=
          geo.unit * 4
        ) {
          end = id;
          break;
        }
        continue;
      }
      eachNeighbor(id, columns, rows, (next, step) => {
        if (
          next === start ||
          (result.riverCells.has(next) && next !== start) ||
          (!cells[next].land && !sea[next])
        )
          return;
        if (
          coastDistance[next] < 0 ||
          coastDistance[next] > coastDistance[id] ||
          cells[next].elevation > cells[id].elevation + 1e-6 ||
          cells[next].drainageElevation > cells[id].drainageElevation + 1e-6 ||
          cells[next].slope > 0.055
        )
          return;
        if (
          Math.hypot(cells[next].x - cells[start].x, cells[next].y - cells[start].y) >
          geo.unit * 22
        )
          return;
        const nextCost =
          cost +
          step *
            (1 +
              noise(cells[next].x / (geo.unit * 6), cells[next].y / (geo.unit * 6), seed ^ 617) *
                0.8);
        if (nextCost >= (distances.get(next) ?? Infinity)) return;
        distances.set(next, nextCost);
        previous.set(next, id);
        heap.push(next, nextCost);
      });
    }
    if (end < 0) continue;
    const path = [end];
    while (path[path.length - 1] !== start && path.length < 90)
      path.push(previous.get(path[path.length - 1])!);
    if (path[path.length - 1] !== start || path.length < 6) continue;
    path.reverse();
    for (const i of path) if (!coordinates.has(i)) coordinates.set(i, geo.center(i));
    const channel = makeChannel(path, 'distributary', coordinates.get(start), 0.6);
    const splitWidth = clamp(
      widthAt(start) * 0.58,
      0.6 * featureScale * (options.widthScale ?? 1),
      3 * featureScale * (options.widthScale ?? 1),
    );
    channel.widths = channel.points.map(
      (_, i) => splitWidth * (1 - (0.15 * i) / (channel.points.length - 1)),
    );
    result.channels.push(channel);
    for (const i of path) if (cells[i].land) result.riverCells.add(i);
    deltaCount++;
  }
  if (organic) curveRiverNetwork(result, cells, columns, rows, width, height, seed);
  return result;
}

function curveRiverNetwork(
  result: RiverNetwork,
  cells: SketchCell[],
  columns: number,
  rows: number,
  width: number,
  height: number,
  seed: number,
) {
  const geo = geometry(cells, columns, rows, width, height);
  const key = (p: MapPoint) => `${p.x}:${p.y}`;
  // Tributary ends and distributary starts also pin their matching point on the parent stem.
  const junctions = new Set(
    result.channels.flatMap((c) => [key(c.points[0]), key(c.points[c.points.length - 1])]),
  );
  result.channels = result.channels.map((channel) => {
    const source = channel.points.filter((_, i) => i % 2 === 0);
    const widths = channel.widths.filter((_, i) => i % 2 === 0);
    const end = geo.indexAt(source[source.length - 1]);
    const allowed = (a: MapPoint, b: MapPoint) =>
      geo.segmentClear(a, b, (i) => cells[i].land || i === end);
    const pinned = new Set(source.flatMap((p, i) => (junctions.has(key(p)) ? [i] : [])));
    const curved = softenRoute(source, {
      scale: geo.referenceUnit,
      seed,
      kind: 'river',
      pinned,
      allowed,
      // Gentle valley slopes must not erase map-scale bends. Steep channels
      // still narrow, and the elevation/land checks remain authoritative.
      strength: (i) =>
        clamp(1 - Math.max(0, (cells[geo.indexAt(source[i])]?.slope ?? 1) - 0.025) * 6, 0.18, 1),
      allowedPoint: (p, i) => {
        const cell = cells[geo.indexAt(p)],
          original = cells[geo.indexAt(source[i])];
        return !!cell && cell.land && cell.elevation <= original.elevation + 0.065;
      },
    });
    const points = roundedPath(curved, allowed);
    const blendedWidths = widths.flatMap((w, i) => (i ? [(widths[i - 1] + w) / 2, w] : [w]));
    return { ...channel, points, widths: blendedWidths };
  });
  // Roads and settlement placement must use the visible river, not the old D8 skeleton.
  result.riverCells.clear();
  result.coordinates.clear();
  const crossings = new Map<number, { width: number; tangent: MapPoint }>();
  result.crossings = crossings;
  const nearest = new Map<number, number>();
  for (const channel of result.channels) {
    for (let i = 1; i < channel.points.length; i++) {
      const a = channel.points[i - 1],
        b = channel.points[i];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const tangent = { x: (b.x - a.x) / (length || 1), y: (b.y - a.y) / (length || 1) };
      geo.walkSegment(a, b, (index, start, end) => {
        if (index < 0 || !cells[index].land) return;
        const cell = cells[index];
        const t = clamp(
          ((cell.x - a.x) * (b.x - a.x) + (cell.y - a.y) * (b.y - a.y)) / (length * length || 1),
          start,
          end,
        );
        const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        result.riverCells.add(index);
        const distance = Math.hypot(point.x - cells[index].x, point.y - cells[index].y);
        if (distance >= (nearest.get(index) ?? Infinity)) return;
        nearest.set(index, distance);
        result.coordinates.set(index, point);
        crossings.set(index, {
          width: channel.widths[i - 1] + (channel.widths[i] - channel.widths[i - 1]) * t,
          tangent,
        });
      });
    }
  }
}

/** Terrain-weighted routes keep their local turns; only checked land corridors are smoothed. */
export function generateRoadNetwork(
  cells: SketchCell[],
  columns: number,
  rows: number,
  width: number,
  height: number,
  settlements: number[],
  riverCells: Set<number>,
  seed: number,
  riverCoordinates?: ReadonlyMap<number, MapPoint>,
  organic = false,
  riverGeometry?: ReadonlyMap<number, { width: number; tangent: MapPoint }>,
  options: { extraConnections?: number } = {},
): RoadNetwork {
  const result: RoadNetwork = { routes: [], paths: [], bridges: [] };
  if (!validGrid(cells, columns, rows) || width <= 0 || height <= 0) return result;
  const geo = geometry(cells, columns, rows, width, height);
  const towns = [...new Set(settlements)].filter((i) => cells[i]?.land && !riverCells.has(i));
  if (towns.length < 2) return result;
  const passable = (i: number) =>
    i >= 0 && cells[i]?.land && cells[i].elevation < 0.86 && cells[i].slope < 0.24;
  // Prefer a little room beside the shore so curves do not hug a jagged water boundary.
  const shoreDistance = new Uint16Array(cells.length).fill(65535);
  if (organic) {
    const queue: number[] = [];
    for (let i = 0; i < cells.length; i++) {
      if (
        !cells[i].land ||
        i < columns ||
        i >= columns * (rows - 1) ||
        i % columns === 0 ||
        i % columns === columns - 1
      ) {
        shoreDistance[i] = 0;
        queue.push(i);
      }
    }
    const maximum = Math.ceil((geo.referenceUnit * 3) / geo.unit);
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head];
      if (shoreDistance[at] >= maximum) continue;
      eachNeighbor(at, columns, rows, (next) => {
        if (shoreDistance[next] <= shoreDistance[at] + 1) return;
        shoreDistance[next] = shoreDistance[at] + 1;
        queue.push(next);
      });
    }
  }
  const terrainCost = new Float64Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    terrainCost[i] =
      1 +
      cell.slope * 36 +
      cell.elevation ** 2 * 7 +
      (organic
        ? Math.max(0, 1 - (shoreDistance[i] * geo.unit) / (geo.referenceUnit * 3)) ** 2 * 4.8
        : 0) +
      noise(cell.x / (geo.referenceUnit * 11), cell.y / (geo.referenceUnit * 11), seed ^ 419) *
        3.2 +
      (cell.biome === 'swamp'
        ? 3
        : ['forest', 'taiga', 'rainforest'].includes(cell.biome)
          ? 0.6
          : 0);
  }
  const linked = new Set<number>(),
    remaining = new Set(towns);
  const usedBridges = new Set<number>();
  const sharedRoadPoints = new Map<number, MapPoint>();
  const roadAnchor = (i: number) =>
    riverCells.has(i)
      ? (riverCoordinates?.get(i) ?? geo.center(i))
      : (sharedRoadPoints.get(i) ?? geo.center(i));
  const findRoute = (sources: ReadonlySet<number>, targets: ReadonlySet<number>): number[] => {
    const heap = new MinHeap(),
      costs = new Float64Array(cells.length).fill(Infinity),
      previous = new Int32Array(cells.length).fill(-1);
    for (const source of sources) {
      costs[source] = 0;
      heap.push(source, 0);
    }
    let destination = -1;
    while (heap.length) {
      const { id, cost } = heap.pop();
      if (cost !== costs[id]) continue;
      if (targets.has(id)) {
        destination = id;
        break;
      }
      const x = id % columns,
        y = Math.floor(id / columns);
      for (const [dx, dy] of directions) {
        let nx = x + dx,
          ny = y + dy,
          stepCount = 1,
          crossing = 0;
        if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
        let next = ny * columns + nx;
        if (!passable(next)) continue;
        if (dx && dy && (!passable(y * columns + nx) || !passable(ny * columns + x))) continue;
        // A bridge is one straight graph edge over at most two narrow river cells.
        // River cells themselves are not graph nodes, preventing roads running along a river.
        while (riverCells.has(next) && crossing < 3) {
          if (
            (riverGeometry?.get(next)?.width ??
              channelWidth(cells[next].accumulation * geo.catchmentScale)) > 3.2
          ) {
            crossing = 3;
            break;
          }
          const down = cells[next].downstream;
          if (down >= 0 || riverGeometry?.has(next)) {
            const rx = riverGeometry?.get(next)?.tangent.x ?? cells[down].x - cells[next].x,
              ry = riverGeometry?.get(next)?.tangent.y ?? cells[down].y - cells[next].y;
            const alignment = Math.abs(
              (rx * dx + ry * dy) / ((Math.hypot(rx, ry) || 1) * Math.hypot(dx, dy)),
            );
            if (alignment > 0.82) {
              crossing = 3;
              break;
            }
          }
          crossing++;
          stepCount++;
          nx += dx;
          ny += dy;
          if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) break;
          next = ny * columns + nx;
          if (!passable(next)) break;
        }
        if (
          crossing >= 3 ||
          nx < 0 ||
          ny < 0 ||
          nx >= columns ||
          ny >= rows ||
          !passable(next) ||
          riverCells.has(next)
        )
          continue;
        if (!geo.segmentOkay(geo.center(id), geo.center(next), passable)) continue;
        if (
          organic &&
          !geo.segmentClear(
            geo.center(id),
            geo.center(next),
            (i) => passable(i) && (crossing > 0 || !riverCells.has(i)),
          )
        )
          continue;
        const distance = stepCount * (dx && dy ? Math.SQRT2 : 1);
        const nextCost =
          cost + (distance * (terrainCost[id] + terrainCost[next])) / 2 + crossing * 14;
        if (nextCost >= costs[next]) continue;
        costs[next] = nextCost;
        previous[next] = id;
        heap.push(next, nextCost);
      }
    }
    if (destination < 0) return [];
    const reverse = [destination];
    let cursor = destination;
    while (previous[cursor] >= 0 && reverse.length <= cells.length) {
      const parent = previous[cursor],
        dx = Math.sign((parent % columns) - (cursor % columns)),
        dy = Math.sign(Math.floor(parent / columns) - Math.floor(cursor / columns));
      while (cursor !== parent) {
        cursor += dy * columns + dx;
        reverse.push(cursor);
      }
    }
    const route = reverse.reverse();
    return route;
  };
  const usedEdges = new Set<string>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const connectedPairs = new Set<string>();
  const appendRoute = (route: number[]) => {
    connectedPairs.add(edgeKey(route[0], route.at(-1)!));
    for (let i = 1; i < route.length; i++) usedEdges.add(edgeKey(route[i - 1], route[i]));
    for (const i of route) terrainCost[i] *= 0.72; // Subsequent connections can share existing local roads.
    const pinned = new Set<number>([route[0], route[route.length - 1]]);
    if (organic) for (const i of route) if (sharedRoadPoints.has(i)) pinned.add(i);
    for (let i = 1; i < route.length - 1; i++)
      if (riverCells.has(route[i])) {
        pinned.add(route[i - 1]);
        pinned.add(route[i]);
        pinned.add(route[i + 1]);
        if (!usedBridges.has(route[i])) {
          const a = roadAnchor(route[i - 1]),
            b = roadAnchor(route[i + 1]);
          result.bridges.push({
            point: roadAnchor(route[i]),
            angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
          });
          usedBridges.add(route[i]);
        }
      }
    const allowed = (i: number) => passable(i) && (!riverCells.has(i) || pinned.has(i));
    let points = route.map(roadAnchor);
    if (organic) {
      points = softenRoute(points, {
        scale: geo.referenceUnit,
        seed: seed ^ 919,
        kind: 'road',
        pinned: new Set(route.flatMap((i, index) => (pinned.has(i) ? [index] : []))),
        allowed: (a, b) => geo.segmentClear(a, b, allowed),
      });
      route.forEach((i, index) => sharedRoadPoints.set(i, points[index]));
    } else
      for (let iteration = 0; iteration < 2; iteration++)
        points = points.map((point, i) => {
          if (!i || i === points.length - 1 || pinned.has(route[i])) return point;
          const candidate = {
            x: (points[i - 1].x + point.x * 2 + points[i + 1].x) / 4,
            y: (points[i - 1].y + point.y * 2 + points[i + 1].y) / 4,
          };
          return geo.segmentOkay(points[i - 1], candidate, allowed) &&
            geo.segmentOkay(candidate, points[i + 1], allowed)
            ? candidate
            : point;
        });
    for (let start = 0; start < route.length - 1; start += 849) {
      result.routes.push(route.slice(start, start + 850));
      result.paths.push(
        roundedPath(points.slice(start, start + 850), (a, b) =>
          organic ? geo.segmentClear(a, b, allowed) : geo.segmentOkay(a, b, allowed),
        ),
      );
    }
  };
  while (remaining.size) {
    if (!linked.size) {
      const first = remaining.values().next().value!;
      linked.add(first);
      remaining.delete(first);
    }
    if (!remaining.size) break;
    const route = findRoute(linked, remaining);
    if (!route.length) {
      linked.clear();
      continue;
    } // Start the next disconnected island.
    linked.add(route.at(-1)!);
    remaining.delete(route.at(-1)!);
    appendRoute(route);
  }
  // Wide-coverage maps show regional alternatives as well as the connected
  // trunk. Every extra link uses the same terrain/bridge search and curvature;
  // a link must add a real corridor, rather than repainting an existing road.
  const pairs = towns
    .flatMap((a, i) =>
      towns.slice(i + 1).map((b) => ({
        a,
        b,
        distance: Math.hypot(cells[a].x - cells[b].x, cells[a].y - cells[b].y),
      })),
    )
    .sort((a, b) => a.distance - b.distance || a.a - b.a || a.b - b.b);
  const limit = Math.max(0, Math.min(24, Math.round(options.extraConnections ?? 0)));
  let extra = 0;
  for (const { a, b } of pairs) {
    if (extra >= limit) break;
    if (connectedPairs.has(edgeKey(a, b))) continue;
    const route = findRoute(new Set([a]), new Set([b]));
    if (route.length < 2) continue;
    const novel = route.slice(1).filter((n, i) => !usedEdges.has(edgeKey(route[i], n))).length;
    if (novel < Math.max(3, (route.length - 1) * 0.12)) continue;
    appendRoute(route);
    extra++;
  }
  return result;
}
