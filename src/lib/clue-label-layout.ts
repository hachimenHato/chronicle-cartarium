import type { GraphPoint } from './graph-layout';

export interface ClueRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ClueLabelGeometry {
  id: string;
  points: GraphPoint[];
  preferred: GraphPoint;
  width: number;
  height: number;
}
export interface ClueLabelPlacement {
  x: number;
  y: number;
  anchor: GraphPoint;
  leaderEnd: GraphPoint;
  clear: boolean;
}
const expanded = (r: ClueRect, margin: number): ClueRect => ({
  x: r.x - margin,
  y: r.y - margin,
  width: r.width + margin * 2,
  height: r.height + margin * 2,
});
const overlaps = (a: ClueRect, b: ClueRect) =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
export function lineIntersectsRect(a: GraphPoint, b: GraphPoint, r: ClueRect): boolean {
  let from = 0,
    to = 1;
  for (const [start, delta, min, max] of [
    [a.x, b.x - a.x, r.x, r.x + r.width],
    [a.y, b.y - a.y, r.y, r.y + r.height],
  ]) {
    if (Math.abs(delta) < 1e-8) {
      if (start < min || start > max) return false;
      continue;
    }
    const first = (min - start) / delta,
      second = (max - start) / delta;
    from = Math.max(from, Math.min(first, second));
    to = Math.min(to, Math.max(first, second));
    if (from > to) return false;
  }
  return true;
}
type Obstacle =
  | { kind: 'node' | 'label'; bounds: ClueRect }
  | { kind: 'line'; bounds: ClueRect; a: GraphPoint; b: GraphPoint; id: string };

/** Place notes beside actual curves, considering every connection, card and earlier note. */
export function placeClueLabels(
  edges: ClueLabelGeometry[],
  nodes: ClueRect[],
): Record<string, ClueLabelPlacement> {
  const all = edges.flatMap((edge) => edge.points);
  const extent = all.reduce(
    (r, p) => ({
      minX: Math.min(r.minX, p.x),
      minY: Math.min(r.minY, p.y),
      maxX: Math.max(r.maxX, p.x),
      maxY: Math.max(r.maxY, p.y),
    }),
    { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  );
  const cellSize = Math.max(
    128,
    (extent.maxX - extent.minX) / 180,
    (extent.maxY - extent.minY) / 180,
  );
  const grid = new Map<string, Obstacle[]>();
  const cells = (r: ClueRect, visit: (key: string) => void) => {
    for (let x = Math.floor(r.x / cellSize); x <= Math.floor((r.x + r.width) / cellSize); x++)
      for (let y = Math.floor(r.y / cellSize); y <= Math.floor((r.y + r.height) / cellSize); y++)
        visit(`${x}:${y}`);
  };
  const insert = (item: Obstacle) =>
    cells(item.bounds, (key) => {
      const list = grid.get(key) ?? [];
      list.push(item);
      grid.set(key, list);
    });
  const query = (r: ClueRect) => {
    const found = new Set<Obstacle>();
    cells(r, (key) => {
      for (const item of grid.get(key) ?? []) if (overlaps(item.bounds, r)) found.add(item);
    });
    return found;
  };
  for (const node of nodes) insert({ kind: 'node', bounds: expanded(node, 8) });
  for (const edge of edges)
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1],
        b = edge.points[i];
      insert({
        kind: 'line',
        id: edge.id,
        a,
        b,
        bounds: {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: Math.abs(a.x - b.x),
          height: Math.abs(a.y - b.y),
        },
      });
    }
  const result: Record<string, ClueLabelPlacement> = {};
  for (const edge of [...edges].sort((a, b) => a.id.localeCompare(b.id))) {
    if (edge.points.length < 2 || edge.width <= 0 || edge.height <= 0) continue;
    let preferred = 1;
    for (let i = 1; i < edge.points.length - 1; i++)
      if (
        Math.hypot(edge.points[i].x - edge.preferred.x, edge.points[i].y - edge.preferred.y) <
        Math.hypot(
          edge.points[preferred].x - edge.preferred.x,
          edge.points[preferred].y - edge.preferred.y,
        )
      )
        preferred = i;
    const indices = new Set([
      preferred,
      ...[0.5, 0.35, 0.65, 0.2, 0.8].map((fraction) =>
        Math.max(
          1,
          Math.min(edge.points.length - 2, Math.round(fraction * (edge.points.length - 1))),
        ),
      ),
    ]);
    let best: { score: number; placement: ClueLabelPlacement; rect: ClueRect } | undefined;
    for (const i of indices) {
      const anchor = edge.points[i],
        before = edge.points[Math.max(0, i - 1)],
        after = edge.points[Math.min(edge.points.length - 1, i + 1)];
      const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
      const normal = { x: -(after.y - before.y) / length, y: (after.x - before.x) / length };
      const junction = { x: anchor.x - 10, y: anchor.y - 10, width: 20, height: 20 };
      const junctionEdges = new Set(
        [...query(junction)]
          .filter(
            (obstacle) =>
              obstacle.kind === 'line' &&
              obstacle.id !== edge.id &&
              lineIntersectsRect(obstacle.a, obstacle.b, junction),
          )
          .map((obstacle) => (obstacle.kind === 'line' ? obstacle.id : '')),
      );
      for (const gap of [14, 32, 60])
        for (const side of [-1, 1]) {
          const distance =
            (Math.abs(normal.x) * edge.width) / 2 + (Math.abs(normal.y) * edge.height) / 2 + gap;
          const x = anchor.x + normal.x * distance * side,
            y = anchor.y + normal.y * distance * side;
          const rect = {
            x: x - edge.width / 2,
            y: y - edge.height / 2,
            width: edge.width,
            height: edge.height,
          };
          let score =
            gap * 0.06 +
            Math.hypot(anchor.x - edge.preferred.x, anchor.y - edge.preferred.y) * 0.012 +
            junctionEdges.size * 2000;
          let clear = true;
          const hits = new Set<string>();
          for (const obstacle of query(expanded(rect, 6))) {
            if (obstacle.kind === 'line') {
              if (lineIntersectsRect(obstacle.a, obstacle.b, expanded(rect, 6)))
                hits.add(obstacle.id);
            } else {
              score += obstacle.kind === 'node' ? 20000 : 15000;
              clear = false;
            }
          }
          if (hits.size) {
            score += hits.size * 1000;
            clear = false;
          }
          const leaderEnd = {
            x: Math.max(rect.x, Math.min(rect.x + rect.width, anchor.x)),
            y: Math.max(rect.y, Math.min(rect.y + rect.height, anchor.y)),
          };
          const candidate = { score, rect, placement: { x, y, anchor, leaderEnd, clear } };
          if (!best || score < best.score) best = candidate;
        }
    }
    if (best) {
      result[edge.id] = best.placement;
      insert({ kind: 'label', bounds: expanded(best.rect, 6) });
    }
  }
  return result;
}
