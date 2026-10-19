import type { MapPoint } from '../../shared/cartography';
import type { GeneratedGeography } from '../../shared/geography';
import { distanceToSegment } from './terrain';

/** All fronts share the actual cell-edge graph; shortcuts through interiors are impossible. */
export function frontierGraph(g: GeneratedGeography) {
  const nodes: MapPoint[] = [],
    links = new Map<number, Map<number, number>>(),
    ids = new Map<string, number>();
  const node = (p: MapPoint) => {
    const key = `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
    const existing = ids.get(key);
    if (existing !== undefined) return existing;
    const id = nodes.length;
    ids.set(key, id);
    nodes.push(p);
    links.set(id, new Map());
    return id;
  };
  for (const border of g.borders.filter(
    (b) => b.kind === 'cell' && g.cells[b.cells[0]]?.land && g.cells[b.cells[1]]?.land,
  )) {
    for (let i = 1; i < border.points.length; i++) {
      const a = node(border.points[i - 1]),
        b = node(border.points[i]),
        length = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
      links.get(a)!.set(b, length);
      links.get(b)!.set(a, length);
    }
  }
  return { nodes, links };
}
export function snapFrontPoint(
  p: MapPoint,
  graph: ReturnType<typeof frontierGraph>,
  radius: number,
) {
  let best = -1,
    distance = radius;
  graph.nodes.forEach((n, i) => {
    const d = Math.hypot(p.x - n.x, p.y - n.y);
    if (d <= distance) {
      best = i;
      distance = d;
    }
  });
  return best < 0 ? undefined : best;
}
export function followFrontEdge(
  graph: ReturnType<typeof frontierGraph>,
  start: number,
  end: number,
): MapPoint[] {
  if (start === end) return [graph.nodes[start]];
  const cost = new Map<number, number>([[start, 0]]),
    previous = new Map<number, number>(),
    open = new Set([start]);
  while (open.size) {
    let current = -1,
      best = Infinity;
    for (const id of open) {
      const d =
        cost.get(id)! +
        Math.hypot(graph.nodes[id].x - graph.nodes[end].x, graph.nodes[id].y - graph.nodes[end].y);
      if (d < best) {
        current = id;
        best = d;
      }
    }
    if (current === end) {
      const path = [end];
      while (path[0] !== start) path.unshift(previous.get(path[0])!);
      return path.map((id) => graph.nodes[id]);
    }
    open.delete(current);
    for (const [next, length] of graph.links.get(current) ?? []) {
      const candidate = cost.get(current)! + length;
      if (candidate < (cost.get(next) ?? Infinity)) {
        cost.set(next, candidate);
        previous.set(next, current);
        open.add(next);
      }
    }
  }
  return [];
}
export function lineOnFront(points: MapPoint[], g: GeneratedGeography, tolerance = 0.05) {
  const edges = g.borders.filter(
    (b) => b.kind === 'cell' && g.cells[b.cells[0]]?.land && g.cells[b.cells[1]]?.land,
  );
  return points.every((p, i) =>
    [p, ...(i ? [{ x: (p.x + points[i - 1].x) / 2, y: (p.y + points[i - 1].y) / 2 }] : [])].every(
      (q) =>
        edges.some((b) =>
          b.points.slice(1).some((end, j) => distanceToSegment(q, b.points[j], end) <= tolerance),
        ),
    ),
  );
}
