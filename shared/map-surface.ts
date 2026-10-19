import type { MapPoint } from './cartography';

/** The fine height surface is authoritative for coastlines and navigation. */
export interface MapSurface {
  columns: number;
  rows: number;
  width: number;
  height: number;
  values: ArrayLike<number>;
}

export function sampleMapSurface(field: MapSurface, point: MapPoint): number {
  const x = Math.max(0, Math.min(field.columns - 1, (point.x / field.width) * field.columns - 0.5));
  const y = Math.max(0, Math.min(field.rows - 1, (point.y / field.height) * field.rows - 0.5));
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const x1 = Math.min(field.columns - 1, x0 + 1),
    y1 = Math.min(field.rows - 1, y0 + 1);
  const tx = x - x0,
    ty = y - y0;
  return (
    (field.values[y0 * field.columns + x0] * (1 - tx) +
      field.values[y0 * field.columns + x1] * tx) *
      (1 - ty) +
    (field.values[y1 * field.columns + x0] * (1 - tx) +
      field.values[y1 * field.columns + x1] * tx) *
      ty
  );
}

export function isWaterPoint(field: MapSurface, point: MapPoint, seaLevel = 0): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x <= field.width &&
    point.y <= field.height &&
    sampleMapSurface(field, point) <= seaLevel
  );
}

/**
 * A line through a bilinear grid tile has quadratic height. Split at every tile
 * boundary and check its exact maximum, including interior extrema. Checking
 * just endpoints or a few fractional samples can miss small islands.
 */
export function isWaterSegment(field: MapSurface, a: MapPoint, b: MapPoint, seaLevel = 0): boolean {
  if (!isWaterPoint(field, a, seaLevel) || !isWaterPoint(field, b, seaLevel)) return false;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const cuts = [0, 1];
  const cross = (start: number, delta: number, extent: number, count: number) => {
    if (Math.abs(delta) < 1e-12) return;
    const low = (Math.min(start, start + delta) / extent) * count - 0.5;
    const high = (Math.max(start, start + delta) / extent) * count - 0.5;
    for (let i = Math.max(0, Math.ceil(low)); i <= Math.min(count - 1, Math.floor(high)); i++) {
      const t = (((i + 0.5) / count) * extent - start) / delta;
      if (t > 1e-12 && t < 1 - 1e-12) cuts.push(t);
    }
  };
  cross(a.x, dx, field.width, field.columns);
  cross(a.y, dy, field.height, field.rows);
  cuts.sort((x, y) => x - y);
  const at = (t: number) => sampleMapSurface(field, { x: a.x + dx * t, y: a.y + dy * t });
  for (let i = 1; i < cuts.length; i++) {
    const lo = cuts[i - 1],
      hi = cuts[i];
    if (hi - lo < 1e-12) continue;
    const h0 = at(lo),
      h1 = at(hi),
      hm = at((lo + hi) / 2);
    if (Math.max(h0, h1, hm) > seaLevel + 1e-7) return false;
    const q = 2 * (h0 + h1 - 2 * hm),
      linear = h1 - h0 - q;
    if (q < -1e-12) {
      const t = -linear / (2 * q);
      if (t > 0 && t < 1 && h0 + linear * t + q * t * t > seaLevel + 1e-7) return false;
    }
  }
  return true;
}
