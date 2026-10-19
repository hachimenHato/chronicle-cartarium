import type { MapPoint } from '../../shared/cartography';

const distance = (a: MapPoint, b: MapPoint) => Math.hypot(b.x - a.x, b.y - a.y);
const smooth = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};

/** Curve a routing skeleton at map scale, with fixed junctions and checked land corridors.
 * Every source anchor keeps its index, so widths, bridges and shared road nodes stay aligned.
 * This is cartographic linework, not a simulation of erosion or sediment transport.
 */
export function softenRoute(
  source: MapPoint[],
  options: {
    scale: number;
    seed: number;
    kind: 'river' | 'road';
    pinned: ReadonlySet<number>;
    allowed: (a: MapPoint, b: MapPoint) => boolean;
    strength?: (index: number) => number;
    allowedPoint?: (point: MapPoint, index: number) => boolean;
  },
): MapPoint[] {
  if (source.length < 3) return source.map((p) => ({ ...p }));
  const { scale, kind, seed, pinned, allowed } = options;
  const lengths = [0];
  for (let i = 1; i < source.length; i++)
    lengths.push(lengths[i - 1] + distance(source[i - 1], source[i]));
  const total = lengths[lengths.length - 1];
  if (!total) return source.map((p) => ({ ...p }));
  const fixed = new Set([0, source.length - 1, ...pinned]);
  const anchors = [...fixed].sort((a, b) => a - b);
  const spans = source.map(() => ({ start: 0, length: total }));
  for (let n = 1; n < anchors.length; n++) {
    const start = lengths[anchors[n - 1]];
    const length = lengths[anchors[n]] - start;
    for (let i = anchors[n - 1]; i <= anchors[n]; i++) spans[i] = { start, length };
  }
  const pointAt = (s: number) => {
    s = Math.max(0, Math.min(total, s));
    let low = 0,
      high = lengths.length - 1;
    while (low + 1 < high) {
      const mid = (low + high) >> 1;
      if (lengths[mid] < s) low = mid;
      else high = mid;
    }
    const t = (s - lengths[low]) / (lengths[high] - lengths[low] || 1);
    return {
      x: source[low].x + (source[high].x - source[low].x) * t,
      y: source[low].y + (source[high].y - source[low].y) * t,
    };
  };
  let points = source.map((p) => ({ ...p }));
  const radius = scale * (kind === 'river' ? 2.2 : 3);
  // A physical-distance window removes D8 stair steps, independently of sampling quality.
  const broad = source.map((point, i) => {
    if (fixed.has(i)) return point;
    let x = 0,
      y = 0,
      weight = 0;
    for (let j = -4; j <= 4; j++) {
      const p = pointAt(lengths[i] + (j / 4) * radius);
      const w = 5 - Math.abs(j);
      x += p.x * w;
      y += p.y * w;
      weight += w;
    }
    return { x: x / weight, y: y / weight };
  });
  const phase = ((seed >>> 0) % 65521) * 0.017;
  const wavelength = scale * (kind === 'river' ? 17 : 26);
  const amplitude = scale * (kind === 'river' ? 3.6 : 2.8);
  const proposals = broad.map((base, i) => {
    if (fixed.has(i)) return source[i];
    const s = lengths[i];
    const before = pointAt(s - radius * 1.5),
      after = pointAt(s + radius * 1.5);
    const tangent = distance(before, after) || 1;
    const span = spans[i];
    if (span.length <= 0) return source[i];
    const local = s - span.start;
    // Most real tributaries and road sections are shorter than a whole map-scale
    // wavelength. Fit a broad bend between their actual junctions instead of
    // suppressing the whole segment with a fixed 20-map-unit end taper.
    const taper = smooth(
      Math.min(local, span.length - local) / Math.min(scale * 2.6, span.length * 0.18),
    );
    const localWavelength = Math.min(wavelength, span.length * 1.05);
    const localAmplitude = Math.min(amplitude, span.length * (kind === 'river' ? 0.18 : 0.14));
    const theta =
      (local / localWavelength) * Math.PI * 2 + phase + Math.sin(s / (scale * 29) + phase) * 0.45;
    const wave = Math.sin(theta) * 0.78 + Math.sin(theta * 0.43 + phase * 0.3) * 0.22;
    const offset = wave * localAmplitude * taper * (options.strength?.(i) ?? 1);
    return {
      x: source[i].x + (base.x - source[i].x) * taper - ((after.y - before.y) / tangent) * offset,
      y: source[i].y + (base.y - source[i].y) * taper + ((after.x - before.x) / tangent) * offset,
    };
  });
  const accept = (candidate: MapPoint, i: number) =>
    (!options.allowedPoint || options.allowedPoint(candidate, i)) &&
    allowed(points[i - 1], candidate) &&
    allowed(candidate, points[i + 1]);
  // Backtrack each move against both neighbors: constrained locations keep their safe skeleton.
  for (let i = 1; i < points.length - 1; i++) {
    if (fixed.has(i)) continue;
    for (let fraction = 1; fraction >= 1 / 32; fraction /= 2) {
      const candidate = {
        x: points[i].x + (proposals[i].x - points[i].x) * fraction,
        y: points[i].y + (proposals[i].y - points[i].y) * fraction,
      };
      if (accept(candidate, i)) {
        points[i] = candidate;
        break;
      }
    }
  }
  // Smooth only fine residual corners; long-wave bends are intentionally retained.
  for (let iteration = 0; iteration < 4; iteration++) {
    const previous = points;
    points = points.map((p) => ({ ...p }));
    for (let i = 1; i < points.length - 1; i++) {
      if (fixed.has(i)) continue;
      const candidate = {
        x: (previous[i - 1].x + previous[i].x * 4 + previous[i + 1].x) / 6,
        y: (previous[i - 1].y + previous[i].y * 4 + previous[i + 1].y) / 6,
      };
      if (accept(candidate, i)) points[i] = candidate;
    }
  }
  return points;
}
