import { graphlib, layout } from '@dagrejs/dagre';
export interface GraphPoint {
  x: number;
  y: number;
}
export interface LayoutLink {
  id: string;
  source: string;
  target: string;
}
export interface ConnectionLane {
  sourceOffset: number;
  targetOffset: number;
  corridor: number;
  clearance: number;
}
/** Stable fanning at card borders and independent rails for parallel or reciprocal links. */
export function connectionLanes(
  links: LayoutLink[],
  height: number,
): Record<string, ConnectionLane> {
  const lanes: Record<string, ConnectionLane> = Object.fromEntries(
    links.map((link) => [
      link.id,
      { sourceOffset: 0, targetOffset: 0, corridor: 0, clearance: height / 2 + 20 },
    ]),
  );
  const groups = new Map<string, LayoutLink[]>();
  for (const link of links) {
    for (const key of [
      `source:${link.source}`,
      `target:${link.target}`,
      `pair:${JSON.stringify([link.source, link.target].sort())}`,
    ]) {
      const group = groups.get(key) ?? [];
      group.push(link);
      groups.set(key, group);
    }
  }
  for (const [key, group] of groups) {
    group.sort((a, b) => a.id.localeCompare(b.id));
    const pair = key.startsWith('pair:');
    const step = pair ? 28 : Math.min(28, (height - 32) / Math.max(1, group.length - 1));
    group.forEach((link, index) => {
      const offset = (index - (group.length - 1) / 2) * step;
      if (pair) lanes[link.id].corridor += offset;
      else if (key.startsWith('source:')) {
        lanes[link.id].sourceOffset = offset;
        lanes[link.id].corridor += offset * 0.35;
      } else {
        lanes[link.id].targetOffset = offset;
        lanes[link.id].corridor += offset * 0.25;
      }
    });
  }
  return lanes;
}
/** Layered layout with explicit card sizes; disconnected clues are packed into a separate grid. */
export function layoutClues(
  ids: string[],
  links: LayoutLink[],
  width = 240,
  height = 120,
  direction: 'LR' | 'TB' = 'LR',
) {
  const graph = new graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: direction,
    nodesep: 70,
    ranksep: 150,
    edgesep: 36,
    marginx: 60,
    marginy: 60,
    ranker: 'network-simplex',
    acyclicer: 'greedy',
  });
  graph.setDefaultEdgeLabel(() => ({}));
  const connected = new Set(links.flatMap((e) => [e.source, e.target]));
  const valid = new Set(ids);
  for (const id of ids.filter((id) => connected.has(id))) graph.setNode(id, { width, height });
  for (const edge of links)
    if (valid.has(edge.source) && valid.has(edge.target))
      graph.setEdge(edge.source, edge.target, { width: 100, height: 24, labelpos: 'c' }, edge.id);
  if (graph.nodeCount()) layout(graph);
  const positions: Record<string, GraphPoint> = {};
  const routes: Record<string, GraphPoint[]> = {};
  let bottom = 60;
  for (const id of graph.nodes()) {
    const n = graph.node(id);
    positions[id] = { x: n.x - width / 2, y: n.y - height / 2 };
    bottom = Math.max(bottom, n.y + height / 2 + 130);
  }
  for (const edge of graph.edges()) routes[edge.name!] = graph.edge(edge).points;
  ids
    .filter((id) => !connected.has(id))
    .forEach((id, index) => {
      positions[id] = {
        x: 60 + (index % 4) * (width + 70),
        y: bottom + Math.floor(index / 4) * (height + 70),
      };
    });
  return { positions, routes };
}
export function roundedCluePath(points: GraphPoint[], radius = 20): string {
  if (points.length < 2) return '';
  let path = `M${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1],
      current = points[i],
      next = points[i + 1];
    const distance = Math.min(
      radius,
      Math.hypot(current.x - previous.x, current.y - previous.y) / 2,
      Math.hypot(next.x - current.x, next.y - current.y) / 2,
    );
    const a = Math.hypot(current.x - previous.x, current.y - previous.y) || 1;
    const b = Math.hypot(next.x - current.x, next.y - current.y) || 1;
    const before = {
      x: current.x + ((previous.x - current.x) * distance) / a,
      y: current.y + ((previous.y - current.y) * distance) / a,
    };
    const after = {
      x: current.x + ((next.x - current.x) * distance) / b,
      y: current.y + ((next.y - current.y) * distance) / b,
    };
    path += ` L${before.x},${before.y} Q${current.x},${current.y} ${after.x},${after.y}`;
  }
  return path + ` L${points.at(-1)!.x},${points.at(-1)!.y}`;
}
