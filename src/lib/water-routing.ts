import type { MapPoint } from '../../shared/cartography';
import type { MapSurface } from '../../shared/map-surface';
import { isWaterPoint, isWaterSegment } from '../../shared/map-surface';
export { isWaterPoint, isWaterSegment } from '../../shared/map-surface';

const distance = (a: MapPoint, b: MapPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const interpolate = (a: MapPoint, b: MapPoint, t: number): MapPoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const WATER_CLEARANCE = -5;

class MinHeap {
  items: { id: number; score: number }[] = [];
  push(id: number, score: number) {
    let index = this.items.length;
    this.items.push({ id, score });
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].score <= score) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = { id, score };
  }
  pop() {
    const first = this.items[0],
      last = this.items.pop()!;
    if (this.items.length) {
      let index = 0;
      while (index * 2 + 1 < this.items.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.items.length && this.items[child + 1].score < this.items[child].score)
          child++;
        if (last.score <= this.items[child].score) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = last;
    }
    return first;
  }
}

/** Reusable raster routing over the same fine elevation that draws the land. */
export function createWaterRouter(surface: MapSurface) {
  const { columns, rows, width, height } = surface;
  const dx = width / columns,
    dy = height / rows,
    step = Math.min(dx, dy);
  const total = columns * rows;
  const water = Uint8Array.from({ length: total }, (_, id) =>
    surface.values[id] <= WATER_CLEARANCE ? 1 : 0,
  );
  const clear = new Uint16Array(total);
  clear.fill(65535);
  const queue = new Int32Array(total);
  let head = 0,
    tail = 0;
  for (let i = 0; i < total; i++)
    if (!water[i]) {
      clear[i] = 0;
      queue[tail++] = i;
    }
  while (head < tail) {
    const id = queue[head++],
      x = id % columns,
      y = Math.floor(id / columns);
    for (const [a, b] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (a < 0 || a >= columns || b < 0 || b >= rows) continue;
      const next = b * columns + a;
      if (clear[next] > clear[id] + 1) {
        clear[next] = clear[id] + 1;
        queue[tail++] = next;
      }
    }
  }
  const point = (id: number): MapPoint => ({
    x: ((id % columns) + 0.5) * dx,
    y: (Math.floor(id / columns) + 0.5) * dy,
  });
  const safe = (a: MapPoint, b: MapPoint) => isWaterSegment(surface, a, b, WATER_CLEARANCE);
  // The basin test must use the same navigable connections as A*. In
  // particular, two water samples touching diagonally across a land saddle do
  // not make an inland lake an ocean. All-water tiles need no extra sampling.
  const connectedWater = (id: number, next: number) => {
    const x = id % columns,
      y = Math.floor(id / columns),
      a = next % columns,
      b = Math.floor(next / columns);
    return (
      a === x ||
      b === y ||
      (water[y * columns + a] && water[b * columns + x]) ||
      safe(point(id), point(next))
    );
  };
  const component = new Int32Array(total);
  component.fill(-1);
  let componentId = 0;
  for (let start = 0; start < total; start++) {
    if (!water[start] || component[start] !== -1) continue;
    head = 0;
    tail = 1;
    queue[0] = start;
    component[start] = componentId;
    while (head < tail) {
      const id = queue[head++],
        x = id % columns,
        y = Math.floor(id / columns);
      for (let b = y - 1; b <= y + 1; b++)
        for (let a = x - 1; a <= x + 1; a++) {
          if (a < 0 || a >= columns || b < 0 || b >= rows) continue;
          const next = b * columns + a;
          if (water[next] && component[next] === -1 && connectedWater(id, next)) {
            component[next] = componentId;
            queue[tail++] = next;
          }
        }
    }
    componentId++;
  }
  const oceanBasins = new Set<number>();
  for (let i = 0; i < total; i++)
    if (
      component[i] >= 0 &&
      (i < columns || i >= total - columns || i % columns === 0 || i % columns === columns - 1)
    )
      oceanBasins.add(component[i]);
  const basinAt = (at: MapPoint) => {
    if (!isWaterPoint(surface, at, WATER_CLEARANCE)) return -1;
    const x = Math.max(0, Math.min(columns - 1, Math.floor(at.x / dx))),
      y = Math.max(0, Math.min(rows - 1, Math.floor(at.y / dy)));
    return component[y * columns + x];
  };
  const nearest = (
    at: MapPoint,
    range: number,
    preferClear = false,
    oceanOnly = false,
  ): number | undefined => {
    let best = Infinity,
      chosen: number | undefined;
    const left = Math.max(0, Math.floor((at.x - range) / dx)),
      right = Math.min(columns - 1, Math.floor((at.x + range) / dx));
    const top = Math.max(0, Math.floor((at.y - range) / dy)),
      bottom = Math.min(rows - 1, Math.floor((at.y + range) / dy));
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++) {
        const id = y * columns + x;
        if (!water[id] || (oceanOnly && !oceanBasins.has(component[id]))) continue;
        const d = distance(at, point(id));
        if (d > range) continue;
        const score = d + (preferClear && clear[id] < 2 ? step * 1.5 : 0);
        if (score < best) {
          best = score;
          chosen = id;
        }
      }
    return chosen;
  };
  const routeSafe = (points: MapPoint[]) =>
    points.every(
      (p, i) => isWaterPoint(surface, p, WATER_CLEARANCE) && (!i || safe(points[i - 1], p)),
    );
  const simplify = (points: MapPoint[]) => {
    if (safe(points[0], points[points.length - 1])) return [points[0], points[points.length - 1]];
    const result = [points[0]];
    let at = 0;
    while (at < points.length - 1) {
      let furthest = at + 1;
      for (let i = at + 2; i < Math.min(points.length, at + 90); i++) {
        if (!safe(points[at], points[i])) break;
        furthest = i;
      }
      result.push(points[furthest]);
      at = furthest;
    }
    return result;
  };
  const soften = (source: MapPoint[], seed: number): MapPoint[] => {
    if (source.length === 2) {
      const [a, b] = source,
        length = distance(a, b);
      const amplitude = Math.min(length * 0.07, step * 5) * (seed & 1 ? 1 : -1);
      const samples = Math.max(12, Math.ceil(length / (step * 0.7)));
      for (const scale of [1, 0.5, 0.25]) {
        const curve = Array.from({ length: samples + 1 }, (_, i) => {
          const t = i / samples,
            p = interpolate(a, b, t),
            wave = Math.sin(t * Math.PI) * amplitude * scale;
          return { x: p.x - ((b.y - a.y) / length) * wave, y: p.y + ((b.x - a.x) / length) * wave };
        });
        curve[0] = a;
        curve[curve.length - 1] = b;
        if (routeSafe(curve)) return curve;
      }
      return source;
    }
    const rounded = [source[0]];
    for (let i = 1; i < source.length - 1; i++) {
      const a = source[i - 1],
        corner = source[i],
        b = source[i + 1];
      let accepted: MapPoint[] | undefined;
      for (const amount of [0.28, 0.14, 0.07, 0.035]) {
        const enter = interpolate(corner, a, amount),
          exit = interpolate(corner, b, amount);
        const samples = Math.max(
          8,
          Math.ceil((distance(enter, corner) + distance(corner, exit)) / (step * 0.4)),
        );
        const curve = Array.from({ length: samples + 1 }, (_, j) => {
          const t = j / samples,
            u = 1 - t;
          return {
            x: u * u * enter.x + 2 * u * t * corner.x + t * t * exit.x,
            y: u * u * enter.y + 2 * u * t * corner.y + t * t * exit.y,
          };
        });
        if (routeSafe(curve)) {
          accepted = curve;
          break;
        }
      }
      rounded.push(...(accepted ?? [corner]));
    }
    rounded.push(source[source.length - 1]);
    let points = rounded;
    for (let iteration = 0; iteration < 2; iteration++) {
      const next = [points[0]];
      for (let i = 1; i < points.length; i++) {
        next.push(
          interpolate(points[i - 1], points[i], 0.25),
          interpolate(points[i - 1], points[i], 0.75),
        );
      }
      next.push(points[points.length - 1]);
      if (next.length > 1500 || !routeSafe(next)) break;
      points = next;
    }
    return points;
  };
  return {
    basinAt,
    isOcean: (at: MapPoint) => oceanBasins.has(basinAt(at)),
    findHarbor(at: MapPoint, range: number, oceanOnly = false): MapPoint | undefined {
      const id = nearest(at, range, true, oceanOnly);
      return id === undefined ? undefined : point(id);
    },
    route(from: MapPoint, to: MapPoint, seed = 1): MapPoint[] {
      if (
        !isWaterPoint(surface, from, WATER_CLEARANCE) ||
        !isWaterPoint(surface, to, WATER_CLEARANCE)
      )
        return [];
      if (distance(from, to) < 1e-6) return [];
      if (safe(from, to)) return soften([from, to], seed);
      const start = nearest(from, step * 2),
        end = nearest(to, step * 2);
      if (
        start === undefined ||
        end === undefined ||
        component[start] !== component[end] ||
        !safe(from, point(start)) ||
        !safe(to, point(end))
      )
        return [];
      const costs = new Float64Array(total);
      costs.fill(Infinity);
      costs[start] = 0;
      const previous = new Int32Array(total);
      previous.fill(-1);
      const closed = new Uint8Array(total),
        heap = new MinHeap();
      heap.push(start, distance(point(start), point(end)));
      while (heap.items.length) {
        const { id } = heap.pop();
        if (closed[id]) continue;
        if (id === end) {
          const ids = [end];
          while (ids[ids.length - 1] !== start) ids.push(previous[ids[ids.length - 1]]);
          const points = [from, ...ids.reverse().map(point), to].filter(
            (p, i, list) => !i || distance(p, list[i - 1]) > 1e-6,
          );
          const smooth = soften(simplify(points), seed);
          return smooth.length <= 1600 && routeSafe(smooth) ? smooth : [];
        }
        closed[id] = 1;
        const x = id % columns,
          y = Math.floor(id / columns);
        for (let b = y - 1; b <= y + 1; b++)
          for (let a = x - 1; a <= x + 1; a++) {
            if (a < 0 || a >= columns || b < 0 || b >= rows || (a === x && b === y)) continue;
            const next = b * columns + a;
            if (closed[next] || !water[next] || !safe(point(id), point(next))) continue;
            const length = Math.hypot((a - x) * dx, (b - y) * dy);
            const cost = costs[id] + length * (1 + 1.8 / Math.max(1, Math.min(clear[next], 8)));
            if (cost >= costs[next]) continue;
            costs[next] = cost;
            previous[next] = id;
            heap.push(next, cost + distance(point(next), point(end)));
          }
      }
      return [];
    },
  };
}
