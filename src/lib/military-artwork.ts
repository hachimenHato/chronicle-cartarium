import type { MapPoint } from '../../shared/cartography';
import type { MapMilitaryLine } from '../../shared/generated-map';
import { linePath } from './terrain';

const distance = (a: MapPoint, b: MapPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const number = (v: number) => Number(v.toFixed(2));
const point = (p: MapPoint) => `${number(p.x)},${number(p.y)}`;
const mix = (a: MapPoint, b: MapPoint, t: number): MapPoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** Artwork is derived only. In particular, a front's stored shared-edge path is never smoothed. */
function cleanPoints(points: MapPoint[]) {
  return points.filter(
    (p, i) =>
      Number.isFinite(p.x) && Number.isFinite(p.y) && (!i || distance(p, points[i - 1]) > 0.01),
  );
}
function smoothPoints(points: MapPoint[]) {
  if (points.length < 3) return points;
  // Rounded corners stay within the author's polyline neighbourhood instead of overshooting it.
  let result = points;
  for (let pass = 0; pass < 2; pass++) {
    const next = [result[0]];
    for (let i = 0; i < result.length - 1; i++) {
      next.push(mix(result[i], result[i + 1], 0.25), mix(result[i], result[i + 1], 0.75));
    }
    next.push(result.at(-1)!);
    result = next;
    if (result.length > 4096) break;
  }
  return result;
}
function lengths(points: MapPoint[]) {
  const values = [0];
  for (let i = 1; i < points.length; i++)
    values.push(values[i - 1] + distance(points[i - 1], points[i]));
  return values;
}
function sample(points: MapPoint[], values: number[], at: number) {
  let lo = 1,
    hi = values.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] < at) lo = mid + 1;
    else hi = mid;
  }
  const i = lo;
  const a = points[i - 1],
    b = points[i],
    segment = values[i] - values[i - 1];
  const tangent =
    segment > 0 ? { x: (b.x - a.x) / segment, y: (b.y - a.y) / segment } : { x: 1, y: 0 };
  return {
    ...mix(a, b, Math.max(0, Math.min(1, (at - values[i - 1]) / Math.max(segment, 0.001)))),
    tangent,
  };
}
function offset(p: MapPoint & { tangent: MapPoint }, amount: number): MapPoint {
  return { x: p.x - p.tangent.y * amount, y: p.y + p.tangent.x * amount };
}

export interface MilitaryArtworkGeometry {
  centerline: string;
  ribbon?: string;
  arrowhead?: string;
  marks: { path: string; tip: MapPoint; base: MapPoint }[];
}

/** Original planning marks inspired by battle-plan cartography, not a standards implementation. */
export function buildMilitaryArtwork(line: MapMilitaryLine): MilitaryArtworkGeometry {
  const raw = cleanPoints(line.points);
  const empty: MilitaryArtworkGeometry = { centerline: '', marks: [] };
  if (raw.length < 2) return empty;
  const points = line.kind === 'front' ? raw : smoothPoints(raw);
  const values = lengths(points),
    total = values.at(-1)!;
  if (total < 0.01) return empty;
  const width = Math.max(0.1, line.width);
  const geometry: MilitaryArtworkGeometry = { centerline: linePath(points), marks: [] };
  if (line.kind === 'advance') {
    const headLength = Math.min(total * 0.4, width * 13);
    const neckAt = total - headLength;
    const shaftWidth = Math.min(width * 2.6, total * 0.075);
    const headWidth = Math.min(width * 6.2, headLength * 0.53);
    const samples = Math.max(8, Math.min(512, Math.ceil(neckAt / Math.max(width, total / 200))));
    const left: MapPoint[] = [],
      right: MapPoint[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples,
        p = sample(points, values, neckAt * t);
      const half = shaftWidth * (0.24 + 0.76 * Math.sin((t * Math.PI) / 2));
      left.push(offset(p, -half));
      right.push(offset(p, half));
    }
    const neck = sample(points, values, neckAt),
      tip = points.at(-1)!;
    geometry.ribbon = `${linePath(left)} L${point(offset(neck, -headWidth))} L${point(tip)} L${point(offset(neck, headWidth))} ${right
      .reverse()
      .map((p) => `L${point(p)}`)
      .join(' ')} Z`;
  } else if (line.kind === 'retreat') {
    const end = sample(points, values, total),
      behind = Math.min(width * 7, total * 0.45);
    const base = { ...end, x: end.x - end.tangent.x * behind, y: end.y - end.tangent.y * behind };
    geometry.arrowhead = `M${point(offset(base, -behind * 0.44))} L${point(end)} L${point(offset(base, behind * 0.44))}`;
  } else {
    const spacing = Math.max(width * (line.kind === 'defense' ? 10 : 14), total / 96);
    const height = Math.min(width * (line.kind === 'defense' ? 4.5 : 2.6), spacing * 0.42);
    for (let at = spacing * 0.5; at < total - spacing * 0.25; at += spacing) {
      const p = sample(points, values, at),
        tip = offset(p, height);
      const half = line.kind === 'defense' ? height * 0.66 : 0;
      const a = { x: p.x - p.tangent.x * half, y: p.y - p.tangent.y * half };
      const b = { x: p.x + p.tangent.x * half, y: p.y + p.tangent.y * half };
      geometry.marks.push({
        path:
          line.kind === 'defense'
            ? `M${point(a)} L${point(tip)} L${point(b)} Z`
            : `M${point(p)} L${point(tip)}`,
        tip,
        base: { x: p.x, y: p.y },
      });
    }
  }
  return geometry;
}
