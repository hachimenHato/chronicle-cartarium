import type { MapObject, MapPoint } from '../../shared/cartography';
import type { SketchCell } from './sketch-generation-v1';
import { pointInPolygon } from './terrain';
import { assignMountainStyles } from './mountain-styles';
import {
  drawMountainPeak,
  projectMountainStyle,
  mountainBody,
  type MountainPeak,
} from './mountain-artwork';

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const round = (n: number) => Math.round(n * 1000) / 1000;
const distance = (a: MapPoint, b: MapPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const reversed = (points: MapPoint[]) => [...points].reverse();
function variation(seed: number, index: number, channel: number) {
  let n = Math.imul(index + 1, 374761393) ^ Math.imul(channel + 1, 668265263) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
interface RidgeNode extends MapPoint {
  index: number;
  elevation: number;
  score: number;
  density: number;
}

export const CLASSICAL_RELIEF_LIMIT = 4200;

interface ReliefOptions {
  density?: Float64Array;
  objectBudget?: number;
  /** Physical map coverage changes peak size and spacing, never source heights. */
  featureScale?: number;
}

/** Original oblique pen-and-wash ranges, derived from the real height field.
 * The projection is illustration only: heights, drainage and their RNG stay untouched. */
export function makeClassicalRelief(
  cells: SketchCell[],
  columns: number,
  rows: number,
  width: number,
  height: number,
  seed: number,
  options: ReliefOptions = {},
): MapObject[] {
  if (
    !Number.isInteger(columns) ||
    !Number.isInteger(rows) ||
    columns < 3 ||
    rows < 3 ||
    cells.length !== columns * rows ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return [];
  const featureScale = clamp(options.featureScale ?? 1, 0.55, 1.6);
  const scale = (Math.max(width, height) / 1000) * featureScale,
    dx = width / columns,
    dy = height / rows;
  const indexAt = (x: number, y: number) =>
    clamp(Math.floor(y / dy), 0, rows - 1) * columns + clamp(Math.floor(x / dx), 0, columns - 1);
  const altitude = (x: number, y: number) => cells[indexAt(x, y)].elevation;
  const land = (p: MapPoint) =>
    p.x > 0 && p.x < width && p.y > 0 && p.y < height && cells[indexAt(p.x, p.y)].land;
  const budget = Math.max(
    0,
    Math.min(
      CLASSICAL_RELIEF_LIMIT,
      2880 / featureScale ** 1.15,
      options.objectBudget ?? CLASSICAL_RELIEF_LIMIT,
    ),
  );
  // Reserve complete peak groups, all forest edges and both backbone washes.
  // A crowded map loses anchors evenly, never half of a mountain's artwork.
  let maxNodes = Math.min(Math.round(144 / featureScale ** 1.4), Math.floor(budget / 20));
  if (!maxNodes) return [];
  const densityAt = (index: number) => clamp(options.density?.[index] ?? 0.75, 0, 1);
  const spacing = 24 * scale,
    candidates: RidgeNode[] = [];
  for (let y = spacing; y < height - spacing; y += spacing * 0.85) {
    const row = Math.round(y / (spacing * 0.85));
    for (let x = spacing * (row % 2 ? 1 : 1.5); x < width - spacing; x += spacing) {
      let best: RidgeNode | undefined;
      const jitter = row * 4096 + Math.round(x / spacing);
      const px = x + (variation(seed, jitter, 32) - 0.5) * spacing * 0.46;
      const py = y + (variation(seed, jitter, 33) - 0.5) * spacing * 0.4;
      for (const oy of [-0.35, 0, 0.35])
        for (const ox of [-0.35, 0, 0.35]) {
          const probe = { x: px + ox * spacing, y: py + oy * spacing };
          const index = indexAt(probe.x, probe.y),
            c = cells[index],
            r = 10 * scale;
          const density = densityAt(index);
          if (!c.land || c.elevation < 0.18 || density === 0) continue;
          if (c.elevation < 0.39 && !['mountain', 'hill', 'badlands'].includes(c.biome)) {
            const reach = 65 * scale;
            if (
              Math.max(
                altitude(c.x - reach, c.y),
                altitude(c.x + reach, c.y),
                altitude(c.x, c.y - reach),
                altitude(c.x, c.y + reach),
              ) < 0.42
            )
              continue;
          }
          const sides = [
            altitude(c.x - r, c.y),
            altitude(c.x + r, c.y),
            altitude(c.x, c.y - r),
            altitude(c.x, c.y + r),
          ];
          const prominence = Math.max(0, c.elevation - sides.reduce((a, b) => a + b) / 4);
          const relief = Math.max(...sides) - Math.min(...sides);
          if (prominence < 0.003 && relief < 0.015) continue;
          const score = c.elevation + prominence * 3 + variation(seed, index, 1) * 0.05;
          if (!best || score > best.score)
            best = { ...probe, index, elevation: c.elevation, score, density };
        }
      if (best && variation(seed, jitter, 34) < Math.sqrt(best.density)) candidates.push(best);
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  if (!candidates.length) return [];
  const meanDensity = candidates.reduce((sum, node) => sum + node.density, 0) / candidates.length;
  maxNodes = Math.max(1, Math.floor(maxNodes * Math.sqrt(Math.min(1, meanDensity / 0.75))));
  // Round-robin spatial tiles: the budget must not give all detail to the highest
  // range and leave the other mountain regions empty.
  const tiles = new Map<string, RidgeNode[]>();
  for (const candidate of candidates) {
    const key = `${Math.floor(candidate.x / (120 * scale))}:${Math.floor(candidate.y / (120 * scale))}`;
    const tile = tiles.get(key) ?? [];
    tile.push(candidate);
    tiles.set(key, tile);
  }
  const distributed: RidgeNode[] = [];
  for (let i = 0; i < Math.max(0, ...[...tiles.values()].map((tile) => tile.length)); i++)
    for (const tile of tiles.values()) if (tile[i]) distributed.push(tile[i]);
  const nodes: RidgeNode[] = [];
  const primary = distributed.filter((node) => node.elevation >= 0.39);
  const foothills = distributed.filter((node) => node.elevation < 0.39);
  const accept = (node: RidgeNode) => {
    const separation = spacing * (0.64 + (1 - node.density) * 0.85);
    if (
      nodes.every(
        (other) =>
          Math.hypot(node.x - other.x, (node.y - other.y) * 0.88) >
          Math.max(separation, spacing * (0.64 + (1 - other.density) * 0.85)),
      )
    )
      nodes.push(node);
  };
  const primaryQuota = foothills.length ? Math.ceil(maxNodes * 0.74) : maxNodes;
  for (const node of primary) {
    if (nodes.length >= primaryQuota) break;
    accept(node);
  }
  for (const node of foothills) {
    if (nodes.length >= maxNodes) break;
    accept(node);
  }
  for (const node of primary) {
    if (nodes.length >= maxNodes) break;
    if (!nodes.includes(node)) accept(node);
  }
  const edgeSafe = (a: MapPoint, b: MapPoint, radius = 0) => {
    const steps = Math.max(1, Math.ceil(distance(a, b) / (Math.min(dx, dy) / 3)));
    for (let i = 0; i <= steps; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
      if (!land(p)) return false;
      if (radius)
        for (let oy = -radius; oy <= radius; oy += Math.min(dy / 2, radius))
          for (let ox = -radius; ox <= radius; ox += Math.min(dx / 2, radius))
            if (!land({ x: p.x + ox, y: p.y + oy })) return false;
    }
    return true;
  };
  const edges: { a: number; b: number; cost: number }[] = [];
  for (let a = 0; a < nodes.length; a++)
    for (let b = a + 1; b < nodes.length; b++) {
      // Shallow isolated hills need open contours, not a projected strip stretching
      // between low bumps. Only the mountain/low-ridge tiers carry joined saddles.
      if (Math.min(nodes[a].elevation, nodes[b].elevation) < 0.32) continue;
      const d = distance(nodes[a], nodes[b]);
      if (d > spacing * 2.8 || !edgeSafe(nodes[a], nodes[b], 6 * scale)) continue;
      // Adjacent ranges must not acquire a connecting ridge across a deep valley.
      let saddle = Infinity;
      for (let t = 0.1; t < 1; t += 0.1)
        saddle = Math.min(
          saddle,
          altitude(
            nodes[a].x + (nodes[b].x - nodes[a].x) * t,
            nodes[a].y + (nodes[b].y - nodes[a].y) * t,
          ),
        );
      if (saddle < Math.min(nodes[a].elevation, nodes[b].elevation) - 0.16) continue;
      edges.push({
        a,
        b,
        cost: d + Math.abs(nodes[a].elevation - nodes[b].elevation) * 90 * scale,
      });
    }
  edges.sort((a, b) => a.cost - b.cost || a.a - b.a || a.b - b.b);
  const parents = nodes.map((_, i) => i),
    neighbors = nodes.map((): number[] => []);
  function root(i: number): number {
    return parents[i] === i ? i : (parents[i] = root(parents[i]));
  }
  for (const { a, b } of edges)
    if (neighbors[a].length < 3 && neighbors[b].length < 3 && root(a) !== root(b)) {
      parents[root(a)] = root(b);
      neighbors[a].push(b);
      neighbors[b].push(a);
    }
  // A branch junction must not break the main range into a pile of short stamps.
  // Take the longest backbone of each tree, then its remaining connected branches.
  const unused = new Set(
    edges.filter(({ a, b }) => neighbors[a].includes(b)).map(({ a, b }) => `${a}:${b}`),
  );
  const edgeKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  const chains: RidgeNode[][] = [];
  const farthest = (start: number) => {
    let best = { length: 0, path: [start] };
    const visit = (at: number, previous: number, length: number, path: number[]) => {
      if (length > best.length) best = { length, path };
      for (const next of neighbors[at])
        if (next !== previous && unused.has(edgeKey(at, next)))
          visit(next, at, length + distance(nodes[at], nodes[next]), [...path, next]);
    };
    visit(start, -1, 0, [start]);
    return best.path;
  };
  while (unused.size) {
    const start = Number([...unused][0].split(':')[0]);
    const path = farthest(farthest(start).at(-1)!);
    for (let i = 1; i < path.length; i++) unused.delete(edgeKey(path[i - 1], path[i]));
    // Shared end anchors keep long ranges joined while bounding every editable polygon.
    for (let i = 0; i < path.length - 1; i += 6)
      chains.push(path.slice(i, i + 7).map((index) => nodes[index]));
  }
  chains.sort(
    (a, b) =>
      a.reduce((sum, p) => sum + p.y, 0) / a.length - b.reduce((sum, p) => sum + p.y, 0) / b.length,
  );
  const result: MapObject[] = [];
  const safe = (points: MapPoint[], polygon: boolean) => {
    for (let i = 0; i < (polygon ? points.length : points.length - 1); i++)
      if (!edgeSafe(points[i], points[(i + 1) % points.length])) return false;
    if (polygon) {
      const x0 = Math.floor(Math.min(...points.map((p) => p.x)) / dx),
        x1 = Math.floor(Math.max(...points.map((p) => p.x)) / dx);
      const y0 = Math.floor(Math.min(...points.map((p) => p.y)) / dy),
        y1 = Math.floor(Math.max(...points.map((p) => p.y)) / dy);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const c = cells[y * columns + x];
          if (!c?.land && pointInPolygon({ x: (x + 0.5) * dx, y: (y + 0.5) * dy }, points))
            return false;
        }
    }
    return true;
  };
  const add = (
    name: string,
    kind: 'polygon' | 'path',
    points: MapPoint[],
    color: string,
    stroke: string,
    strokeWidth: number,
    opacity = 1,
  ) => {
    const rounded = points.map((p) => ({ x: round(p.x), y: round(p.y) }));
    if (points.length < (kind === 'polygon' ? 3 : 2) || !safe(rounded, kind === 'polygon')) return;
    result.push({
      id: `classical-relief-${result.length}`,
      name: `古典山脉 · ${name}`,
      kind,
      points: rounded,
      color,
      stroke,
      strokeWidth: round(strokeWidth * scale),
      opacity,
      text: '',
      size: 24,
      rotation: 0,
      visible: true,
      locked: false,
    });
  };
  const mix = (a: MapPoint, b: MapPoint, t: number): MapPoint => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const styles = assignMountainStyles(nodes, seed, scale);
  const peaks: (MountainPeak & { node: RidgeNode })[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i],
      style = styles[i];
    const half = style.width * scale * (0.85 + variation(seed, node.index, 6) * 0.3);
    const rise = style.rise * scale * (0.85 + variation(seed, node.index, 7) * 0.32);
    for (const factor of [1, 0.78, 0.56, 0.34]) {
      const peak = projectMountainStyle(style, node, half * factor, rise * factor);
      if (!safe(mountainBody(peak), true)) continue;
      peaks.push({ ...peak, node });
      break;
    }
  }
  const peakAt = new Map(peaks.map((peak) => [peak.node.index, peak]));
  const curve = (a: MapPoint, b: MapPoint, bend: number, count = 6) =>
    Array.from({ length: count }, (_, i) => {
      const t = i / (count - 1),
        p = mix(a, b, t);
      return {
        x: p.x + Math.sin(t * Math.PI) * bend,
        y: p.y + Math.sin(t * Math.PI) * bend * 0.25,
      };
    });
  // Broad, unoutlined foothill washes connect the entire backbone and branches.
  // There is no extruded vertical ribbon: only the peaks and saddles carry ink.
  for (const chain of chains) {
    const path: MapPoint[] = [];
    for (let i = 1; i < chain.length; i++) path.push(...curve(chain[i - 1], chain[i], 2 * scale));
    if (path.length < 2) continue;
    for (const [breadth, opacity] of [
      [20, 0.035],
      [14, 0.05],
    ]) {
      const sides = [-1, 1].map((side) =>
        path.map((p, i) => {
          const a = path[Math.max(0, i - 1)],
            b = path[Math.min(path.length - 1, i + 1)],
            d = distance(a, b) || 1;
          const taper = 0.3 + Math.sin((Math.PI * i) / (path.length - 1)) * 0.7;
          return {
            x: p.x - ((b.y - a.y) / d) * breadth * scale * taper * side,
            y: p.y + ((b.x - a.x) / d) * breadth * scale * taper * side,
          };
        }),
      );
      add(
        '山脚淡彩过渡',
        'polygon',
        [...sides[0], ...reversed(sides[1])],
        '#a28e6c',
        'none',
        0,
        opacity,
      );
    }
  }
  for (let i = 0; i < nodes.length; i++)
    for (const neighbor of neighbors[i]) {
      if (neighbor < i) continue;
      const a = peakAt.get(nodes[i].index),
        b = peakAt.get(nodes[neighbor].index);
      if (!a || !b) continue;
      const center = mix(
        a.node,
        b.node,
        0.38 + variation(seed, a.node.index + b.node.index, 20) * 0.24,
      );
      const saddle = {
        x: center.x,
        y: center.y - Math.min(a.rise, b.rise) * 0.2,
      };
      const ridge = [
        ...curve(a.summit, saddle, 1.2 * scale),
        ...curve(saddle, b.summit, -scale).slice(1),
      ];
      const base = curve(a.feet[3], b.feet[3], 2 * scale);
      // A connecting saddle is a light pen line, never an opaque stretched
      // polygon between distant feet. Only actual peak silhouettes occlude.
      add('连绵鞍部', 'path', base, 'none', '#a28e73', 0.6, 0.12);
      add('连续山脊', 'path', ridge, 'none', '#7d664b', 0.3, 0.28);
    }
  peaks.sort((a, b) => a.node.y - b.node.y || a.node.index - b.node.index);
  for (const peak of peaks) {
    add(
      `${peak.style.id} ${peak.style.label} · 山体遮挡底色`,
      'polygon',
      mountainBody(peak),
      '#e4d8bc',
      'none',
      0,
      1,
    );
    for (const object of drawMountainPeak(peak, scale, seed, peak.node.index))
      add(
        object.name.slice('古典山脉 · '.length),
        object.kind as 'path' | 'polygon',
        object.points,
        object.color,
        object.stroke,
        object.strokeWidth / scale,
        object.opacity,
      );
  }
  return result;
}
