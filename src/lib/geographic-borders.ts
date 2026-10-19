import type { MapPoint } from '../../shared/cartography';
import type { GeneratedGeography, GeographicBorder } from '../../shared/geography';
import { pointInPolygon } from './terrain';

export interface CartographicBorder {
  id: string;
  kind: GeographicBorder['kind'];
  points: MapPoint[];
  motion?: GeographicBorder['motion'];
}
interface BorderChain extends CartographicBorder {
  openStart: boolean;
  openEnd: boolean;
}
const key = (p: MapPoint) => `${p.x.toFixed(2)}:${p.y.toFixed(2)}`;
const distance = (a: MapPoint, b: MapPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const interpolate = (a: MapPoint, b: MapPoint, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Trace complete boundaries; stop at junctions instead of guessing a branch. */
export function mergeGeographicBorders(borders: GeographicBorder[]): BorderChain[] {
  const groups = new Map<string, GeographicBorder[]>();
  for (const border of borders) {
    const group = `${border.kind}:${border.motion ?? ''}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(border);
  }
  const chains: BorderChain[] = [];
  for (const edges of groups.values()) {
    const adjacency = new Map<string, { index: number; reverse: boolean }[]>();
    edges.forEach((edge, index) => {
      for (const [point, reverse] of [
        [edge.points[0], false],
        [edge.points[edge.points.length - 1], true],
      ] as const) {
        const id = key(point);
        if (!adjacency.has(id)) adjacency.set(id, []);
        adjacency.get(id)!.push({ index, reverse });
      }
    });
    const seen = new Set<number>();
    const trace = (index: number, reverse: boolean) => {
      const first = edges[index],
        points: MapPoint[] = [],
        start = key(reverse ? first.points[first.points.length - 1] : first.points[0]);
      let end = start;
      while (!seen.has(index)) {
        seen.add(index);
        const edge = edges[index],
          samples = reverse ? [...edge.points].reverse() : edge.points;
        points.push(...(points.length ? samples.slice(1) : samples));
        end = key(points[points.length - 1]);
        const outgoing = adjacency.get(end)!;
        if (outgoing.length !== 2) break;
        const next = outgoing.find((entry) => !seen.has(entry.index));
        if (!next) break;
        index = next.index;
        reverse = next.reverse;
      }
      if (points.length >= 2)
        chains.push({
          id: `chain_${first.id}`,
          kind: first.kind,
          motion: first.motion,
          points,
          openStart: adjacency.get(start)!.length === 1,
          openEnd: adjacency.get(end)!.length === 1,
        });
    };
    for (const outgoing of adjacency.values())
      if (outgoing.length !== 2)
        for (const entry of outgoing) if (!seen.has(entry.index)) trace(entry.index, entry.reverse);
    edges.forEach((_edge, index) => {
      if (!seen.has(index)) trace(index, false);
    });
  }
  return chains;
}

export interface BorderSurface {
  /** Independent real coast rings, including holes/lakes; not coarse region polygons. */
  coastline?: MapPoint[][];
  elevation?: {
    columns: number;
    rows: number;
    width: number;
    height: number;
    values: ArrayLike<number>;
  };
}

function surfaceGeometry(g: GeneratedGeography, surface: BorderSurface) {
  const rings = (surface.coastline ?? [])
    .filter((ring) => ring.length >= 3)
    .map((points) => ({
      points,
      minX: Math.min(...points.map((p) => p.x)),
      maxX: Math.max(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)),
      maxY: Math.max(...points.map((p) => p.y)),
    }));
  type Edge = { a: MapPoint; b: MapPoint };
  const step = Math.max(g.width, g.height) / 64,
    buckets = new Map<string, Edge[]>();
  for (const ring of rings)
    for (let i = 0; i < ring.points.length; i++) {
      const edge = { a: ring.points[i], b: ring.points[(i + 1) % ring.points.length] };
      for (
        let x = Math.floor(Math.min(edge.a.x, edge.b.x) / step);
        x <= Math.floor(Math.max(edge.a.x, edge.b.x) / step);
        x++
      )
        for (
          let y = Math.floor(Math.min(edge.a.y, edge.b.y) / step);
          y <= Math.floor(Math.max(edge.a.y, edge.b.y) / step);
          y++
        ) {
          const id = `${x}:${y}`;
          if (!buckets.has(id)) buckets.set(id, []);
          buckets.get(id)!.push(edge);
        }
    }
  const nearby = (a: MapPoint, b: MapPoint, radius = 0) => {
    const found = new Set<Edge>();
    for (
      let x = Math.floor((Math.min(a.x, b.x) - radius) / step);
      x <= Math.floor((Math.max(a.x, b.x) + radius) / step);
      x++
    )
      for (
        let y = Math.floor((Math.min(a.y, b.y) - radius) / step);
        y <= Math.floor((Math.max(a.y, b.y) + radius) / step);
        y++
      )
        for (const edge of buckets.get(`${x}:${y}`) ?? []) found.add(edge);
    return found;
  };
  const heightAt = (p: MapPoint) => {
    const grid = surface.elevation;
    if (!grid) return 1;
    const x = Math.max(0, Math.min(grid.columns - 1, (p.x / grid.width) * grid.columns - 0.5)),
      y = Math.max(0, Math.min(grid.rows - 1, (p.y / grid.height) * grid.rows - 0.5)),
      col = Math.floor(x),
      row = Math.floor(y),
      tx = x - col,
      ty = y - row,
      at = (dx: number, dy: number) =>
        grid.values[
          Math.min(grid.rows - 1, row + dy) * grid.columns + Math.min(grid.columns - 1, col + dx)
        ];
    return (
      (at(0, 0) * (1 - tx) + at(1, 0) * tx) * (1 - ty) + (at(0, 1) * (1 - tx) + at(1, 1) * tx) * ty
    );
  };
  const land = (p: MapPoint) =>
    rings.length
      ? rings.filter(
          (r) =>
            p.x >= r.minX &&
            p.x <= r.maxX &&
            p.y >= r.minY &&
            p.y <= r.maxY &&
            pointInPolygon(p, r.points),
        ).length %
          2 ===
        1
      : heightAt(p) >= 0;
  const cuts = (a: MapPoint, b: MapPoint) => {
    const result: number[] = [],
      dx = b.x - a.x,
      dy = b.y - a.y;
    for (const edge of nearby(a, b)) {
      const ex = edge.b.x - edge.a.x,
        ey = edge.b.y - edge.a.y,
        denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) < 1e-9) continue;
      const ox = edge.a.x - a.x,
        oy = edge.a.y - a.y,
        t = (ox * ey - oy * ex) / denominator,
        u = (ox * dy - oy * dx) / denominator;
      if (t > 1e-8 && t < 1 - 1e-8 && u >= -1e-8 && u <= 1 + 1e-8) result.push(t);
    }
    if (!rings.length && surface.elevation) {
      const grid = surface.elevation,
        count = Math.max(
          2,
          Math.ceil(
            (distance(a, b) / Math.min(grid.width / grid.columns, grid.height / grid.rows)) * 2,
          ),
        );
      let previous = heightAt(a);
      for (let i = 1; i <= count; i++) {
        const current = heightAt(interpolate(a, b, i / count));
        if (previous >= 0 !== current >= 0) {
          let low = (i - 1) / count,
            high = i / count;
          for (let j = 0; j < 14; j++) {
            const middle = (low + high) / 2;
            if (heightAt(interpolate(a, b, middle)) >= 0 === previous >= 0) low = middle;
            else high = middle;
          }
          result.push((low + high) / 2);
        }
        previous = current;
      }
    }
    return [...new Set(result)].sort((a, b) => a - b);
  };
  const coastNear = (point: MapPoint, previous: MapPoint, maximum: number) => {
    const length = distance(point, previous) || 1,
      ray = {
        x: Math.max(0, Math.min(g.width, point.x + ((point.x - previous.x) / length) * maximum)),
        y: Math.max(0, Math.min(g.height, point.y + ((point.y - previous.y) / length) * maximum)),
      },
      crossing = cuts(point, ray)[0];
    if (crossing !== undefined) return interpolate(point, ray, crossing);
    let best: MapPoint | undefined,
      nearest = maximum;
    for (const { a, b } of nearby(point, point, maximum)) {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        t = Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
        ),
        candidate = interpolate(a, b, t),
        d = distance(point, candidate);
      if (d < nearest) {
        nearest = d;
        best = candidate;
      }
    }
    // Persisted elevation is sufficient when artwork coast rings are unavailable.
    // A tangent ray can miss a nearby shore, so search local zero crossings as well.
    if (!rings.length && surface.elevation) {
      const grid = surface.elevation,
        cellWidth = grid.width / grid.columns,
        cellHeight = grid.height / grid.rows,
        minCol = Math.max(0, Math.floor((point.x - maximum) / cellWidth - 0.5)),
        maxCol = Math.min(grid.columns - 1, Math.ceil((point.x + maximum) / cellWidth - 0.5)),
        minRow = Math.max(0, Math.floor((point.y - maximum) / cellHeight - 0.5)),
        maxRow = Math.min(grid.rows - 1, Math.ceil((point.y + maximum) / cellHeight - 0.5));
      const sample = (col: number, row: number) => ({
        x: (col + 0.5) * cellWidth,
        y: (row + 0.5) * cellHeight,
      });
      for (let row = minRow; row <= maxRow; row++)
        for (let col = minCol; col <= maxCol; col++) {
          const a = sample(col, row),
            ha = grid.values[row * grid.columns + col];
          for (const [dx, dy] of [
            [1, 0],
            [0, 1],
          ]) {
            if (col + dx >= grid.columns || row + dy >= grid.rows) continue;
            const hb = grid.values[(row + dy) * grid.columns + col + dx];
            if (ha >= 0 === hb >= 0) continue;
            const candidate = interpolate(a, sample(col + dx, row + dy), ha / (ha - hb)),
              d = distance(point, candidate);
            if (d < nearest) {
              nearest = d;
              best = candidate;
            }
          }
        }
    }
    return best;
  };
  return { land, cuts, coastNear };
}

/** Presentation paths derive from the persistent shared graph, then meet the actual coast. */
export function buildCartographicBorders(
  g: GeneratedGeography,
  kind: GeographicBorder['kind'],
  surface: BorderSurface = {},
): CartographicBorder[] {
  const chains = mergeGeographicBorders(g.borders.filter((b) => b.kind === kind));
  if ((!surface.coastline?.length && !surface.elevation) || kind === 'plate')
    return chains.map(({ openStart: _start, openEnd: _end, ...chain }) => chain);
  const geometry = surfaceGeometry(g, surface),
    out: CartographicBorder[] = [],
    reach = Math.sqrt((g.width * g.height) / g.cells.length) * 2.2;
  for (const chain of chains) {
    const points = [...chain.points];
    if (chain.openStart && geometry.land(points[0])) {
      const coast = geometry.coastNear(points[0], points[1], reach);
      if (coast && distance(coast, points[0]) > 0.001) points.unshift(coast);
    }
    if (chain.openEnd && geometry.land(points[points.length - 1])) {
      const coast = geometry.coastNear(points[points.length - 1], points[points.length - 2], reach);
      if (coast && distance(coast, points[points.length - 1]) > 0.001) points.push(coast);
    }
    let current: MapPoint[] = [],
      part = 0;
    const flush = () => {
      if (current.length > 1)
        out.push({ id: `${chain.id}_${part++}`, kind, motion: chain.motion, points: current });
      current = [];
    };
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        cuts = [0, ...geometry.cuts(a, b), 1];
      for (let j = 1; j < cuts.length; j++) {
        const start = interpolate(a, b, cuts[j - 1]),
          end = interpolate(a, b, cuts[j]);
        if (distance(start, end) < 1e-6) continue;
        if (geometry.land(interpolate(a, b, (cuts[j - 1] + cuts[j]) / 2))) {
          if (current.length && distance(current[current.length - 1], start) > 0.001) flush();
          if (!current.length) current.push(start);
          current.push(end);
        } else flush();
      }
    }
    flush();
  }
  return out;
}
