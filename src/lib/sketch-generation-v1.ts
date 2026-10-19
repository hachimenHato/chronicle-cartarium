import type {
  MapObject,
  MapPoint,
  MapRegion,
  SketchGenerationSettings,
  TerrainBiome,
  GeneratedSettlement,
} from '../../shared/cartography';
import { MAP_EDITOR_LIMITS } from '../../shared/cartography';
import { distanceToSegment, pointInPolygon, seededRandom } from './terrain';

export interface SketchMapStats {
  landCells: number;
  rivers: number;
  settlements: number;
  roads: number;
}
export interface SketchCell {
  x: number;
  y: number;
  land: boolean;
  biome: TerrainBiome;
  elevation: number;
  drainageElevation: number;
  downstream: number;
  moisture: number;
  slope: number;
  accumulation: number;
}
export interface SketchDiagnostics {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  cells: SketchCell[];
  rivers: number[][];
  routes: number[][];
  settlements: number[];
  vegetation: number[];
}
export interface SketchMapResult {
  sites?: GeneratedSettlement[];
  objects: MapObject[];
  stats: SketchMapStats;
  diagnostics: SketchDiagnostics;
}
const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const smooth = (n: number) => {
  n = clamp(n);
  return n * n * (3 - 2 * n);
};
const round = (n: number) => Math.round(n * 1000) / 1000;
function noise(x: number, y: number, seed: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    tx = smooth(x - ix),
    ty = smooth(y - iy);
  const hash = (a: number, b: number) => {
    let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  return (
    (hash(ix, iy) * (1 - tx) + hash(ix + 1, iy) * tx) * (1 - ty) +
    (hash(ix, iy + 1) * (1 - tx) + hash(ix + 1, iy + 1) * tx) * ty
  );
}

/** Stable min heap shared by flood filling and land route search. */
class Heap {
  private items: { id: number; cost: number }[] = [];
  get length() {
    return this.items.length;
  }
  push(id: number, cost: number) {
    const item = { id, cost };
    let i = this.items.length;
    this.items.push(item);
    while (i) {
      const parent = (i - 1) >> 1;
      if (this.items[parent].cost <= cost) break;
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.items[i] = item;
  }
  pop() {
    const top = this.items[0],
      last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.items.length && this.items[child + 1].cost < this.items[child].cost)
          child++;
        if (this.items[child].cost >= last.cost) break;
        this.items[i] = this.items[child];
        i = child;
      }
      this.items[i] = last;
    }
    return top;
  }
}

/** A versioned, entirely local generation pipeline. Input regions are never modified. */
export function generateSketchMap(
  regions: MapRegion[],
  width: number,
  height: number,
  settings: SketchGenerationSettings,
): SketchMapResult {
  if (settings.version !== 1) throw new Error('不支持这个地图生成版本。');
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error('地图尺寸无效。');
  if (regions.length > MAP_EDITOR_LIMITS.regions)
    throw new Error('色块超过 200 个，请先整理区域。');
  if (regions.some((r) => !r.points.length || r.points.length > MAP_EDITOR_LIMITS.points))
    throw new Error('色块控制点数量无效。');
  const visible = regions.filter((r) => r.visible);
  const complexity = visible.reduce((sum, r) => sum + r.points.length, 0);
  const resolution = Math.max(56, Math.round(128 / Math.max(1, Math.sqrt(complexity / 2400))));
  const unit = Math.max(width, height) / resolution;
  const columns = Math.max(8, Math.round(width / unit)),
    rows = Math.max(8, Math.round(height / unit));
  const cellWidth = width / columns,
    cellHeight = height / rows;
  const cells: SketchCell[] = [];
  const diagnostics: SketchDiagnostics = {
    columns,
    rows,
    cellWidth,
    cellHeight,
    cells,
    rivers: [],
    routes: [],
    settlements: [],
    vegetation: [],
  };
  const stats: SketchMapStats = { landCells: 0, rivers: 0, settlements: 0, roads: 0 };
  const objects: MapObject[] = [];
  const empty = () => ({ objects, stats, diagnostics });
  if (!visible.some((r) => r.biome !== 'water')) return empty();
  const seed = settings.seed >>> 0,
    random = seededRandom(seed);
  const point = (x: number, y: number) => ({
    x: round(clamp(x, 0, width)),
    y: round(clamp(y, 0, height)),
  });
  const neighbors = (i: number, diagonal = true) => {
    const x = i % columns,
      y = Math.floor(i / columns),
      result: number[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!(dx || dy) || (!diagonal && dx && dy)) continue;
        if (x + dx >= 0 && x + dx < columns && y + dy >= 0 && y + dy < rows)
          result.push((y + dy) * columns + x + dx);
      }
    return result;
  };
  const prepared = visible.map((r) => {
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity;
    for (const p of r.points) {
      left = Math.min(left, p.x);
      right = Math.max(right, p.x);
      top = Math.min(top, p.y);
      bottom = Math.max(bottom, p.y);
    }
    const margin = r.geometry === 'brush' ? r.width * 0.8 : unit * 5;
    return {
      r,
      left: left - margin,
      right: right + margin,
      top: top - margin,
      bottom: bottom + margin,
    };
  });
  const signedDistance = (p: MapPoint, r: MapRegion) => {
    let distance = Math.hypot(p.x - r.points[0].x, p.y - r.points[0].y);
    const n = r.geometry === 'polygon' ? r.points.length : r.points.length - 1;
    for (let i = 0; i < n; i++)
      distance = Math.min(
        distance,
        distanceToSegment(p, r.points[i], r.points[(i + 1) % r.points.length]),
      );
    return r.geometry === 'brush'
      ? r.width / 2 - distance
      : pointInPolygon(p, r.points)
        ? distance
        : -distance;
  };
  const field = new Float64Array(columns * rows);
  const density = new Float64Array(columns * rows);
  const intent = new Int16Array(columns * rows).fill(-1);
  // Evaluate the ordered sketch as a signed land field. Directly painted water
  // wins over coastline noise; unpainted space remains ocean.
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const x = (column + 0.5) * cellWidth,
        y = (row + 0.5) * cellHeight,
        i = row * columns + column;
      const p = { x, y };
      let land = -unit * 8,
        owner = -1,
        mountain = 0;
      prepared.forEach(({ r, left, right, top, bottom }, index) => {
        if (x < left || x > right || y < top || y > bottom) return;
        const d = signedDistance(p, r);
        const amplitude = Math.min(r.width * 0.075, unit * 2.4) * r.roughness;
        const texture =
          ((noise(x / (unit * 4), y / (unit * 4), seed ^ r.seed) - 0.5) * 1.4 +
            (noise(x / (unit * 1.5), y / (unit * 1.5), r.seed + seed + 31) - 0.5) * 0.6) *
          amplitude;
        if (r.biome === 'water') land = Math.min(land, -d + Math.min(0, texture));
        else land = Math.max(land, d + texture);
        if (d >= 0) owner = index;
        if (r.biome === 'mountain')
          mountain = Math.max(
            mountain,
            smooth((d + r.width * 0.7) / (r.width * 1.2)) * (0.85 + r.roughness * 0.43),
          );
      });
      intent[i] = owner;
      density[i] = owner >= 0 ? visible[owner].density : 0.75;
      const biome = owner >= 0 ? visible[owner].biome : 'grass';
      const isLand = land > 0 && biome !== 'water';
      field[i] = isLand ? land : Math.min(land, -0.001);
      const coastal = clamp(land / (unit * 10));
      const relief = noise(x / (unit * 11), y / (unit * 11), seed + 99);
      const rough = noise(x / (unit * 3), y / (unit * 3), seed + 48);
      const crest = 1 - Math.abs(noise(x / (unit * 4.4), y / (unit * 4.4), seed + 915) * 2 - 1);
      const peaks = 0.35 + relief * 0.25 + crest * 0.19 + rough * 0.12;
      let elevation = isLand
        ? 0.08 + 0.16 * coastal + mountain * peaks + (relief * 0.09 + rough * 0.055) * coastal
        : -0.1;
      if (biome === 'swamp' && isLand) elevation = Math.min(elevation, 0.13 + coastal * 0.07);
      if (biome === 'snow' && isLand) elevation += 0.13;
      const moisture = clamp(
        0.4 +
          (noise(x / (unit * 13), y / (unit * 13), seed + 253) - 0.5) * 0.45 +
          (settings.climate === 'dry' ? -0.24 : settings.climate === 'cold' ? 0.08 : 0.13),
      );
      cells.push({
        x,
        y,
        land: isLand,
        biome: isLand ? biome : 'water',
        elevation,
        drainageElevation: elevation,
        downstream: -1,
        moisture,
        slope: 0,
        accumulation: isLand ? 1 : 0,
      });
      if (isLand) stats.landCells++;
    }
  if (!stats.landCells) return empty();
  // Priority flood fills numerical depressions on the drainage surface only.
  // A parent is assigned when visiting a cell, so flat areas cannot form cycles.
  const flood = new Heap(),
    visited = new Uint8Array(cells.length),
    order: number[] = [];
  cells.forEach((c, i) => {
    if (
      !c.land ||
      i < columns ||
      i >= columns * (rows - 1) ||
      i % columns === 0 ||
      i % columns === columns - 1
    ) {
      visited[i] = 1;
      flood.push(i, c.elevation);
    }
  });
  while (flood.length) {
    const { id } = flood.pop();
    order.push(id);
    for (const next of neighbors(id)) {
      if (visited[next]) continue;
      visited[next] = 1;
      cells[next].downstream = id;
      cells[next].drainageElevation = Math.max(
        cells[next].elevation,
        cells[id].drainageElevation + 0.00001,
      );
      flood.push(next, cells[next].drainageElevation);
    }
  }
  for (let j = order.length - 1; j >= 0; j--) {
    const i = order[j],
      next = cells[i].downstream;
    if (next >= 0) cells[next].accumulation += cells[i].accumulation;
  }
  cells.forEach((c, i) => {
    if (!c.land) return;
    c.slope = Math.max(
      ...neighbors(i)
        .filter((n) => cells[n].land)
        .map((n) => Math.abs(c.elevation - cells[n].elevation)),
      0,
    );
    c.moisture = clamp(
      c.moisture +
        Math.min(0.28, c.accumulation / 260) +
        (neighbors(i).some((n) => !cells[n].land) ? 0.12 : 0),
    );
    const explicit = intent[i] >= 0 ? visible[intent[i]].biome : 'grass';
    // Grass is the generic land instruction; the other colors are explicit biomes.
    if (explicit === 'grass')
      c.biome =
        c.elevation > 0.77 || (settings.climate === 'cold' && c.elevation > 0.54)
          ? 'snow'
          : c.elevation > 0.56
            ? 'mountain'
            : c.moisture > 0.59
              ? 'forest'
              : c.moisture < 0.27
                ? 'desert'
                : 'grass';
  });
  const riverThreshold = Math.max(14, Math.sqrt(stats.landCells) * 0.48);
  const riverCells = new Set<number>();
  if (settings.rivers) {
    const candidates = cells
      .map((c, i) => i)
      .filter(
        (i) => cells[i].land && cells[i].accumulation >= riverThreshold && cells[i].downstream >= 0,
      )
      .sort((a, b) => cells[b].drainageElevation - cells[a].drainageElevation);
    for (const start of candidates) {
      if (riverCells.has(start)) continue;
      const line = [start];
      let at = start;
      while (cells[at].land && cells[at].downstream >= 0 && line.length < cells.length) {
        at = cells[at].downstream;
        line.push(at);
        if (riverCells.has(at)) break;
      }
      if (line.length < 5) continue;
      line.forEach((i) => riverCells.add(i));
      diagnostics.rivers.push(line);
    }
  }
  stats.rivers = diagnostics.rivers.length;
  // Rank habitable sites, then use a map-scale separation so a large island does
  // not receive a pile of settlements on the same favorable coastal cell.
  const candidates = cells
    .map((c, i) => ({ c, i }))
    .filter(
      ({ c, i }) =>
        c.land &&
        c.elevation < 0.56 &&
        c.slope < 0.13 &&
        !['mountain', 'swamp', 'snow'].includes(c.biome) &&
        field[i] > unit * 1.5,
    )
    .map(({ c, i }) => ({
      i,
      score:
        (riverCells.has(i) || neighbors(i).some((n) => riverCells.has(n)) ? 3 : 0) +
        (field[i] < unit * 5 ? 1.2 : 0) +
        c.moisture * 1.4 -
        c.slope * 7 -
        c.elevation +
        noise(c.x / 18, c.y / 18, seed + 717) * 0.55,
    }))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const spacing = Math.max(
    unit * 7,
    Math.min(width, height) / (2.3 + Math.sqrt(Math.max(1, settings.settlements))),
  );
  for (const { i } of candidates) {
    if (diagnostics.settlements.length >= settings.settlements) break;
    if (
      diagnostics.settlements.every(
        (n) => Math.hypot(cells[n].x - cells[i].x, cells[n].y - cells[i].y) >= spacing,
      )
    )
      diagnostics.settlements.push(i);
  }
  stats.settlements = diagnostics.settlements.length;
  const findRoute = (from: number, target: number) => {
    const queue = new Heap(),
      costs = new Float64Array(cells.length).fill(Infinity),
      previous = new Int32Array(cells.length).fill(-1);
    queue.push(from, 0);
    costs[from] = 0;
    while (queue.length) {
      const item = queue.pop(),
        at = item.id;
      if (item.cost !== costs[at]) continue;
      if (at === target) {
        const route = [at];
        while (route[route.length - 1] !== from) route.push(previous[route[route.length - 1]]);
        return route.reverse();
      }
      for (const next of neighbors(at, false)) {
        if (!cells[next].land) continue;
        const cost =
          costs[at] +
          1 +
          Math.abs(cells[at].elevation - cells[next].elevation) * 28 +
          cells[next].elevation * 2 +
          (riverCells.has(next) ? 2 : 0);
        if (cost >= costs[next]) continue;
        costs[next] = cost;
        previous[next] = at;
        queue.push(next, cost);
      }
    }
    return [];
  };
  if (settings.routes) {
    const connected = new Set<number>();
    for (const from of diagnostics.settlements) {
      connected.add(from);
      const targets = diagnostics.settlements
        .filter((i) => !connected.has(i))
        .sort(
          (a, b) =>
            Math.hypot(cells[a].x - cells[from].x, cells[a].y - cells[from].y) -
            Math.hypot(cells[b].x - cells[from].x, cells[b].y - cells[from].y),
        );
      for (const target of targets) {
        const route = findRoute(from, target);
        if (route.length) {
          diagnostics.routes.push(route);
          break;
        }
      }
    }
  }
  stats.roads = diagnostics.routes.length;
  let serial = 0;
  const add = (
    name: string,
    kind: MapObject['kind'],
    points: MapPoint[],
    style: Partial<MapObject> = {},
  ) => {
    if (points.length < (kind === 'polygon' ? 3 : kind === 'path' ? 2 : 1)) return;
    if (points.length > MAP_EDITOR_LIMITS.points)
      throw new Error(`「${name}」生成轮廓有 ${points.length} 个控制点，超过上限。请简化色块。`);
    if (objects.length >= MAP_EDITOR_LIMITS.objects)
      throw new Error('生成内容过多，请减少区域或聚落。');
    objects.push({
      id: `sketch_${seed}_${serial++}`,
      name,
      kind,
      points: points.map((p) => point(p.x, p.y)),
      text: '',
      color: 'none',
      stroke: 'none',
      strokeWidth: 0,
      size: 16,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      ...style,
    });
  };
  // Rendering is factored out so the grid never becomes visible square tiles.
  renderSketch({
    cells,
    field,
    density,
    columns,
    rows,
    cellWidth,
    cellHeight,
    width,
    height,
    unit,
    seed,
    random,
    diagnostics,
    add,
  });
  return { objects, stats, diagnostics };
}

interface RenderContext {
  cells: SketchCell[];
  field: Float64Array;
  density: Float64Array;
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  width: number;
  height: number;
  unit: number;
  seed: number;
  random: () => number;
  diagnostics: SketchDiagnostics;
  add: (
    name: string,
    kind: MapObject['kind'],
    points: MapPoint[],
    style?: Partial<MapObject>,
  ) => void;
}

/** Marching triangles interpolate cell-center samples; chains are closed outside
 * the map before clipping, so coastlines at the viewport boundary remain filled. */
function contours(
  values: Float64Array,
  columns: number,
  rows: number,
  dx: number,
  dy: number,
  threshold: number,
) {
  const links = new Map<string, { p: MapPoint; edges: { key: string; id: number }[] }>();
  let serial = 0;
  const value = (x: number, y: number) =>
    x < 0 || y < 0 || x >= columns || y >= rows
      ? threshold - Math.max(1, Math.abs(threshold))
      : values[y * columns + x];
  const key = (p: MapPoint) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`;
  const edge = (a: MapPoint, b: MapPoint) => {
    const ka = key(a),
      kb = key(b);
    if (ka === kb) return;
    if (!links.has(ka)) links.set(ka, { p: a, edges: [] });
    if (!links.has(kb)) links.set(kb, { p: b, edges: [] });
    links.get(ka)!.edges.push({ key: kb, id: serial });
    links.get(kb)!.edges.push({ key: ka, id: serial++ });
  };
  for (let y = -1; y < rows; y++)
    for (let x = -1; x < columns; x++) {
      const corners = [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
      ].map(([a, b]) => ({
        p: { x: (a + 0.5) * dx, y: (b + 0.5) * dy },
        v: value(a, b) - threshold + 1e-10,
      }));
      for (const triangle of [
        [0, 1, 2],
        [0, 2, 3],
      ]) {
        const crossing: MapPoint[] = [];
        for (let k = 0; k < 3; k++) {
          const a = corners[triangle[k]],
            b = corners[triangle[(k + 1) % 3]];
          if (a.v > 0 === b.v > 0) continue;
          const t = a.v / (a.v - b.v);
          crossing.push({ x: a.p.x + (b.p.x - a.p.x) * t, y: a.p.y + (b.p.y - a.p.y) * t });
        }
        if (crossing.length === 2) edge(crossing[0], crossing[1]);
      }
    }
  const used = new Set<number>(),
    rings: MapPoint[][] = [];
  for (const [start, node] of links)
    for (const first of node.edges) {
      if (used.has(first.id)) continue;
      const ring: MapPoint[] = [node.p];
      let at = start,
        next = first;
      for (let n = 0; n <= serial; n++) {
        used.add(next.id);
        at = next.key;
        if (at === start) break;
        const current = links.get(at)!;
        ring.push(current.p);
        const following = current.edges.find((e) => !used.has(e.id));
        if (!following) break;
        next = following;
      }
      if (at !== start || ring.length < 3) continue;
      // Remove sampling-level corners while keeping peninsulas and lake holes.
      const simple = ring.filter(
        (p, i) =>
          distanceToSegment(
            p,
            ring[(i + ring.length - 1) % ring.length],
            ring[(i + 1) % ring.length],
          ) >
            Math.min(dx, dy) * 0.045 || i % 4 === 0,
      );
      if (simple.length < 3 || Math.abs(area(simple)) < dx * dy * 0.65) continue;
      const rounded: MapPoint[] = [];
      for (let i = 0; i < simple.length; i++) {
        const a = simple[i],
          b = simple[(i + 1) % simple.length];
        rounded.push(
          { x: a.x * 0.82 + b.x * 0.18, y: a.y * 0.82 + b.y * 0.18 },
          { x: a.x * 0.18 + b.x * 0.82, y: a.y * 0.18 + b.y * 0.82 },
        );
      }
      let split = 1;
      for (let i = 2; i < rounded.length; i++)
        if (
          Math.hypot(rounded[i].x - rounded[0].x, rounded[i].y - rounded[0].y) >
          Math.hypot(rounded[split].x - rounded[0].x, rounded[split].y - rounded[0].y)
        )
          split = i;
      const tolerance = Math.min(dx, dy) * 0.12;
      const simplified = [
        ...simplifyLine(rounded.slice(0, split + 1), tolerance).slice(0, -1),
        ...simplifyLine([...rounded.slice(split), rounded[0]], tolerance).slice(0, -1),
      ];
      rings.push(simplified.length >= 3 ? simplified : rounded);
    }
  return rings;
}
function area(points: MapPoint[]) {
  return (
    points.reduce((n, p, i) => {
      const q = points[(i + 1) % points.length];
      return n + p.x * q.y - q.x * p.y;
    }, 0) / 2
  );
}
function simplifyLine(points: MapPoint[], tolerance: number) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const pending: [number, number][] = [[0, points.length - 1]];
  while (pending.length) {
    const [start, end] = pending.pop()!;
    let greatest = tolerance,
      index = -1;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i], points[start], points[end]);
      if (d > greatest) {
        greatest = d;
        index = i;
      }
    }
    if (index >= 0) {
      keep[index] = 1;
      pending.push([start, index], [index, end]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
function fillRings(rings: MapPoint[][]): MapPoint[][] {
  const sorted = [...rings].sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  const groups: { outer: MapPoint[]; holes: MapPoint[][] }[] = [];
  sorted.forEach((ring, i) => {
    const depth = sorted.slice(0, i).filter((parent) => pointInPolygon(ring[0], parent)).length;
    if (!(depth % 2))
      groups.push({ outer: area(ring) > 0 ? ring : [...ring].reverse(), holes: [] });
    else {
      const group = [...groups].reverse().find((g) => pointInPolygon(ring[0], g.outer));
      group?.holes.push(area(ring) < 0 ? ring : [...ring].reverse());
    }
  });
  return groups.map(({ outer, holes }) => {
    const joined = [...outer];
    for (const hole of holes) {
      let a = 0,
        b = 0,
        best = Infinity;
      for (let i = 0; i < joined.length; i++)
        for (let j = 0; j < hole.length; j++) {
          const d = (joined[i].x - hole[j].x) ** 2 + (joined[i].y - hole[j].y) ** 2;
          if (d < best) {
            a = i;
            b = j;
            best = d;
          }
        }
      const loop = [...hole.slice(b), ...hole.slice(0, b), hole[b], joined[a]];
      joined.splice(a + 1, 0, ...loop);
    }
    return joined;
  });
}

function renderSketch(context: RenderContext) {
  const {
    add,
    width,
    height,
    cells,
    field,
    density,
    columns,
    rows,
    cellWidth: dx,
    cellHeight: dy,
    unit,
    seed,
    random,
    diagnostics,
  } = context;
  const at = (p: MapPoint) =>
    clamp(Math.floor(p.y / dy), 0, rows - 1) * columns +
    clamp(Math.floor(p.x / dx), 0, columns - 1);
  const locate = (i: number) => ({ x: cells[i].x, y: cells[i].y });
  const trace = (values: Float64Array, level: number) =>
    contours(values, columns, rows, dx, dy, level);
  const surface = (
    name: string,
    values: Float64Array,
    level: number,
    color: string,
    opacity = 1,
    blur = 0,
  ) => {
    const rings = trace(values, level);
    fillRings(rings).forEach((ring) => add(name, 'polygon', ring, { color, opacity, blur }));
    return rings;
  };
  add(
    '海面',
    'polygon',
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    { color: '#abc8c9' },
  );
  const coast = trace(field, 0);
  // Separate strokes are essential: a lake hole must not create a visible bridge.
  for (const ring of coast)
    add('沿岸浅海', 'path', [...ring, ring[0]], {
      stroke: '#d1dfd6',
      strokeWidth: unit * 3.2,
      opacity: 0.75,
    });
  for (const ring of coast)
    add('沿岸水纹', 'path', [...ring, ring[0]], {
      stroke: '#92b4b7',
      strokeWidth: unit * 4.5,
      opacity: 0.17,
    });
  fillRings(coast).forEach((ring) => add('大陆', 'polygon', ring, { color: '#e9dfb9' }));
  const heights = Float64Array.from(cells, (c, i) => (c.land ? c.elevation : 0));
  const fertility = Float64Array.from(cells, (c, i) =>
    c.land
      ? clamp(c.moisture - (c.elevation > 0.55 ? 0.18 : 0)) * smooth(field[i] / (unit * 3))
      : 0,
  );
  for (const [level, color, opacity] of [
    [0.15, '#d6d5ab', 0.5],
    [0.25, '#c3cb9e', 0.5],
    [0.4, '#aebd8e', 0.4],
    [0.52, '#a4ad82', 0.45],
  ] as const)
    surface('地表过渡', fertility, level, color, opacity, unit * 0.55);
  for (const [level, color] of [
    [0.34, '#c9c59d'],
    [0.45, '#b9b28e'],
    [0.56, '#a69e83'],
    [0.67, '#b8b09b'],
    [0.8, '#ddd4bb'],
  ] as const)
    surface('高程地形', heights, level, color, 0.46, unit * 0.68);
  const lighting = Float64Array.from(cells, (c, i) => {
    if (
      !c.land ||
      c.elevation < 0.35 ||
      i < columns ||
      i >= cells.length - columns ||
      i % columns === 0 ||
      i % columns === columns - 1
    )
      return 0;
    return (
      ((cells[i + 1].elevation - cells[i - 1].elevation) * 0.8 +
        (cells[i + columns].elevation - cells[i - columns].elevation) * 0.6) *
      smooth((c.elevation - 0.3) / 0.25)
    );
  });
  for (const level of [0.025, 0.065, 0.115]) {
    surface('背光坡面', lighting, level, '#6e6b53', 0.14, unit * 0.48);
    surface(
      '迎光坡面',
      Float64Array.from(lighting, (v) => -v),
      level,
      '#f4e9ca',
      0.23,
      unit * 0.48,
    );
  }
  for (const biome of ['desert', 'swamp', 'snow'] as const) {
    const values = Float64Array.from(cells, (c, i) =>
      c.land && c.biome === biome ? smooth(field[i] / (unit * 2)) : 0,
    );
    const color = { desert: '#e7ce98', swamp: '#94ac92', snow: '#eeeada' }[biome];
    surface('地貌覆盖', values, 0.32, color, 0.8, unit * 0.55);
  }
  // Slope shading and hachures suggest connected ridges instead of repeated
  // identical triangular mountain stamps. Marks thin toward flat lowlands.
  for (let row = 1; row < rows - 1; row++)
    for (let column = 1; column < columns - 1; column++) {
      const i = row * columns + column,
        c = cells[i];
      if (!c.land || c.elevation < 0.34 || field[i] < unit * 2) continue;
      const gx = cells[i + 1].elevation - cells[i - 1].elevation,
        gy = cells[i + columns].elevation - cells[i - columns].elevation;
      const gradient = Math.hypot(gx, gy);
      if (gradient < 0.026 || random() > density[i] * 0.6) continue;
      const x = c.x + (random() - 0.5) * dx,
        y = c.y + (random() - 0.5) * dy;
      const length = unit * (0.3 + clamp(gradient * 5) * 1.1),
        vx = -gx / gradient,
        vy = -gy / gradient;
      add(
        '山坡排线',
        'path',
        [
          { x, y },
          {
            x: x + vx * length * 0.5 - vy * unit * 0.12,
            y: y + vy * length * 0.5 + vx * unit * 0.12,
          },
          { x: x + vx * length, y: y + vy * length },
        ],
        {
          stroke: gx + gy > 0 ? '#625f4c' : '#f0e4c3',
          strokeWidth: unit * 0.075,
          opacity: gx + gy > 0 ? 0.33 : 0.57,
        },
      );
    }
  for (const ring of coast) {
    add('海岸沙缘', 'path', [...ring, ring[0]], { stroke: '#f4e9c9', strokeWidth: unit * 0.42 });
    add('海岸线', 'path', [...ring, ring[0]], {
      stroke: '#5e817b',
      strokeWidth: unit * 0.095,
      opacity: 0.85,
    });
  }
  // Sparse ocean engraving; every sample is tested against the land field.
  for (let y = unit * 3; y < height - unit; y += unit * 4.1)
    for (let x = unit * 2; x < width - unit; x += unit * 6.3) {
      const p = { x: x + (random() - 0.5) * unit * 3, y: y + (random() - 0.5) * unit * 2 };
      if (field[at(p)] > -unit * 2) continue;
      add(
        '海面细波',
        'path',
        [
          { x: p.x - unit * 0.75, y: p.y },
          { x: p.x - unit * 0.2, y: p.y - unit * 0.12 },
          { x: p.x + unit * 0.45, y: p.y + unit * 0.04 },
          { x: p.x + unit * 0.85, y: p.y - unit * 0.08 },
        ],
        { stroke: '#628e94', strokeWidth: unit * 0.055, opacity: 0.32 },
      );
    }
  const soften = (points: MapPoint[]) => {
    if (points.length < 3) return points;
    const result = [points[0]];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1];
      result.push(
        { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
        { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 },
      );
    }
    result.push(points[points.length - 1]);
    return result;
  };
  const riverShapes = diagnostics.rivers.map((indices) => {
    const points = soften(indices.map(locate));
    const ribbon = (extra: number) => {
      const left: MapPoint[] = [],
        right: MapPoint[] = [];
      points.forEach((p, j) => {
        const a = points[Math.max(0, j - 1)],
          b = points[Math.min(points.length - 1, j + 1)],
          length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const source =
          indices[
            Math.min(
              indices.length - 1,
              Math.floor((j / (points.length - 1)) * (indices.length - 1)),
            )
          ];
        const w = unit * (0.11 + Math.sqrt(cells[source].accumulation) * 0.027) + extra;
        const nx = (-(b.y - a.y) / length) * w * 0.5,
          ny = ((b.x - a.x) / length) * w * 0.5;
        left.push({ x: p.x + nx, y: p.y + ny });
        right.push({ x: p.x - nx, y: p.y - ny });
      });
      return [...left, ...right.reverse()];
    };
    return { points, bank: ribbon(unit * 0.25), water: ribbon(0) };
  });
  // Forest is a layered canopy field and overlapping individual crowns.
  // Paint density controls local detail; a weighted budget limits SVG complexity.
  const forest = Float64Array.from(cells, (c, i) =>
    c.land && c.biome === 'forest'
      ? smooth(field[i] / (unit * 3)) *
        (0.6 + noise(c.x / (unit * 5), c.y / (unit * 5), seed + 61) * 0.4)
      : 0,
  );
  surface('林地底色', forest, 0.42, '#728f64', 0.38, unit * 0.8);
  const forestProbability = Math.min(
    0.34,
    430 /
      Math.max(
        1,
        cells.reduce(
          (sum, c, i) => sum + (c.land && c.biome === 'forest' ? density[i] / 0.75 : 0),
          0,
        ),
      ),
  );
  const occupied = diagnostics.settlements;
  const riverSet = new Set(diagnostics.rivers.flat());
  for (let row = 1; row < rows - 1; row++)
    for (let column = 1; column < columns - 1; column++) {
      const i = row * columns + column,
        c = cells[i];
      if (!c.land || field[i] < unit * 1.8 || riverSet.has(i)) continue;
      if (occupied.some((n) => Math.hypot(c.x - cells[n].x, c.y - cells[n].y) < unit * 4)) continue;
      if (c.biome === 'forest' && random() < (forestProbability * density[i]) / 0.75) {
        const x = c.x + (random() - 0.5) * unit * 0.55,
          y = c.y + (random() - 0.5) * unit * 0.55;
        if (!cells[at({ x, y })].land) continue;
        const radius = unit * (0.45 + random() * 0.3);
        const crown: MapPoint[] = [];
        for (let k = 0; k < 12; k++) {
          const a = (k * Math.PI) / 6,
            s = radius * (0.83 + random() * 0.25);
          crown.push({ x: x + Math.cos(a) * s, y: y + Math.sin(a) * s * 0.8 });
        }
        add(
          '林冠阴影',
          'polygon',
          crown.map((p) => ({ x: p.x + unit * 0.15, y: p.y + unit * 0.25 })),
          { color: '#435d46', opacity: 0.23 },
        );
        add('林冠', 'polygon', crown, {
          color: random() > 0.5 ? '#688b5a' : '#7c995e',
          stroke: '#4b704f',
          strokeWidth: unit * 0.045,
          opacity: 0.85,
        });
        add(
          '林冠亮面',
          'path',
          [
            { x: x - radius * 0.55, y: y - radius * 0.1 },
            { x: x - radius * 0.25, y: y - radius * 0.5 },
            { x: x + radius * 0.25, y: y - radius * 0.45 },
          ],
          { stroke: '#b2bc7e', strokeWidth: unit * 0.09, opacity: 0.65 },
        );
        diagnostics.vegetation.push(i);
      } else if (c.biome === 'grass' && random() < density[i] * 0.133) {
        add(
          '草甸纹理',
          'path',
          [
            { x: c.x - unit * 0.25, y: c.y },
            { x: c.x, y: c.y - unit * 0.15 },
            { x: c.x + unit * 0.25, y: c.y },
          ],
          { stroke: '#8d9968', strokeWidth: unit * 0.05, opacity: 0.32 },
        );
      } else if (c.biome === 'desert' && random() < density[i] * 0.16) {
        add(
          '沙丘细纹',
          'path',
          [
            { x: c.x - unit * 0.55, y: c.y + unit * 0.1 },
            { x: c.x, y: c.y - unit * 0.22 },
            { x: c.x + unit * 0.5, y: c.y },
          ],
          { stroke: '#ad9260', strokeWidth: unit * 0.065, opacity: 0.35 },
        );
      }
    }
  // Draw after vegetation and all banks first, keeping water continuous through
  // woodland and preventing tributary banks from cutting the downstream river.
  riverShapes.forEach((r, i) =>
    add(`河流 ${i + 1} · 岸`, 'polygon', r.bank, { color: '#e3dfbd', opacity: 0.8 }),
  );
  riverShapes.forEach((r, i) => add(`河流 ${i + 1}`, 'polygon', r.water, { color: '#578c99' }));
  for (let j = 0; j < diagnostics.routes.length; j++) {
    const original = diagnostics.routes[j].map(locate);
    const clear = (a: MapPoint, b: MapPoint) => {
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (unit * 0.2));
      for (let k = 0; k <= steps; k++) {
        const c =
          cells[
            at({
              x: a.x + ((b.x - a.x) * k) / Math.max(1, steps),
              y: a.y + ((b.y - a.y) * k) / Math.max(1, steps),
            })
          ];
        if (!c.land || c.elevation > 0.62) return false;
      }
      return true;
    };
    const simplified = [original[0]];
    let anchor = 0;
    while (anchor < original.length - 1) {
      let next = original.length - 1;
      while (next > anchor + 1 && !clear(original[anchor], original[next])) next--;
      simplified.push(original[next]);
      anchor = next;
    }
    const rounded = soften(simplified);
    const points = rounded.every((p, i) => i === 0 || clear(rounded[i - 1], p))
      ? rounded
      : simplified;
    add(`道路 ${j + 1} · 路基`, 'path', points, {
      stroke: '#f2e4c2',
      strokeWidth: unit * 0.48,
      opacity: 0.95,
    });
    add(`道路 ${j + 1}`, 'path', points, {
      stroke: '#ad895e',
      strokeWidth: unit * 0.15,
      opacity: 0.85,
    });
  }
  // Habitable settlements use small clusters with roofs, a center and a label.
  // Their dependent details still check the final water mask individually.
  const names = [
    '溪湾',
    '松岸',
    '白石',
    '青岚',
    '南渡',
    '暮野',
    '望川',
    '长桥',
    '林间',
    '北湾',
    '晓原',
    '星原',
  ];
  for (let j = 0; j < diagnostics.settlements.length; j++) {
    const c = cells[diagnostics.settlements[j]],
      city = j === 0;
    const count = city ? 9 : 5;
    for (let k = 0; k < count; k++) {
      const angle = k * 2.39996,
        radius = unit * (0.9 + Math.sqrt(k) * 0.65),
        x = c.x + Math.cos(angle) * radius,
        y = c.y + Math.sin(angle) * radius;
      if (!cells[at({ x, y })].land || field[at({ x, y })] < unit) continue;
      const w = unit * (0.4 + random() * 0.18),
        h = w * 0.75;
      const house = [
        { x: x - w, y: y - h },
        { x: x + w, y: y - h },
        { x: x + w, y: y + h },
        { x: x - w, y: y + h },
      ];
      add(
        `聚落 ${j + 1} · 建筑阴影`,
        'polygon',
        house.map((p) => ({ x: p.x + unit * 0.15, y: p.y + unit * 0.2 })),
        { color: '#766d50', opacity: 0.23 },
      );
      add(`聚落 ${j + 1} · 屋顶`, 'polygon', house, {
        color: k % 3 ? '#bd956e' : '#97856c',
        stroke: '#75664d',
        strokeWidth: unit * 0.075,
      });
      add(
        `聚落 ${j + 1} · 屋脊`,
        'path',
        [
          { x: x - w, y },
          { x: x + w, y },
        ],
        { stroke: '#e6c499', strokeWidth: unit * 0.1 },
      );
    }
    const name = names[j];
    add(`聚落 ${j + 1} · 地标`, 'symbol', [{ x: c.x, y: c.y }], {
      symbol: city ? 'city' : 'village',
      size: unit * 2,
      color: '#d0b18a',
      stroke: '#6b614b',
      strokeWidth: 0.8,
    });
    add(`聚落 ${j + 1} · 名称`, 'text', [{ x: c.x, y: c.y + unit * 4.1 }], {
      text: name + (city ? '城' : '镇'),
      color: '#554f3d',
      stroke: '#f5ecd3',
      strokeWidth: unit * 0.26,
      size: unit * 1.65,
    });
  }
}
