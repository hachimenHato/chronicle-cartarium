import { Delaunay } from 'd3-delaunay';
import type { TerrainBiome } from '../../shared/cartography';
import type { GeneratedGeography } from '../../shared/geography';
import type { GeneratedMapSnapshot } from '../../shared/generated-map';
import type { AtlasMap } from '../../shared/model';

type Elevation = GeneratedMapSnapshot['elevation'];
type Point = { x: number; y: number };
type Cover = 'woodland' | 'meadow' | 'arid' | 'wetland' | 'rock' | 'cold';
export interface ReliefWash {
  kind: 'shadow' | 'light' | Cover;
  path: string;
  opacity: number;
}
export interface TerrainReliefData {
  washes: ReliefWash[];
  samples: number;
  vertices: number;
  source: 'fine-elevation' | 'geographic-cells';
}

const covers: Cover[] = ['woodland', 'meadow', 'arid', 'wetland', 'rock', 'cold'];
const coverFor: Partial<Record<TerrainBiome, Cover>> = {
  forest: 'woodland',
  rainforest: 'woodland',
  taiga: 'woodland',
  grass: 'meadow',
  savanna: 'arid',
  desert: 'arid',
  swamp: 'wetland',
  mountain: 'rock',
  hill: 'rock',
  plateau: 'rock',
  badlands: 'rock',
  snow: 'cold',
  tundra: 'cold',
};
const clamp = (value: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
const number = (value: number) => String(Math.round(value * 100) / 100);

function noiseHash(x: number, y: number, seed: number) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, y: number, seed: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    smooth = (n: number) => n * n * (3 - 2 * n),
    tx = smooth(x - ix),
    ty = smooth(y - iy);
  return (
    (noiseHash(ix, iy, seed) * (1 - tx) + noiseHash(ix + 1, iy, seed) * tx) * (1 - ty) +
    (noiseHash(ix, iy + 1, seed) * (1 - tx) + noiseHash(ix + 1, iy + 1, seed) * tx) * ty
  );
}

/** Separable triangular averaging; computed once per accepted map, never as an SVG filter. */
function smooth(values: Float64Array, columns: number, rows: number, radius: number) {
  const horizontal = new Float64Array(values.length),
    result = new Float64Array(values.length);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      let sum = 0,
        weight = 0;
      for (let k = -radius; k <= radius; k++) {
        const w = radius + 1 - Math.abs(k);
        sum += values[y * columns + clamp(x + k, 0, columns - 1)] * w;
        weight += w;
      }
      horizontal[y * columns + x] = sum / weight;
    }
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      let sum = 0,
        weight = 0;
      for (let k = -radius; k <= radius; k++) {
        const w = radius + 1 - Math.abs(k);
        sum += horizontal[clamp(y + k, 0, rows - 1) * columns + x] * w;
        weight += w;
      }
      result[y * columns + x] = sum / weight;
    }
  return result;
}

function sampleHeight(grid: NonNullable<Elevation>, x: number, y: number) {
  const gx = clamp((x / grid.width) * grid.columns - 0.5, 0, grid.columns - 1),
    gy = clamp((y / grid.height) * grid.rows - 0.5, 0, grid.rows - 1),
    ix = Math.floor(gx),
    iy = Math.floor(gy),
    tx = gx - ix,
    ty = gy - iy,
    at = (a: number, b: number) =>
      grid.values[
        Math.min(grid.rows - 1, iy + b) * grid.columns + Math.min(grid.columns - 1, ix + a)
      ];
  return (
    (at(0, 0) * (1 - tx) + at(1, 0) * tx) * (1 - ty) + (at(0, 1) * (1 - tx) + at(1, 1) * tx) * ty
  );
}

function simplifyRing(points: Point[], quota: number, step: number) {
  if (points.length <= quota) return points;
  let split = 1;
  for (let i = 2; i < points.length; i++)
    if (
      Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y) >
      Math.hypot(points[split].x - points[0].x, points[split].y - points[0].y)
    )
      split = i;
  const open = (line: Point[], tolerance: number) => {
    const keep = new Uint8Array(line.length),
      pending = [[0, line.length - 1]];
    keep[0] = keep[line.length - 1] = 1;
    while (pending.length) {
      const [start, end] = pending.pop()!,
        a = line[start],
        b = line[end],
        dx = b.x - a.x,
        dy = b.y - a.y,
        length = dx * dx + dy * dy;
      let greatest = tolerance * tolerance,
        at = -1;
      for (let i = start + 1; i < end; i++) {
        const t = length ? clamp(((line[i].x - a.x) * dx + (line[i].y - a.y) * dy) / length) : 0,
          distance = (line[i].x - a.x - dx * t) ** 2 + (line[i].y - a.y - dy * t) ** 2;
        if (distance > greatest) {
          greatest = distance;
          at = i;
        }
      }
      if (at >= 0) {
        keep[at] = 1;
        pending.push([start, at], [at, end]);
      }
    }
    return line.filter((_, i) => keep[i]);
  };
  let result = points,
    tolerance = step * 0.08;
  // This is cartographic line generalization, only when a new wash exceeds its
  // vector budget. It never changes accepted terrain, rivers or authored marks.
  while (result.length > quota) {
    result = [
      ...open(points.slice(0, split + 1), tolerance).slice(0, -1),
      ...open([...points.slice(split), points[0]], tolerance).slice(0, -1),
    ];
    tolerance *= 1.65;
  }
  return result.length >= 3
    ? result
    : [
        points[0],
        points[Math.floor(points.length / 3)],
        points[Math.floor((points.length * 2) / 3)],
      ];
}

/**
 * Contour a continuous field into joined rings. Shared grid edges have stable numeric
 * identities, so adjacent squares cannot leave seams or produce a patchwork of tiles.
 * The four-edge saddle uses its centre value to choose a consistent connection.
 */
function contour(
  field: Float64Array,
  columns: number,
  rows: number,
  width: number,
  height: number,
  level: number,
  remaining: number,
): { path: string; vertices: number } {
  const dx = width / columns,
    dy = height / rows,
    stride = columns + 2,
    horizontalCount = (columns + 1) * (rows + 2),
    nodes = new Map<number, { point: Point; next: number[] }>(),
    sample = (x: number, y: number) =>
      x < 0 || y < 0 || x >= columns || y >= rows ? 0 : field[y * columns + x];
  const connect = (a: number, b: number) => {
    nodes.get(a)!.next.push(b);
    nodes.get(b)!.next.push(a);
  };
  for (let y = -1; y < rows; y++)
    for (let x = -1; x < columns; x++) {
      const v = [sample(x, y), sample(x + 1, y), sample(x + 1, y + 1), sample(x, y + 1)],
        mask = v.reduce((n, value, i) => n | (value >= level ? 1 << i : 0), 0);
      if (mask === 0 || mask === 15) continue;
      const corners = [
          { x, y },
          { x: x + 1, y },
          { x: x + 1, y: y + 1 },
          { x, y: y + 1 },
        ],
        ids = [
          (y + 1) * (columns + 1) + x + 1,
          horizontalCount + (y + 1) * stride + x + 2,
          (y + 2) * (columns + 1) + x + 1,
          horizontalCount + (y + 1) * stride + x + 1,
        ],
        crossing: number[] = [];
      for (let edge = 0; edge < 4; edge++) {
        const next = (edge + 1) % 4;
        if (v[edge] >= level === v[next] >= level) continue;
        const id = ids[edge];
        crossing.push(edge);
        if (!nodes.has(id)) {
          const t = clamp((level - v[edge]) / (v[next] - v[edge])),
            a = corners[edge],
            b = corners[next];
          nodes.set(id, {
            point: { x: (a.x + 0.5 + (b.x - a.x) * t) * dx, y: (a.y + 0.5 + (b.y - a.y) * t) * dy },
            next: [],
          });
        }
      }
      if (crossing.length === 2) connect(ids[crossing[0]], ids[crossing[1]]);
      else if (crossing.length === 4) {
        const middleHigh = (v[0] + v[1] + v[2] + v[3]) / 4 >= level;
        if ((mask === 5) === middleHigh) {
          connect(ids[0], ids[1]);
          connect(ids[2], ids[3]);
        } else {
          connect(ids[0], ids[3]);
          connect(ids[1], ids[2]);
        }
      }
    }
  const visited = new Set<number>(),
    rings: { points: Point[]; area: number }[] = [];
  for (const [start, node] of nodes) {
    if (visited.has(start)) continue;
    const ring: Point[] = [];
    let at = start,
      previous = -1;
    do {
      const entry = nodes.get(at);
      if (!entry || visited.has(at)) break;
      visited.add(at);
      ring.push(entry.point);
      const next = entry.next.find((n) => n !== previous);
      previous = at;
      at = next ?? -1;
    } while (at !== start && ring.length <= nodes.size);
    if (at !== start || ring.length < 3) continue;
    let twiceArea = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length];
      twiceArea += a.x * b.y - a.y * b.x;
    }
    if (Math.abs(twiceArea) < dx * dy * 0.8) continue;
    // Shape-preserving corner pruning; never create one SVG node per sample.
    const points = ring.filter((p, i) => {
      const a = ring[(i + ring.length - 1) % ring.length],
        b = ring[(i + 1) % ring.length],
        length = Math.hypot(b.x - a.x, b.y - a.y),
        distance = length
          ? Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / length
          : 0;
      return i % 3 === 0 || distance > Math.min(dx, dy) * 0.065;
    });
    if (points.length >= 3) rings.push({ points, area: Math.abs(twiceArea) });
  }
  // Reserve display work for all terrain families rather than letting an unusually
  // noisy shadow field starve every later highlight and habitat wash.
  const chosen = rings.sort((a, b) => b.area - a.area).slice(0, Math.floor(remaining / 4));
  let pendingVertices = chosen.reduce((sum, ring) => sum + ring.points.length, 0),
    path = '',
    vertices = 0;
  for (let index = 0; index < chosen.length; index++) {
    const ring = chosen[index];
    const available = remaining - vertices,
      quota = clamp(
        Math.floor((available * ring.points.length) / pendingVertices),
        4,
        available - (chosen.length - index - 1) * 4,
      ),
      points = simplifyRing(ring.points, quota, Math.min(dx, dy));
    pendingVertices -= ring.points.length;
    vertices += points.length;
    const last = points.at(-1)!,
      first = points[0];
    path += `M${number((last.x + first.x) / 2)},${number((last.y + first.y) / 2)}`;
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      // Quadratic corner rounding stays within its local hull; no cubic overshoot.
      path += `Q${number(a.x)},${number(a.y)} ${number((a.x + b.x) / 2)},${number((a.y + b.y) / 2)}`;
    }
    path += 'Z';
  }
  return { path, vertices };
}

/**
 * Original vector relief: two-scale terrain normals and continuous habitat washes.
 * Geometry is derived from the saved height field, not invented by individual cells.
 * All budgets are independent of frame rate / zoom; no raster or runtime filter.
 */
export function buildTerrainRelief(
  geography: GeneratedGeography,
  elevation?: Elevation,
  mapKind: AtlasMap['kind'] = 'world',
): TerrainReliefData {
  const fine =
    elevation &&
    elevation.columns > 1 &&
    elevation.rows > 1 &&
    elevation.width > 0 &&
    elevation.height > 0 &&
    elevation.values.length === elevation.columns * elevation.rows
      ? elevation
      : undefined;
  const result: TerrainReliefData = {
    washes: [],
    samples: 0,
    vertices: 0,
    source: fine ? 'fine-elevation' : 'geographic-cells',
  };
  if (!(geography.width > 0 && geography.height > 0) || !geography.cells.length) return result;
  const longSide = mapKind === 'town' ? 210 : mapKind === 'region' ? 195 : 180,
    ratio = geography.width / geography.height,
    columns = Math.max(12, Math.round(ratio >= 1 ? longSide : longSide * ratio)),
    rows = Math.max(12, Math.round(ratio >= 1 ? longSide / ratio : longSide)),
    count = columns * rows,
    heights = new Float64Array(count),
    land = new Uint8Array(count),
    vegetation = covers.map(() => new Float64Array(count)),
    sites = Delaunay.from(
      geography.cells,
      (cell) => cell.center.x,
      (cell) => cell.center.y,
    ),
    unit = Math.max(geography.width, geography.height) / 1000;
  result.samples = count;
  let nearest = 0,
    landCount = 0;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const px = ((x + 0.5) * geography.width) / columns,
        py = ((y + 0.5) * geography.height) / rows,
        index = y * columns + x;
      nearest = sites.find(px, py, nearest);
      const cell = geography.cells[nearest],
        height = fine ? sampleHeight(fine, px, py) : cell.elevation;
      heights[index] = Math.max(0, height);
      if (fine ? height <= 0 : !cell.land || cell.biome === 'water') continue;
      land[index] = 1;
      landCount++;
      const category = coverFor[cell.biome];
      if (category) {
        const variation =
          0.4 +
          noise(px / (125 * unit), py / (125 * unit), geography.seed + 77) * 0.42 +
          noise(px / (47 * unit), py / (47 * unit), geography.seed + 151) * 0.18;
        vegetation[covers.indexOf(category)][index] = variation;
      }
    }
  if (!landCount) return result;
  const add = (
    kind: ReliefWash['kind'],
    field: Float64Array,
    levels: number[],
    opacity: number,
    budget: number,
  ) => {
    let maximum = 0;
    for (const value of field) if (value > maximum) maximum = value;
    for (const level of levels) {
      if (level > maximum) continue;
      const shape = contour(
        field,
        columns,
        rows,
        geography.width,
        geography.height,
        level,
        Math.min(26000 - result.vertices, Math.floor(budget / levels.length)),
      );
      if (shape.path) {
        result.washes.push({ kind, path: shape.path, opacity });
        result.vertices += shape.vertices;
      }
    }
  };
  const middle = smooth(heights, columns, rows, 1),
    broad = smooth(heights, columns, rows, 5),
    gradients: { dx: number; dy: number }[] = [],
    magnitudes: number[] = [],
    dx = geography.width / columns,
    dy = geography.height / rows,
    at = (field: Float64Array, x: number, y: number) =>
      field[clamp(y, 0, rows - 1) * columns + clamp(x, 0, columns - 1)];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const gx =
          ((at(middle, x + 1, y) - at(middle, x - 1, y)) * 0.4 +
            (at(broad, x + 2, y) - at(broad, x - 2, y)) * 0.3) /
          dx,
        gy =
          ((at(middle, x, y + 1) - at(middle, x, y - 1)) * 0.4 +
            (at(broad, x, y + 2) - at(broad, x, y - 2)) * 0.3) /
          dy;
      gradients.push({ dx: gx, dy: gy });
      if (land[y * columns + x]) magnitudes.push(Math.hypot(gx, gy));
    }
  magnitudes.sort((a, b) => a - b);
  const contrast = Math.max(8 / unit, magnitudes[Math.floor(magnitudes.length * 0.85)] * 0.72),
    dark = new Float64Array(count),
    light = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    if (!land[i]) continue;
    const nx = gradients[i].dx / contrast,
      ny = gradients[i].dy / contrast,
      normal = Math.sqrt(nx * nx + ny * ny + 1),
      illumination = (nx * 0.53 + ny * 0.61 + 0.59) / normal;
    dark[i] = clamp((0.59 - illumination) / 0.9);
    light[i] = clamp((illumination - 0.59) / 0.45);
  }
  add('shadow', dark, [0.08, 0.17, 0.27, 0.38, 0.5, 0.63, 0.78], 0.024, 9000);
  add('light', light, [0.08, 0.18, 0.3, 0.44, 0.59, 0.75], 0.035, 7000);
  const activeCovers = vegetation
    .map((field, index) => ({ field, kind: covers[index] }))
    .filter(({ field }) => field.some((value) => value > 0));
  for (const { field: original, kind } of activeCovers) {
    const field = smooth(original, columns, rows, 2);
    for (let i = 0; i < count; i++) if (!land[i]) field[i] = 0;
    add(
      kind,
      field,
      [0.18, 0.38, 0.58, 0.76],
      kind === 'meadow' ? 0.018 : 0.024,
      10000 / activeCovers.length,
    );
  }
  return result;
}
