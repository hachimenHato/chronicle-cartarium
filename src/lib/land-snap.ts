import {
  DIVISION_LIMITS,
  type DivisionPaint,
  type MapPoint,
  type MapRegion,
  type MapObject,
} from '../../shared/cartography';
import { makeId, type AtlasMap } from '../../shared/model';
import { joinContours, regionContours } from './cartography';
import { pointInPolygon } from './terrain';

const distance = (a: MapPoint, b: MapPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const equal = (a: MapPoint, b: MapPoint) => distance(a, b) < 0.00001;
type Segment = { a: MapPoint; b: MapPoint; ring: number; index: number; length: number };
type Hit = { point: MapPoint; segment: Segment; t: number; distance: number };

/** Prefer the exact rendered coast; frozen legacy maps retain their mainland polygons. */
export function coastlinesFromObjects(objects: MapObject[]) {
  const exact = objects.filter((o) => o.visible && o.name === '沿岸浅海');
  const outlines = exact.length
    ? exact
    : objects.filter(
        (o) =>
          o.visible &&
          o.kind === 'polygon' &&
          (o.name === '陆地 · 共享地表' || o.name === '大陆' || /^大陆 \d+$/.test(o.name)),
      );
  return outlines.map((o) => o.points);
}

/** Undo the zero-area bridges used by editable compound polygons. */
export function splitClosedRings(points: MapPoint[]) {
  const stack: MapPoint[] = [],
    rings: MapPoint[][] = [];
  const positions = new Map<string, number>();
  const key = (p: MapPoint) => `${p.x}:${p.y}`;
  for (const p of [...points, points[0]].filter(Boolean)) {
    const at = positions.get(key(p));
    if (at !== undefined) {
      const cycle = stack.slice(at);
      if (cycle.length >= 3) rings.push(cycle);
      stack.splice(at + 1).forEach((q) => positions.delete(key(q)));
    } else {
      positions.set(key(p), stack.length);
      stack.push(p);
    }
  }
  return rings;
}

/** A spatial index makes nearest-coast queries independent of the full terrain grid. */
export function coastIndex(input: MapPoint[][], width: number, height: number) {
  const rings = input.filter((r) => r.length >= 3).flatMap(splitClosedRings);
  const segments: Segment[] = [],
    bins = new Map<string, Segment[]>();
  const size = Math.max(8, Math.min(width, height) / 40);
  const frame = (a: MapPoint, b: MapPoint) =>
    (a.x === b.x && (a.x === 0 || a.x === width)) || (a.y === b.y && (a.y === 0 || a.y === height));
  rings.forEach((ring, ri) =>
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length],
        length = distance(a, b);
      if (length < 0.00001 || frame(a, b)) return;
      const s = { a, b, ring: ri, index: i, length };
      segments.push(s);
      for (
        let y = Math.floor(Math.min(a.y, b.y) / size);
        y <= Math.floor(Math.max(a.y, b.y) / size);
        y++
      )
        for (
          let x = Math.floor(Math.min(a.x, b.x) / size);
          x <= Math.floor(Math.max(a.x, b.x) / size);
          x++
        ) {
          const key = `${x}:${y}`;
          const bin = bins.get(key);
          if (bin) bin.push(s);
          else bins.set(key, [s]);
        }
    }),
  );
  function nearest(p: MapPoint, limit: number): Hit | undefined {
    if (!(limit >= 0)) return;
    const x0 = Math.floor((p.x - limit) / size),
      x1 = Math.floor((p.x + limit) / size);
    const y0 = Math.floor((p.y - limit) / size),
      y1 = Math.floor((p.y + limit) / size);
    const candidates = new Set<Segment>();
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > segments.length) segments.forEach((s) => candidates.add(s));
    else
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) bins.get(`${x}:${y}`)?.forEach((s) => candidates.add(s));
    let found: Hit | undefined;
    for (const s of candidates) {
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p.x - s.a.x) * (s.b.x - s.a.x) + (p.y - s.a.y) * (s.b.y - s.a.y)) / s.length ** 2,
        ),
      );
      const point = { x: s.a.x + t * (s.b.x - s.a.x), y: s.a.y + t * (s.b.y - s.a.y) };
      const d = distance(p, point);
      if (d <= limit && (!found || d < found.distance))
        found = { point, segment: s, t, distance: d };
    }
    return found;
  }
  return { rings, nearest };
}

function perpendicular(p: MapPoint, a: MapPoint, b: MapPoint) {
  const length = distance(a, b);
  if (!length) return distance(p, a);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length ** 2),
  );
  return distance(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
}
function simplifyOpen(points: MapPoint[], tolerance: number): MapPoint[] {
  if (points.length < 3) return points;
  let max = tolerance,
    at = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicular(points[i], points[0], points.at(-1)!);
    if (d > max) {
      max = d;
      at = i;
    }
  }
  return at < 0
    ? [points[0], points.at(-1)!]
    : [
        ...simplifyOpen(points.slice(0, at + 1), tolerance).slice(0, -1),
        ...simplifyOpen(points.slice(at), tolerance),
      ];
}
function simplifyRing(points: MapPoint[], tolerance: number) {
  let at = 1;
  for (let i = 2; i < points.length; i++)
    if (distance(points[0], points[i]) > distance(points[0], points[at])) at = i;
  return [
    ...simplifyOpen(points.slice(0, at + 1), tolerance).slice(0, -1),
    ...simplifyOpen([...points.slice(at), points[0]], tolerance).slice(0, -1),
  ];
}
function simpleRing(points: MapPoint[]) {
  const area = points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length];
    return sum + a.x * b.y - a.y * b.x;
  }, 0);
  if (Math.abs(area) < 0.01) return false;
  const cross = (a: MapPoint, b: MapPoint, c: MapPoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let i = 0; i < points.length; i++)
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const a = points[i],
        b = points[(i + 1) % points.length],
        c = points[j],
        d = points[(j + 1) % points.length];
      if (
        cross(a, b, c) * cross(a, b, d) < -0.000001 &&
        cross(c, d, a) * cross(c, d, b) < -0.000001
      )
        return false;
    }
  return true;
}

/** Convert only edited strokes to precise polygons, retaining their ownership order and holes. */
export function snapDivisionToLand(
  map: AtlasMap,
  divisionId: string,
  coastlines: MapPoint[][],
  limit: number,
) {
  if (!Number.isFinite(limit) || limit < 0 || limit > Math.max(map.width, map.height))
    throw new Error('请输入有效的最大吸附距离。');
  const coast = coastIndex(coastlines, map.width, map.height);
  if (!coast.rings.length) throw new Error('没有可用的陆地边缘，请先生成地形。');
  const scale = Math.max(map.width, map.height) / 1000;
  let moved = 0,
    changed = 0;
  const next = (map.editor?.divisionPaint ?? []).flatMap((stroke): DivisionPaint[] => {
    if (stroke.divisionId !== divisionId || !limit) return [stroke];
    const source =
      stroke.geometry === 'polygon' && stroke.roughness === 0
        ? splitClosedRings(stroke.points)
        : regionContours(
            {
              ...stroke,
              name: '',
              biome: 'grass',
              density: 0,
              visible: true,
              locked: false,
            } as MapRegion,
            map.width,
            map.height,
          );
    let strokeMoved = 0;
    const snapped = source.map((ring) => {
      const samples: MapPoint[] = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length];
        const steps = Math.max(
          1,
          Math.ceil(distance(a, b) / Math.max(2, Math.min(8 * scale, limit / 2))),
        );
        if (samples.length + steps > DIVISION_LIMITS.totalPoints)
          throw new Error('边界采样过于复杂，请分段圈选后吸附。');
        for (let j = 0; j < steps; j++)
          samples.push({ x: a.x + ((b.x - a.x) * j) / steps, y: a.y + ((b.y - a.y) * j) / steps });
      }
      const hits = samples.map((p) => coast.nearest(p, limit));
      const result: MapPoint[] = [];
      samples.forEach((p, i) => {
        const a = hits[i],
          b = hits[(i + 1) % samples.length];
        result.push(a?.point ?? p);
        if (a && a.distance > 0.01) strokeMoved++;
        if (!a || !b || a.segment.ring !== b.segment.ring) return;
        const shoreline = coast.rings[a.segment.ring],
          n = shoreline.length;
        // Follow the short coastal arc rather than a chord across a bay. Do not
        // bridge opposite banks or travel along an unrelated distant peninsula.
        const walk = (direction: 1 | -1): MapPoint[] | undefined => {
          if (a.segment.index === b.segment.index) return [];
          const arc: MapPoint[] = [];
          let k = direction === 1 ? (a.segment.index + 1) % n : a.segment.index;
          const end = direction === 1 ? (b.segment.index + 1) % n : b.segment.index;
          while (k !== end) {
            if (arc.length >= 64) return;
            arc.push(shoreline[k]);
            k = (k + direction + n) % n;
          }
          return arc;
        };
        const forward = walk(1),
          backward = walk(-1);
        const length = (arc: MapPoint[] | undefined) => {
          if (!arc) return Infinity;
          let sum = 0,
            prev = a.point;
          for (const point of [...arc, b.point]) {
            sum += distance(prev, point);
            prev = point;
          }
          return sum;
        };
        const arc = length(forward) <= length(backward) ? forward : backward;
        if (
          arc &&
          length(arc) <= distance(p, samples[(i + 1) % samples.length]) * 3 + limit &&
          arc.every((point) => perpendicular(point, p, samples[(i + 1) % samples.length]) <= limit)
        )
          result.push(...arc);
      });
      const cleaned = result.filter((p, i) => !i || !equal(p, result[i - 1]));
      if (cleaned.length && equal(cleaned[0], cleaned.at(-1)!)) cleaned.pop();
      return cleaned;
    });
    if (!strokeMoved) return [stroke];
    let polygons: MapPoint[][] = [];
    for (const tolerance of [0.2, 0.5, 0.9, 1.25]) {
      const rings = snapped.map((r) => simplifyRing(r, tolerance * scale));
      if (rings.some((r) => r.length < 3 || !simpleRing(r)))
        throw new Error('吸附后边界会交叉或坍缩，请减小距离再试；原范围已保留。');
      // Keep holes and disconnected islands in their original containment hierarchy.
      for (let i = 0; i < source.length; i++)
        for (let j = 0; j < i; j++)
          if (pointInPolygon(source[i][0], source[j]) !== pointInPolygon(rings[i][0], rings[j]))
            throw new Error('吸附会改变飞地或孔洞结构，请减小距离再试。');
      polygons = joinContours(rings);
      if (polygons.every((r) => r.length <= DIVISION_LIMITS.points)) break;
    }
    if (polygons.some((r) => r.length > DIVISION_LIMITS.points))
      throw new Error('这片边界过于复杂，请分段圈选后吸附；原范围已保留。');
    moved += strokeMoved;
    changed++;
    return polygons.map((points, i) => ({
      ...stroke,
      id: i ? makeId('border') : stroke.id,
      geometry: 'polygon',
      roughness: 0,
      points,
    }));
  });
  if (
    next.length > DIVISION_LIMITS.strokes ||
    next.reduce((sum, s) => sum + s.points.length, 0) > DIVISION_LIMITS.totalPoints
  )
    throw new Error('吸附后超出分区容量，请减少不需要的笔迹再试；原范围已保留。');
  return { paints: next, moved, changed };
}
