import type { ElevationSettings, ElevationStroke, MapPoint } from '../../shared/cartography';
import { MAP_ELEVATION_LIMITS } from '../../shared/cartography';
import type { SketchCell } from './sketch-generation-v1';
import { distanceToSegment } from './terrain';

/** Fictional metres, relative to the selected sea level. Derived, never persisted as grid JSON. */
export interface ElevationField {
  columns: number;
  rows: number;
  width: number;
  height: number;
  values: Float32Array;
  min: number;
  max: number;
}
export const ELEVATION_SCALE = 6000;
/** Derived color-block intent. Templates use it before any explicit height strokes. */
export interface TerrainHeightInfluence {
  land: Float64Array;
  water: Float64Array;
  uplift: Float64Array;
  plateau: Float64Array;
  wetland: Float64Array;
}
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
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
function template(x: number, y: number, settings: ElevationSettings) {
  const { seed, preset } = settings;
  const warpedX = x + (noise(x * 4, y * 4, seed + 11) - 0.5) * 0.14;
  const warpedY = y + (noise(x * 4, y * 4, seed + 23) - 0.5) * 0.14;
  const edge = smooth(Math.min(x, y, 1 - x, 1 - y) / 0.14);
  const broad = noise(warpedX * 4.5, warpedY * 4.5, seed);
  const detail = noise(x * 18, y * 18, seed + 91) - 0.5;
  const ridge = 1 - Math.abs(noise(warpedX * 8, warpedY * 8, seed + 47) * 2 - 1);
  if (preset === 'archipelago')
    return ((broad - 0.49) * 1.8 + (ridge - 0.5) * 0.17 + detail * 0.09) * edge - (1 - edge) * 0.35;
  const radius = Math.hypot((warpedX - 0.5) / 0.52, (warpedY - 0.5) / 0.51);
  const island = 0.6 - radius * 0.8 + (broad - 0.45) * 0.85;
  return (
    (island + ridge ** 4 * (preset === 'highlands' ? 0.63 : 0.28) + detail * 0.055) * edge -
    (1 - edge) * 0.3
  );
}

/** Replay whole strokes once: mouse event frequency must not multiply brush strength. */
export function applyElevationStrokes(
  values: Float64Array,
  columns: number,
  rows: number,
  width: number,
  height: number,
  strokes: ElevationStroke[],
) {
  if (
    strokes.length > MAP_ELEVATION_LIMITS.strokes ||
    strokes.some((s) => !s.points.length || s.points.length > MAP_ELEVATION_LIMITS.points) ||
    strokes.reduce((n, s) => n + s.points.length, 0) > MAP_ELEVATION_LIMITS.totalPoints
  )
    throw new Error('海拔笔迹超过编辑容量，请撤销或清除部分笔迹。');
  const dx = width / columns,
    dy = height / rows;
  for (const stroke of strokes) {
    const radius = stroke.width / 2;
    const xs = stroke.points.map((p) => p.x),
      ys = stroke.points.map((p) => p.y);
    const x0 = Math.max(0, Math.floor((Math.min(...xs) - radius) / dx)),
      x1 = Math.min(columns - 1, Math.ceil((Math.max(...xs) + radius) / dx)),
      y0 = Math.max(0, Math.floor((Math.min(...ys) - radius) / dy)),
      y1 = Math.min(rows - 1, Math.ceil((Math.max(...ys) + radius) / dy));
    // Integral image keeps smoothing cost bounded even with a large brush.
    const integral =
      stroke.operation === 'smooth' ? new Float64Array((columns + 1) * (rows + 1)) : null;
    if (integral)
      for (let y = 0; y < rows; y++) {
        let sum = 0;
        for (let x = 0; x < columns; x++) {
          sum += values[y * columns + x];
          integral[(y + 1) * (columns + 1) + x + 1] = sum + integral[y * (columns + 1) + x + 1];
        }
      }
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const p = { x: (x + 0.5) * dx, y: (y + 0.5) * dy };
        let distance = Math.hypot(p.x - stroke.points[0].x, p.y - stroke.points[0].y);
        for (let j = 1; j < stroke.points.length; j++)
          distance = Math.min(
            distance,
            distanceToSegment(p, stroke.points[j - 1], stroke.points[j]),
          );
        if (distance >= radius) continue;
        const weight = smooth(1 - distance / radius) * stroke.strength,
          i = y * columns + x;
        if (stroke.operation === 'raise' || stroke.operation === 'lower')
          values[i] += (stroke.operation === 'raise' ? 1 : -1) * weight * 1800;
        else if (stroke.operation === 'flatten') values[i] += (stroke.target - values[i]) * weight;
        else if (integral) {
          const rx = Math.max(1, Math.round((radius * 0.25) / dx)),
            ry = Math.max(1, Math.round((radius * 0.25) / dy));
          const left = Math.max(0, x - rx),
            right = Math.min(columns, x + rx + 1),
            top = Math.max(0, y - ry),
            bottom = Math.min(rows, y + ry + 1),
            stride = columns + 1;
          const sum =
            integral[bottom * stride + right] -
            integral[top * stride + right] -
            integral[bottom * stride + left] +
            integral[top * stride + left];
          values[i] += (sum / ((right - left) * (bottom - top)) - values[i]) * weight;
        }
        values[i] = clamp(values[i], -12000, 18000);
      }
  }
}

/** Signed distance from the new coastline; prevents old color-block shores from surviving uplift. */
function coastlineDistance(
  cells: SketchCell[],
  columns: number,
  rows: number,
  dx: number,
  dy: number,
) {
  const d = new Float64Array(cells.length).fill(Math.hypot(columns * dx, rows * dy));
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++) {
      const i = y * columns + x;
      for (const [xx, yy, length] of [
        [x - 1, y, dx],
        [x + 1, y, dx],
        [x, y - 1, dy],
        [x, y + 1, dy],
      ]) {
        if (xx < 0 || yy < 0 || xx >= columns || yy >= rows) continue;
        const j = yy * columns + xx;
        if (cells[j].land !== cells[i].land)
          d[i] = Math.min(
            d[i],
            (length * Math.abs(cells[i].elevation)) /
              Math.max(1e-10, Math.abs(cells[i].elevation) + Math.abs(cells[j].elevation)),
          );
      }
    }
  for (const direction of [1, -1])
    for (let yy = 0; yy < rows; yy++)
      for (let xx = 0; xx < columns; xx++) {
        const x = direction > 0 ? xx : columns - 1 - xx,
          y = direction > 0 ? yy : rows - 1 - yy;
        const i = y * columns + x;
        for (const [ox, oy] of [
          [-direction, 0],
          [0, -direction],
          [-direction, -direction],
          [direction, -direction],
        ]) {
          const nx = x + ox,
            ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
          const j = ny * columns + nx;
          if (cells[i].land === cells[j].land)
            d[i] = Math.min(d[i], d[j] + Math.hypot(ox * dx, oy * dy));
        }
      }
  return Float64Array.from(d, (v, i) => (cells[i].land ? 1 : -1) * Math.max(0.001, v));
}

export function applyElevation(
  cells: SketchCell[],
  field: Float64Array,
  columns: number,
  rows: number,
  width: number,
  height: number,
  settings: ElevationSettings,
  terrain?: TerrainHeightInfluence,
) {
  if (
    settings.preset === 'sketch' &&
    settings.relief === 1 &&
    settings.seaLevel === 0 &&
    !settings.strokes.length
  )
    return;
  const values = Float64Array.from(cells, (c, i) => {
    let base =
      settings.preset === 'sketch' ? c.elevation : template(c.x / width, c.y / height, settings);
    if (settings.preset !== 'sketch' && terrain) {
      // Keep the template's broad relief. Painted ridges add a continuous local
      // height field rather than replacing the template with a flat color patch.
      base += terrain.uplift[i];
      base += (Math.min(base, 0.62) - base) * terrain.plateau[i];
      base += (Math.min(base, 0.18) - base) * terrain.wetland[i];
      // Unpainted space retains the template. Explicit land and water soften
      // toward their edges; later paint takes priority in overlapping areas.
      base += (Math.max(base, Math.max(0.045, c.elevation * 0.3)) - base) * terrain.land[i];
      base += (Math.min(base, -0.1) - base) * terrain.water[i];
    }
    return base * ELEVATION_SCALE * settings.relief;
  });
  applyElevationStrokes(values, columns, rows, width, height, settings.strokes);
  let changedCoast = false;
  cells.forEach((cell, i) => {
    const relative = values[i] - settings.seaLevel;
    const land = relative > 0;
    changedCoast ||= land !== cell.land;
    cell.elevation = relative / ELEVATION_SCALE;
    cell.drainageElevation = cell.elevation;
    cell.land = land;
    cell.accumulation = land ? 1 : 0;
    if (!land) cell.biome = 'water';
    else if (cell.biome === 'water') cell.biome = 'grass';
  });
  // A neutral sketch layer does not perturb existing geometry.
  if (changedCoast)
    field.set(coastlineDistance(cells, columns, rows, width / columns, height / rows));
}

export function elevationField(
  cells: SketchCell[],
  columns: number,
  rows: number,
  width: number,
  height: number,
): ElevationField {
  const values = Float32Array.from(cells, (c) => c.elevation * ELEVATION_SCALE);
  let min = Infinity,
    max = -Infinity;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return {
    columns,
    rows,
    width,
    height,
    values,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
  };
}
export function sampleElevation(field: ElevationField, point: MapPoint) {
  const x = clamp((point.x / field.width) * field.columns - 0.5, 0, field.columns - 1),
    y = clamp((point.y / field.height) * field.rows - 0.5, 0, field.rows - 1);
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    x1 = Math.min(field.columns - 1, x0 + 1),
    y1 = Math.min(field.rows - 1, y0 + 1);
  const at = (x: number, y: number) => field.values[y * field.columns + x];
  return (
    (at(x0, y0) * (1 - (x - x0)) + at(x1, y0) * (x - x0)) * (1 - (y - y0)) +
    (at(x0, y1) * (1 - (x - x0)) + at(x1, y1) * (x - x0)) * (y - y0)
  );
}
