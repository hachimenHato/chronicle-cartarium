import { makeId } from '../../shared/model';
import type { AtlasMap } from '../../shared/model';
import { biomeCatalog, MAP_EDITOR_LIMITS, symbolCatalog } from '../../shared/cartography';
import type {
  MapEditorData,
  MapObject,
  MapPoint,
  MapRegion,
  MapSymbolKind,
} from '../../shared/cartography';
import { distanceToSegment, generateTerrain, pointInPolygon, seededRandom } from './terrain';
import { generateSketchMap } from './sketch-generation';
import { parchmentObject } from './map-palette';

export { biomeCatalog, symbolCatalog } from '../../shared/cartography';

const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const point = (x: number, y: number): MapPoint => ({ x: round(x), y: round(y) });
const same = (a: MapPoint, b: MapPoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 0.00001;
const hash = (value: string) => {
  let n = 2166136261;
  for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return n >>> 0;
};
const stableId = (source: string, suffix: string) => `cart_${hash(source).toString(36)}_${suffix}`;

export function createEditorData(): MapEditorData {
  return { version: 1, mode: 'sketch', baseVisible: true, regions: [], objects: [] };
}

export function createMapObject(
  kind: MapObject['kind'],
  position: MapPoint,
  overrides: Partial<MapObject> = {},
): MapObject {
  return {
    id: makeId('object'),
    name: {
      symbol: '图章',
      path: '线条',
      polygon: '区域',
      text: '地图文字',
      image: '导入地图图片',
    }[kind],
    kind,
    points: Array.from(
      { length: kind === 'polygon' ? 3 : kind === 'path' || kind === 'image' ? 2 : 1 },
      (_, index) => ({
        x: position.x + (kind === 'image' ? index : 0),
        y: position.y + (kind === 'image' ? index : 0),
      }),
    ),
    ...(kind === 'symbol' ? { symbol: 'tree' as const } : {}),
    text: kind === 'text' ? '地图文字' : '',
    color: kind === 'path' ? 'none' : '#a7c19a',
    stroke: '#5b7561',
    strokeWidth: kind === 'path' ? 3 : 1,
    size: kind === 'text' ? 18 : 16,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    ...overrides,
  };
}

function makeObject(
  source: string,
  suffix: string,
  kind: MapObject['kind'],
  points: MapPoint[],
  changes: Partial<MapObject> = {},
): MapObject {
  return {
    id: stableId(source, suffix),
    name: '地图对象',
    kind,
    points,
    text: '',
    color: 'none',
    stroke: 'none',
    strokeWidth: 0,
    size: 16,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    ...changes,
  };
}

function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const tx = smooth(x - ix),
    ty = smooth(y - iy);
  const value = (a: number, b: number) => {
    let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 2147483647.5 - 1;
  };
  return (
    (value(ix, iy) * (1 - tx) + value(ix + 1, iy) * tx) * (1 - ty) +
    (value(ix, iy + 1) * (1 - tx) + value(ix + 1, iy + 1) * tx) * ty
  );
}

function boundaryDistance(p: MapPoint, points: MapPoint[], closed: boolean): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y);
  let distance = Infinity;
  for (let i = 0; i < points.length - (closed ? 0 : 1); i++)
    distance = Math.min(distance, distanceToSegment(p, points[i], points[(i + 1) % points.length]));
  return distance;
}

/** A continuous signed distance field retains bends, bays and holes of the painted stroke. */
function regionField(p: MapPoint, region: MapRegion): number {
  if (!region.points.length) return -Infinity;
  const scale = Math.max(12, region.width * 0.55);
  const irregularity =
    (noise(p.x / scale, p.y / scale, region.seed) * 0.7 +
      noise(p.x / (scale * 0.37), p.y / (scale * 0.37), region.seed ^ 0x15c21) * 0.3) *
    region.width *
    0.22 *
    region.roughness;
  const distance = boundaryDistance(p, region.points, region.geometry === 'polygon');
  return region.geometry === 'brush'
    ? region.width / 2 - distance + irregularity
    : (pointInPolygon(p, region.points) ? distance : -distance) + irregularity;
}

export function pointInRegion(position: MapPoint, region: MapRegion): boolean {
  return region.points.length > 0 && regionField(position, region) >= -0.00001;
}

function signedArea(points: MapPoint[]): number {
  return (
    points.reduce((sum, p, i) => {
      const next = points[(i + 1) % points.length];
      return sum + p.x * next.y - next.x * p.y;
    }, 0) / 2
  );
}

function cleanPoints(points: MapPoint[]): MapPoint[] {
  const result = points.filter((p, i) => i === 0 || !same(p, points[i - 1]));
  if (result.length > 1 && same(result[0], result[result.length - 1])) result.pop();
  return result;
}

/** RDP removes sampling noise with a map-unit error bound, never source brush points. */
function simplifyArc(points: MapPoint[], tolerance: number): MapPoint[] {
  if (points.length <= 2) return points;
  const keep = new Set([0, points.length - 1]);
  const pending = [[0, points.length - 1]];
  while (pending.length) {
    const [start, end] = pending.pop()!;
    let furthest = -1,
      distance = tolerance;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i], points[start], points[end]);
      if (d > distance) {
        distance = d;
        furthest = i;
      }
    }
    if (furthest >= 0) {
      keep.add(furthest);
      pending.push([start, furthest], [furthest, end]);
    }
  }
  return points.filter((_, i) => keep.has(i));
}

function intersects(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint): boolean {
  if (
    Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
    Math.max(c.x, d.x) < Math.min(a.x, b.x) ||
    Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
    Math.max(c.y, d.y) < Math.min(a.y, b.y)
  )
    return false;
  const cross = (p: MapPoint, q: MapPoint, r: MapPoint) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
}

function hasCrossings(a: MapPoint[], b = a): boolean {
  for (let i = 0; i < a.length; i++)
    for (let j = a === b ? i + 1 : 0; j < b.length; j++) {
      if (a === b && (j === i + 1 || (i === 0 && j === a.length - 1))) continue;
      if (intersects(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  return false;
}

/** Simplify separate rings before joining holes; reject any topology-changing shortcut. */
function simplifyContours(contours: MapPoint[][], tolerance: number): MapPoint[][] {
  const candidates = contours.map((ring) => {
    if (ring.length < 5) return ring;
    let split = 1,
      furthest = 0;
    for (let i = 1; i < ring.length; i++) {
      const distance = (ring[i].x - ring[0].x) ** 2 + (ring[i].y - ring[0].y) ** 2;
      if (distance > furthest) {
        furthest = distance;
        split = i;
      }
    }
    const candidate = [
      ...simplifyArc(ring.slice(0, split + 1), tolerance).slice(0, -1),
      ...simplifyArc([...ring.slice(split), ring[0]], tolerance).slice(0, -1),
    ];
    // If still over capacity, the caller reports a recoverable capacity error.
    if (candidate.length < 3 || Math.sign(signedArea(candidate)) !== Math.sign(signedArea(ring)))
      return ring;
    if (candidate.length <= MAP_EDITOR_LIMITS.points && hasCrossings(candidate)) return ring;
    return candidate;
  });
  for (let i = 0; i < candidates.length; i++)
    for (let j = 0; j < candidates.length; j++) {
      if (i === j) continue;
      if (
        pointInPolygon(contours[j][0], contours[i]) !==
        pointInPolygon(contours[j][0], candidates[i])
      )
        return contours;
      if (
        i < j &&
        candidates[i].length <= MAP_EDITOR_LIMITS.points &&
        candidates[j].length <= MAP_EDITOR_LIMITS.points &&
        hasCrossings(candidates[i], candidates[j])
      )
        return contours;
    }
  return candidates;
}

/** Marching squares emits genuine filled polygons rather than a wide visual brush line. */
export function regionContours(
  region: MapRegion,
  width: number,
  height: number,
  field?: (p: MapPoint) => number,
): MapPoint[][] {
  if (!region.points.length || (region.geometry === 'polygon' && region.points.length < 3))
    return [];
  const margin = region.width * 0.65;
  const sample = field || ((p: MapPoint) => regionField(p, region));
  const x0 = Math.max(0, Math.min(...region.points.map((p) => p.x)) - margin);
  const x1 = Math.min(width, Math.max(...region.points.map((p) => p.x)) + margin);
  const y0 = Math.max(0, Math.min(...region.points.map((p) => p.y)) - margin);
  const y1 = Math.min(height, Math.max(...region.points.map((p) => p.y)) + margin);
  if (x1 <= x0 || y1 <= y0) return [];
  const step = Math.max(
    1.25,
    Math.min(region.width / 10, Math.min(width, height) / 100),
    Math.max(x1 - x0, y1 - y0) / 180,
  );
  const nx = Math.ceil((x1 - x0) / step) + 2,
    ny = Math.ceil((y1 - y0) / step) + 2;
  const dx = (x1 - x0) / (nx - 2),
    dy = (y1 - y0) / (ny - 2);
  const location = (x: number, y: number) => ({ x: x0 + (x - 1) * dx, y: y0 + (y - 1) * dy });
  const values: number[][] = Array.from({ length: ny + 1 }, (_, y) =>
    Array.from({ length: nx + 1 }, (_, x) =>
      x === 0 || y === 0 || x === nx || y === ny ? -step : sample(location(x, y)),
    ),
  );
  const nodes = new Map<string, MapPoint>();
  const links = new Map<string, string[]>();
  const key = (p: MapPoint) => `${p.x.toFixed(5)}_${p.y.toFixed(5)}`;
  const join = (a: MapPoint, b: MapPoint) => {
    const ka = key(a),
      kb = key(b);
    if (ka === kb) return;
    nodes.set(ka, a);
    nodes.set(kb, b);
    links.set(ka, [...(links.get(ka) || []), kb]);
    links.set(kb, [...(links.get(kb) || []), ka]);
  };
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const coords = [
        location(x, y),
        location(x + 1, y),
        location(x + 1, y + 1),
        location(x, y + 1),
      ];
      const v = [values[y][x], values[y][x + 1], values[y + 1][x + 1], values[y + 1][x]];
      const intersections: (MapPoint | undefined)[] = [0, 1, 2, 3].map((i) => {
        const j = (i + 1) % 4;
        if (v[i] >= 0 === v[j] >= 0) return undefined;
        const t = v[i] / (v[i] - v[j]);
        return {
          x: coords[i].x + (coords[j].x - coords[i].x) * t,
          y: coords[i].y + (coords[j].y - coords[i].y) * t,
        };
      });
      const edges = intersections.flatMap((p, i) => (p ? [i] : []));
      if (edges.length === 2) join(intersections[edges[0]]!, intersections[edges[1]]!);
      else if (edges.length === 4) {
        const centerInside =
          sample({ x: (coords[0].x + coords[2].x) / 2, y: (coords[0].y + coords[2].y) / 2 }) >= 0;
        const pairs =
          v[0] >= 0 === centerInside
            ? [
                [0, 1],
                [2, 3],
              ]
            : [
                [0, 3],
                [1, 2],
              ];
        pairs.forEach(([a, b]) => join(intersections[a]!, intersections[b]!));
      }
    }
  const visited = new Set<string>();
  const contours: MapPoint[][] = [];
  for (const start of nodes.keys()) {
    if (visited.has(start)) continue;
    const contour: MapPoint[] = [];
    let current: string | undefined = start;
    while (current && !visited.has(current)) {
      visited.add(current);
      const p = nodes.get(current)!;
      contour.push(point(clamp(p.x, 0, width), clamp(p.y, 0, height)));
      current = links.get(current)?.find((next) => !visited.has(next));
    }
    const cleaned = cleanPoints(contour);
    if (cleaned.length >= 3 && Math.abs(signedArea(cleaned)) > 0.05) contours.push(cleaned);
  }
  return contours;
}

/** Zero-area bridges retain holes in the editable polygon's nonzero winding fill. */
export function joinContours(contours: MapPoint[][]): MapPoint[][] {
  const sorted = [...contours].sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  const groups: { outer: MapPoint[]; holes: MapPoint[][] }[] = [];
  const parents = sorted.map((contour, i) =>
    sorted.slice(0, i).filter((other) => pointInPolygon(contour[0], other)),
  );
  for (let i = 0; i < sorted.length; i++) {
    const contour = sorted[i];
    if (parents[i].length % 2 === 0)
      groups.push({ outer: signedArea(contour) > 0 ? contour : [...contour].reverse(), holes: [] });
    else {
      const group = [...groups].reverse().find((g) => pointInPolygon(contour[0], g.outer));
      group?.holes.push(signedArea(contour) < 0 ? contour : [...contour].reverse());
    }
  }
  return groups.map(({ outer, holes }) => {
    let result = outer;
    for (const hole of holes) {
      let oi = 0,
        hi = 0,
        distance = Infinity;
      for (let i = 0; i < result.length; i++)
        for (let j = 0; j < hole.length; j++) {
          const next = (result[i].x - hole[j].x) ** 2 + (result[i].y - hole[j].y) ** 2;
          if (next < distance) {
            distance = next;
            oi = i;
            hi = j;
          }
        }
      const ring = [...hole.slice(hi), ...hole.slice(0, hi)];
      result = [...result.slice(0, oi + 1), ...ring, ring[0], result[oi], ...result.slice(oi + 1)];
    }
    return result;
  });
}

const biomeSymbols: Record<MapRegion['biome'], MapSymbolKind[]> = {
  water: [],
  grass: ['hill', 'tree'],
  forest: ['tree', 'pine'],
  mountain: ['mountain', 'rock', 'hill'],
  desert: ['dune', 'rock'],
  swamp: ['reeds', 'tree'],
  snow: ['mountain', 'pine', 'rock'],
  hill: ['hill', 'tree', 'rock'],
  plateau: ['hill', 'rock'],
  taiga: ['pine', 'rock'],
  rainforest: ['tree', 'tree', 'reeds'],
  savanna: ['tree', 'hill'],
  tundra: ['rock', 'reeds'],
  badlands: ['rock', 'mountain', 'hill'],
};

export function generateRegionObjects(
  region: MapRegion,
  width: number,
  height: number,
): MapObject[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error('地图尺寸无效。');
  if (region.points.length > MAP_EDITOR_LIMITS.points)
    throw new Error('区域超过 2000 个顶点，请分成较小区域后生成。');
  const contours = simplifyContours(
    regionContours(region, width, height),
    Math.min(0.5, region.width / 40),
  );
  const polygons = joinContours(contours);
  const biome = biomeCatalog.find((item) => item.id === region.biome)!;
  const objects = polygons.map((points, i) =>
    makeObject(region.id, `surface_${i}`, 'polygon', points, {
      name: `${region.name} · 地表`,
      color: biome.color,
      visible: region.visible,
      locked: region.locked,
    }),
  );
  for (const object of objects)
    if (object.points.length > MAP_EDITOR_LIMITS.points)
      throw new Error('生成轮廓超过 2000 个顶点，请缩小区域或降低轮廓复杂度。');
  const choices = biomeSymbols[region.biome];
  if (!polygons.length || !choices.length || region.density === 0) return objects;
  const random = seededRandom(region.seed ^ hash(region.id));
  const flat = contours.flat();
  const bounds = {
    minX: Math.min(...flat.map((p) => p.x)),
    maxX: Math.max(...flat.map((p) => p.x)),
    minY: Math.min(...flat.map((p) => p.y)),
    maxY: Math.max(...flat.map((p) => p.y)),
  };
  const area = polygons.reduce((sum, p) => sum + Math.abs(signedArea(p)), 0);
  const baseSize = Math.max(5, Math.min(17, Math.min(width, height) / 48));
  const coverage = region.biome === 'grass' ? 0.14 : region.biome === 'snow' ? 0.36 : 0.7;
  const target = Math.min(
    MAP_EDITOR_LIMITS.symbolsPerRegion,
    Math.ceil((area / (baseSize * baseSize * 8)) * region.density * coverage),
  );
  const placed: { position: MapPoint; radius: number }[] = [];
  for (let attempt = 0; attempt < target * 90 && placed.length < target; attempt++) {
    const p = point(
      bounds.minX + random() * (bounds.maxX - bounds.minX),
      bounds.minY + random() * (bounds.maxY - bounds.minY),
    );
    const size = round(baseSize * (0.72 + random() * 0.5));
    const radius = size * 1.75;
    if (p.x < radius || p.x > width - radius || p.y < radius || p.y > height - radius) continue;
    if (!polygons.some((poly) => pointInPolygon(p, poly))) continue;
    if (contours.some((contour) => boundaryDistance(p, contour, true) < radius)) continue;
    if (
      placed.some(
        (other) =>
          Math.hypot(other.position.x - p.x, other.position.y - p.y) <
          (other.radius + radius) * 0.65,
      )
    )
      continue;
    const symbol =
      choices[Math.min(choices.length - 1, Math.floor(random() ** 1.65 * choices.length))];
    const definition = symbolCatalog.find((item) => item.id === symbol)!;
    objects.push(
      makeObject(region.id, `symbol_${placed.length}`, 'symbol', [p], {
        name: `${region.name} · ${definition.label}`,
        symbol,
        size,
        color: definition.color,
        stroke: '#62705b',
        strokeWidth: 0.8,
        opacity: 0.88,
        visible: region.visible,
        locked: region.locked,
      }),
    );
    placed.push({ position: p, radius });
  }
  return objects;
}

interface SampledBrush {
  width: number;
  height: number;
  nx: number;
  ny: number;
  left: number;
  top: number;
  columns: number;
  rows: number;
  values: Float32Array;
}
const brushFieldCache = new WeakMap<MapRegion, SampledBrush>();

/** Composite the authored strokes before extracting geometry. Adjacent strokes of the
 * same biome have one outline; a later different biome replaces local terrain and decor.
 * Sources remain untouched, so undo, local regeneration and moving regions still work. */
export function composeTerrainRegions(
  regions: MapRegion[],
  width: number,
  height: number,
): MapObject[] {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)))
    throw new Error('地图尺寸无效。');
  const visible = regions.filter((r) => r.visible && r.points.length > 0);
  if (!visible.length) return [];
  const step = Math.max(3, Math.max(width, height) / 240);
  const nx = Math.ceil(width / step),
    ny = Math.ceil(height / step),
    dx = width / nx,
    dy = height / ny;
  const length = (nx + 1) * (ny + 1),
    far = -1e6;
  const fields = biomeCatalog.map(() => new Float32Array(length).fill(far));
  const owner = new Int16Array(length).fill(-1);
  const active = new Set<number>();
  for (let ri = 0; ri < visible.length; ri++) {
    const region = visible[ri],
      bi = biomeCatalog.findIndex((b) => b.id === region.biome);
    if (region.points.length > MAP_EDITOR_LIMITS.points)
      throw new Error('区域超过 2000 个顶点，请分开绘制。');
    active.add(bi);
    let cached = brushFieldCache.get(region);
    if (
      !cached ||
      cached.width !== width ||
      cached.height !== height ||
      cached.nx !== nx ||
      cached.ny !== ny
    ) {
      const margin = region.width * 0.7 + 30;
      const left = Math.max(
        0,
        Math.floor((Math.min(...region.points.map((p) => p.x)) - margin) / dx),
      );
      const right = Math.min(
        nx,
        Math.ceil((Math.max(...region.points.map((p) => p.x)) + margin) / dx),
      );
      const top = Math.max(
        0,
        Math.floor((Math.min(...region.points.map((p) => p.y)) - margin) / dy),
      );
      const bottom = Math.min(
        ny,
        Math.ceil((Math.max(...region.points.map((p) => p.y)) + margin) / dy),
      );
      const columns = right - left + 1,
        rows = bottom - top + 1,
        values = new Float32Array(columns * rows);
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < columns; x++)
          values[y * columns + x] = regionField({ x: (left + x) * dx, y: (top + y) * dy }, region);
      cached = { width, height, nx, ny, left, top, columns, rows, values };
      brushFieldCache.set(region, cached);
    }
    for (let y = 0; y < cached.rows; y++)
      for (let x = 0; x < cached.columns; x++) {
        const i = (cached.top + y) * (nx + 1) + cached.left + x,
          d = cached.values[y * cached.columns + x];
        for (const other of active)
          fields[other][i] =
            other === bi ? Math.max(fields[other][i], d) : Math.min(fields[other][i], -d);
        if (d >= 0) owner[i] = ri;
      }
  }
  const sample = (values: Float32Array, p: MapPoint) => {
    const gx = clamp(p.x / dx, 0, nx),
      gy = clamp(p.y / dy, 0, ny),
      x = Math.min(nx - 1, Math.floor(gx)),
      y = Math.min(ny - 1, Math.floor(gy));
    const tx = gx - x,
      ty = gy - y,
      i = y * (nx + 1) + x;
    return (
      (values[i] * (1 - tx) + values[i + 1] * tx) * (1 - ty) +
      (values[i + nx + 1] * (1 - tx) + values[i + nx + 2] * tx) * ty
    );
  };
  const source = `terrain:${visible.map((r) => r.id).join('|')}`;
  const domain: MapRegion = {
    ...visible[0],
    geometry: 'polygon',
    points: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    width: 40,
  };
  const surfaces: MapObject[] = [],
    decor: MapObject[] = [];
  const addContours = (
    bi: number,
    suffix: string,
    field: (p: MapPoint) => number,
    changes: Partial<MapObject>,
  ) => {
    const contours = simplifyContours(regionContours(domain, width, height, field), 0.7);
    const outline = changes.color === 'none';
    (outline ? contours.map((ring) => [...ring, ring[0]]) : joinContours(contours)).forEach(
      (points, i) => {
        if (points.length > MAP_EDITOR_LIMITS.points)
          throw new Error('融合后的轮廓过于复杂，请减少小碎片或分区绘制。');
        surfaces.push(
          makeObject(
            source,
            `surface_${biomeCatalog[bi].id}_${suffix}_${i}`,
            outline ? 'path' : 'polygon',
            points,
            { name: `${biomeCatalog[bi].label} · 融合地表`, ...changes },
          ),
        );
      },
    );
  };
  const landFields = [...active]
    .filter((bi) => biomeCatalog[bi].id !== 'water')
    .map((bi) => fields[bi]);
  if (landFields.length) {
    const land = (p: MapPoint) => Math.max(...landFields.map((values) => sample(values, p)));
    addContours(1, 'coast', (p) => land(p) + 2, {
      name: '陆地 · 海岸过渡',
      color: '#b7c4a1',
      blur: 2,
      opacity: 0.55,
    });
    addContours(1, 'land', land, { name: '陆地 · 共享地表', color: '#e3dfbd' });
  }
  for (const bi of active) {
    const biome = biomeCatalog[bi],
      values = fields[bi];
    const sources = visible.filter((r) => r.biome === biome.id);
    const feather = Math.min(
      biome.id === 'water' ? 9 : 18,
      Math.max(4, Math.min(...sources.map((r) => r.width)) * 0.14),
    );
    // Nested contours build a soft transition with a fully covered interior. There
    // are no per-stroke borders, and only the final terrain owns its decorations.
    const levels = [-feather, -feather * 0.42, feather * 0.15, feather * 0.62];
    const water = biome.id === 'water';
    const coreAlpha = {
      grass: 0.16,
      forest: 0.38,
      mountain: 0.22,
      desert: 0.35,
      swamp: 0.32,
      snow: 0.8,
      water: 1,
      hill: 0.24,
      plateau: 0.3,
      taiga: 0.4,
      rainforest: 0.43,
      savanna: 0.28,
      tundra: 0.34,
      badlands: 0.35,
    }[biome.id];
    const opacities = water ? [0.12, 0.26, 0.46, 1] : [0.045, 0.09, 0.15, coreAlpha];
    levels.forEach((level, i) =>
      addContours(bi, `edge${i}`, (p) => sample(values, p) - level, {
        color: biome.color,
        opacity: opacities[i],
        blur: water ? 1.2 : Math.max(3, feather * 0.4),
      }),
    );
    const seed = sources[0].seed;
    addContours(
      bi,
      'shade',
      (p) =>
        Math.min(
          sample(values, p) - feather,
          noise(p.x / 57, p.y / 57, seed) * 22 + noise(p.x / 23, p.y / 23, seed ^ 197) * 7 - 6,
        ),
      {
        color: biome.id === 'water' ? '#507f87' : biome.id === 'snow' ? '#97b1ad' : '#71845b',
        opacity: 0.07,
        blur: 3,
      },
    );
    if (biome.id === 'water') {
      // A fine inner shore line follows the shared water body, including bays.
      addContours(bi, 'shore', (p) => sample(values, p) - 1.5, {
        color: 'none',
        stroke: '#678f8b',
        strokeWidth: 0.7,
        opacity: 0.5,
      });
    }
    const basePitch = {
      water: 34,
      grass: 34,
      forest: 15,
      mountain: 25,
      desert: 28,
      swamp: 22,
      snow: 30,
      hill: 30,
      plateau: 34,
      taiga: 18,
      rainforest: 15,
      savanna: 37,
      tundra: 35,
      badlands: 27,
    }[biome.id];
    const pitch = basePitch * Math.max(0.8, Math.min(2, Math.min(width, height) / 640));
    let count = 0;
    for (let gy = 0; gy < Math.ceil(height / pitch); gy++)
      for (let gx = 0; gx < Math.ceil(width / pitch); gx++) {
        const random = seededRandom(hash(`${biome.id}:${gx}:${gy}`));
        const p = point((gx + 0.2 + random() * 0.6) * pitch, (gy + 0.2 + random() * 0.6) * pitch);
        if (p.x > width || p.y > height) continue;
        const depth = sample(values, p);
        if (depth < 5) continue;
        const own = owner[Math.round(p.y / dy) * (nx + 1) + Math.round(p.x / dx)],
          region = visible[own];
        if (!region || region.biome !== biome.id || region.density === 0) continue;
        const local = seededRandom(hash(`${region.seed}:${gx}:${gy}`));
        const cluster = 0.68 + noise(p.x / 48, p.y / 48, region.seed) * 0.5;
        const density =
          region.density * (biome.id === 'grass' ? 0.5 : biome.id === 'forest' ? 1.2 : 1);
        if (
          local() > density * cluster ||
          count >= Math.min(1500, sources.length * MAP_EDITOR_LIMITS.symbolsPerRegion)
        )
          continue;
        if (biome.id === 'water') {
          if (depth < 12) continue;
          decor.push(
            makeObject(
              source,
              `decor_water_${gx}_${gy}`,
              'path',
              [
                point(p.x - 5, p.y),
                point(p.x - 2, p.y - 1),
                point(p.x + 2, p.y - 1),
                point(p.x + 5, p.y),
              ],
              { name: '水面 · 细浪', stroke: '#638f96', strokeWidth: 0.75, opacity: 0.4 },
            ),
          );
          count++;
          continue;
        }
        const choices = biomeSymbols[biome.id];
        let symbol =
          choices[Math.min(choices.length - 1, Math.floor(local() ** 1.8 * choices.length))];
        let size =
          biome.id === 'mountain'
            ? 30 + local() * 13
            : biome.id === 'forest'
              ? 17 + local() * 8
              : 17 + local() * 9;
        if (biome.id === 'mountain' && region.geometry === 'brush') {
          const distance = boundaryDistance(p, region.points, false);
          const ridge = 1 - clamp(distance / (region.width * 0.5), 0, 1);
          if (local() > ridge * 0.75 + 0.2) continue;
          symbol = ridge > 0.35 ? 'mountain' : 'hill';
          size *= 0.7 + ridge * 0.5;
        }
        const radius = size * 0.57;
        if (
          depth < radius ||
          p.x < radius ||
          p.x > width - radius ||
          p.y < radius ||
          p.y > height - radius
        )
          continue;
        const definition = symbolCatalog.find((item) => item.id === symbol)!;
        decor.push(
          makeObject(source, `decor_${biome.id}_${gx}_${gy}`, 'symbol', [p], {
            name: `${biome.label} · ${definition.label}`,
            symbol,
            size: round(size),
            color: definition.color,
            stroke: '#61725a',
            strokeWidth: 0.65,
            opacity: 0.82 + local() * 0.15,
          }),
        );
        count++;
      }
  }
  const result = [...surfaces, ...decor.sort((a, b) => a.points[0].y - b.points[0].y)];
  if (result.length > MAP_EDITOR_LIMITS.objects)
    throw new Error('地形细节超过 8000 个组件，请降低密度或减少碎片。');
  return result;
}

export function sampleCurve(
  points: MapPoint[],
  closed: boolean,
  width: number,
  height: number,
): MapPoint[] {
  if (points.length < 3)
    return points.map((p) => point(clamp(p.x, 0, width), clamp(p.y, 0, height)));
  const result: MapPoint[] = [];
  for (let i = 0; i < (closed ? points.length : points.length - 1); i++) {
    const p0 = points[closed ? (i - 1 + points.length) % points.length : Math.max(0, i - 1)];
    const p1 = points[i],
      p2 = points[(i + 1) % points.length];
    const p3 = points[closed ? (i + 2) % points.length : Math.min(points.length - 1, i + 2)];
    for (let j = 0; j < 4; j++) {
      const t = j / 4,
        t2 = t * t,
        t3 = t2 * t;
      const coordinate = (key: 'x' | 'y') =>
        0.5 *
        (2 * p1[key] +
          (-p0[key] + p2[key]) * t +
          (2 * p0[key] - 5 * p1[key] + 4 * p2[key] - p3[key]) * t2 +
          (-p0[key] + 3 * p1[key] - 3 * p2[key] + p3[key]) * t3);
      result.push(point(clamp(coordinate('x'), 0, width), clamp(coordinate('y'), 0, height)));
    }
  }
  if (!closed) result.push({ ...points[points.length - 1] });
  return result;
}

function parseCurve(path: string, width: number, height: number): MapPoint[] {
  const tokens = path.match(/[MCZ]|-?\d+(?:\.\d+)?/g) || [];
  const result: MapPoint[] = [];
  let cursor = point(0, 0),
    i = 0;
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === 'M') {
      cursor = point(+tokens[i++], +tokens[i++]);
      result.push(cursor);
    } else if (command === 'C') {
      const a = point(+tokens[i++], +tokens[i++]),
        b = point(+tokens[i++], +tokens[i++]),
        c = point(+tokens[i++], +tokens[i++]);
      for (let j = 1; j <= 4; j++) {
        const t = j / 4,
          u = 1 - t;
        result.push(
          point(
            clamp(
              u ** 3 * cursor.x + 3 * u * u * t * a.x + 3 * u * t * t * b.x + t ** 3 * c.x,
              0,
              width,
            ),
            clamp(
              u ** 3 * cursor.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t ** 3 * c.y,
              0,
              height,
            ),
          ),
        );
      }
      cursor = c;
    }
  }
  return cleanPoints(result);
}

/** Preserve authored data and layer order; legacy curves / glyphs become editable approximations.
 * Decorative SVG patterns are not reconstructed. Capacity errors never truncate authored content.
 */
export function bakeMapArtwork(map: AtlasMap): MapObject[] {
  const editor = map.editor ?? createEditorData();
  if (
    editor.regions.length > MAP_EDITOR_LIMITS.regions ||
    editor.objects.length > MAP_EDITOR_LIMITS.objects
  )
    throw new Error('地图超过编辑容量，请先减少区域或对象数量。');
  const objects: MapObject[] = [];
  const source = `base_${map.id}`;
  const add = (
    suffix: string,
    kind: MapObject['kind'],
    points: MapPoint[],
    changes: Partial<MapObject>,
  ) => objects.push(makeObject(source, suffix, kind, points, changes));
  const path = (
    suffix: string,
    name: string,
    points: MapPoint[],
    stroke: string,
    strokeWidth: number,
    opacity = 1,
  ) => {
    if (points.length >= 2) add(suffix, 'path', points, { name, stroke, strokeWidth, opacity });
  };
  if (editor.baseVisible) {
    const town = map.kind === 'town',
      blank = map.seed === 0;
    add(
      'background',
      'polygon',
      [point(0, 0), point(map.width, 0), point(map.width, map.height), point(0, map.height)],
      { name: '底图背景', color: town || blank ? '#e9e4d2' : '#d9e3db' },
    );
    const terrain = generateTerrain(map.seed, map.width, map.height, map.kind, map.scaleKm);
    terrain.land.forEach((land, i) => {
      const coast = sampleCurve(land.points, true, map.width, map.height);
      add(`land_${i}`, 'polygon', coast, {
        name: `大陆 ${i + 1}`,
        color: '#e8e2c9',
        stroke: '#7f9682',
        strokeWidth: 1.4,
      });
      land.elevation.forEach((curve, j) =>
        add(`elevation_${i}_${j}`, 'polygon', parseCurve(curve, map.width, map.height), {
          name: `大陆 ${i + 1} · 等高区域 ${j + 1}`,
          color: j ? '#c7c9a6' : '#d7d5b5',
          opacity: j ? 0.23 : 0.36,
          stroke: '#a0aa83',
          strokeWidth: 0.7,
        }),
      );
    });
    if (terrain.wall.length)
      add('wall', 'polygon', sampleCurve(terrain.wall, true, map.width, map.height), {
        name: '城墙',
        color: '#ddd7bd',
        stroke: '#8d977f',
        strokeWidth: 6,
        opacity: 0.75,
      });
    terrain.rivers.forEach((river, i) => {
      let points = sampleCurve(river, false, map.width, map.height);
      if (!town) {
        const firstOutside = points.findIndex(
          (p) => !terrain.land.some((land) => pointInPolygon(p, land.points)),
        );
        if (firstOutside >= 0) points = points.slice(0, Math.max(2, firstOutside));
      }
      path(`river_${i}`, `河流 ${i + 1}`, points, '#96b8af', town ? 26 : 3.8);
      path(`river_light_${i}`, `河流 ${i + 1} · 水面`, points, '#c2d6ca', town ? 18 : 1.8);
    });
    terrain.roads.forEach((road, i) => {
      const points = sampleCurve(road, false, map.width, map.height);
      path(`road_border_${i}`, `道路 ${i + 1} · 边缘`, points, '#c2b599', 12);
      path(`road_${i}`, `道路 ${i + 1}`, points, '#ede5cb', 8);
    });
    terrain.blocks.forEach((block, i) => {
      add(
        `block_${i}`,
        'polygon',
        block.points.map((p) => ({ ...p })),
        {
          name: `建筑 ${i + 1}`,
          color: block.shade > 0.6 ? '#929b81' : block.shade > 0.3 ? '#b0ae90' : '#c4baa0',
          stroke: '#777e66',
          strokeWidth: 1,
        },
      );
      path(
        `roof_${i}`,
        `建筑 ${i + 1} · 屋脊`,
        [block.points[0], block.points[2]].map((p) => ({ ...p })),
        '#7f866e',
        0.7,
        0.7,
      );
    });
    // Legacy glyphs use size / 10. Editable glyphs use size / 32 and have a
    // different native height: preserve the overall tree / mountain height.
    terrain.symbols.forEach((symbol, i) =>
      add(`symbol_${i}`, 'symbol', [point(symbol.x, symbol.y)], {
        name: symbol.kind === 'tree' ? '底图树木' : '底图山峰',
        symbol: symbol.kind === 'tree' ? 'pine' : 'mountain',
        color: symbol.kind === 'tree' ? (symbol.shade > 0.5 ? '#6c8965' : '#8c9e74') : '#b7b89b',
        stroke: '#5c7a59',
        strokeWidth: 0.7,
        size: symbol.size * 3.2 * (symbol.kind === 'tree' ? 20 / 28 : 22 / 25),
        opacity: symbol.kind === 'tree' ? 0.5 + symbol.shade * 0.25 : 0.85,
      }),
    );
    if (!blank)
      add('label', 'text', [point(map.width * 0.77, map.height * 0.79)], {
        name: '底图地名',
        text: town ? 'THE OLD QUARTER' : 'THE WHISPERING SEA',
        color: '#678176',
        size: 17,
        opacity: 0.65,
      });
  }
  // Only adapt newly generated legacy base art, never existing authored objects.
  for (let i = 0; i < objects.length; i++) objects[i] = parchmentObject(objects[i]);
  // Preserve the live layer order when converting again. Frozen base objects
  // stay below new terrain; hand-placed detail and ink remain above that terrain.
  objects.push(...structuredClone(editor.objects.filter((object) => object.layer === 'base')));
  objects.push(
    ...(editor.generation
      ? (
          editor.generated?.objects ??
          generateSketchMap(
            editor.regions,
            map.width,
            map.height,
            editor.generation,
            map.scaleKm,
            map.kind,
          ).objects
        ).map((object) => ({
          ...(editor.generation?.version === 1 ? parchmentObject(object) : object),
          id: stableId(map.id, object.id),
        }))
      : composeTerrainRegions(editor.regions, map.width, map.height).map(parchmentObject)),
  );
  // Hidden authoring is still content. Freeze it separately as hidden vectors so
  // converting the visible composition never silently discards those regions.
  for (const region of editor.regions.filter((region) => !region.visible)) {
    const hidden = composeTerrainRegions([{ ...region, visible: true }], map.width, map.height);
    objects.push(
      ...hidden.map((object) => ({
        ...parchmentObject(object),
        visible: false,
        locked: region.locked,
        name: `${region.name}（隐藏）· ${object.name}`,
      })),
    );
  }
  objects.push(...structuredClone(editor.objects.filter((object) => object.layer !== 'base')));
  map.strokes.forEach((stroke) => {
    const points = stroke.points.map((p) =>
      point(clamp(p.x, 0, map.width), clamp(p.y, 0, map.height)),
    );
    if (!points.length) return;
    if (points.length === 1)
      points.push(point(points[0].x > 0 ? points[0].x - 0.001 : 0.001, points[0].y));
    if (stroke.tool === 'road')
      objects.push(
        makeObject(
          stroke.id,
          'border',
          'path',
          points.map((p) => ({ ...p })),
          { name: '原手绘道路 · 边缘', stroke: '#f4ebd7', strokeWidth: stroke.width + 3 },
        ),
      );
    objects.push({
      ...makeObject(stroke.id, 'stroke', 'path', points, {
        name:
          stroke.tool === 'river'
            ? '原手绘河流'
            : stroke.tool === 'road'
              ? '原手绘道路'
              : '原手绘笔画',
        stroke: stroke.color,
        strokeWidth: stroke.width,
      }),
      ...(stroke.tool === 'road' ? { id: stroke.id } : {}),
    });
  });
  if (objects.length > MAP_EDITOR_LIMITS.objects)
    throw new Error(
      `转换后有 ${objects.length} 个对象，超过 8000 个上限；请先减少区域或图章密度。`,
    );
  const ids = new Set<string>();
  for (const object of objects) {
    if (object.points.length > MAP_EDITOR_LIMITS.points)
      throw new Error(`「${object.name}」超过 2000 个顶点，未执行转换。`);
    let candidate = object.id,
      suffix = 1;
    while (ids.has(candidate)) candidate = `${object.id.slice(0, 90)}_${suffix++}`;
    object.id = candidate;
    object.layer = 'base';
    ids.add(candidate);
  }
  return objects;
}
