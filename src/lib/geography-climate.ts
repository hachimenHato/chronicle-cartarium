import type { GeographicSettings } from '../../shared/geography';
import type { SketchCell } from './sketch-generation-v1';
import { ELEVATION_SCALE } from './elevation';

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
/** Annual climatology approximation; 6.5°C/km is not a parcel's dry/moist adiabatic rate. */
export function geographicTemperature(
  latitude: number,
  elevationMetres: number,
  equatorialMean: number,
) {
  return equatorialMean - 0.52 * Math.abs(latitude) - 0.0065 * Math.max(0, elevationMetres);
}
export function rainfallLatitudeFactor(latitude: number) {
  const lat = Math.abs(latitude);
  // Broad annual belts: equatorial uplift, dry subtropics, midlatitude storms, dry poles.
  return 0.32 + 0.9 * Math.exp(-((lat / 15) ** 2)) + 0.5 * Math.exp(-(((lat - 55) / 14) ** 2));
}
const vaporCapacity = (temperature: number) => clamp(Math.exp(0.045 * (temperature - 20)), 0.08, 3);

/** Westerlies dominate the midlatitudes; trades and polar easterlies reverse the dominant flow. */
export function westerlyRainShare(latitude: number) {
  const lat = Math.abs(latitude);
  const smooth = (v: number) => {
    const t = clamp(v);
    return t * t * (3 - 2 * t);
  };
  return 0.2 + 0.62 * smooth((lat - 25) / 12) * (1 - smooth((lat - 60) / 12));
}

/** Weather systems respond to broad relief, not every jag in a high-resolution elevation grid. */
function atmosphericRelief(
  cells: Pick<SketchCell, 'elevation'>[],
  columns: number,
  rows: number,
  width: number,
  height: number,
  coverageKm: number,
) {
  const values = Float64Array.from(cells, (c) => Math.max(0, c.elevation * ELEVATION_SCALE));
  const rx = Math.min(columns - 1, Math.max(1, Math.round(20 / (coverageKm / columns)))),
    ry = Math.min(rows - 1, Math.max(1, Math.round(20 / (((height / width) * coverageKm) / rows))));
  const horizontal = new Float64Array(values.length),
    result = new Float64Array(values.length);
  for (let row = 0; row < rows; row++) {
    let total = 0;
    for (let col = 0; col <= rx; col++) total += values[row * columns + col];
    for (let col = 0; col < columns; col++) {
      horizontal[row * columns + col] =
        total / (Math.min(columns - 1, col + rx) - Math.max(0, col - rx) + 1);
      if (col - rx >= 0) total -= values[row * columns + col - rx];
      if (col + rx + 1 < columns) total += values[row * columns + col + rx + 1];
    }
  }
  for (let col = 0; col < columns; col++) {
    let total = 0;
    for (let row = 0; row <= ry; row++) total += horizontal[row * columns + col];
    for (let row = 0; row < rows; row++) {
      result[row * columns + col] =
        total / (Math.min(rows - 1, row + ry) - Math.max(0, row - ry) + 1);
      if (row - ry >= 0) total -= horizontal[(row - ry) * columns + col];
      if (row + ry + 1 < rows) total += horizontal[(row + ry + 1) * columns + col];
    }
  }
  return result;
}

export function generateGeographicClimate({
  cells,
  coastDistance,
  columns,
  rows,
  width,
  height,
  coverageKm,
  settings,
  variation,
}: {
  cells: Pick<SketchCell, 'x' | 'y' | 'elevation' | 'land'>[];
  coastDistance: ArrayLike<number>;
  columns: number;
  rows: number;
  width: number;
  height: number;
  coverageKm: number;
  settings: GeographicSettings;
  variation: (x: number, y: number) => number;
}) {
  const n = cells.length,
    temperature = new Float32Array(n),
    precipitation = new Float32Array(n);
  const latitudes = cells.map(
    (c) =>
      settings.latitudeNorth + ((settings.latitudeSouth - settings.latitudeNorth) * c.y) / height,
  );
  for (let i = 0; i < n; i++) {
    const coastKm = (Math.max(0, coastDistance[i]) / width) * coverageKm;
    temperature[i] =
      geographicTemperature(
        latitudes[i],
        cells[i].elevation * ELEVATION_SCALE,
        settings.meanSeaTemperature,
      ) - (cells[i].land ? clamp(coastKm / 1500) * 2 : 0);
  }
  const relief = atmosphericRelief(cells, columns, rows, width, height, coverageKm);
  const dx = width / columns,
    dy = height / rows;
  // Two seasonal/synoptic transport directions prevent a permanent one-way rain shadow across a whole planet.
  // Latitude weights describe broad wind belts; windAngle rotates both directions for fictional worlds.
  for (const reverse of [false, true]) {
    const humidity = new Float64Array(n);
    const angle = (settings.windAngle * Math.PI) / 180 + (reverse ? Math.PI : 0),
      vx = Math.cos(angle),
      vy = Math.sin(angle);
    const denominator = Math.max(Math.abs(vx / dx), Math.abs(vy / dy)),
      sx = vx / dx / denominator,
      sy = vy / dy / denominator;
    const stepKm = (Math.hypot(sx * dx, sy * dy) / width) * coverageKm;
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => cells[a].x * vx + cells[a].y * vy - cells[b].x * vx - cells[b].y * vy || a - b,
    );
    for (const i of order) {
      const c = cells[i],
        col = i % columns,
        row = Math.floor(i / columns);
      const seaTemperature = geographicTemperature(latitudes[i], 0, settings.meanSeaTemperature),
        capacity = vaporCapacity(seaTemperature),
        belt = rainfallLatitudeFactor(latitudes[i]);
      const px = col - sx,
        py = row - sy,
        x0 = Math.floor(px),
        y0 = Math.floor(py),
        tx = px - x0,
        ty = py - y0;
      let incoming = 0,
        upstreamHeight = 0;
      for (const [x, y, weight] of [
        [x0, y0, (1 - tx) * (1 - ty)],
        [x0 + 1, y0, tx * (1 - ty)],
        [x0, y0 + 1, (1 - tx) * ty],
        [x0 + 1, y0 + 1, tx * ty],
      ]) {
        if (weight < 1e-9) continue;
        if (x >= 0 && y >= 0 && x < columns && y < rows) {
          const j = y * columns + x;
          incoming += humidity[j] * weight;
          upstreamHeight += relief[j] * weight;
        } else {
          // The cropped map's edge is open to regional air masses, not automatically a desert or ocean.
          incoming += capacity * (c.land ? 0.78 : 0.95) * weight;
          upstreamHeight += relief[i] * weight;
        }
      }
      const rise = Math.max(0, relief[i] - upstreamHeight),
        descent = Math.max(0, upstreamHeight - relief[i]);
      if (!c.land) incoming += (capacity * 0.95 - incoming) * (1 - Math.exp(-stepKm / 180));
      const loss = 1 - Math.exp((-stepKm / 3500) * (0.45 + belt) - rise / 2600);
      const recycled = c.land ? 0.22 : 0;
      humidity[i] = Math.max(0.003, incoming * (1 - loss * (1 - recycled)));
      const lifting = clamp(rise / Math.max(0.01, stepKm) / 16, 0, 2),
        lee = 1 - clamp(descent / Math.max(0.01, stepKm) / 35) * 0.4,
        noise = 0.93 + 0.14 * variation(c.x / width, c.y / height),
        share = westerlyRainShare(latitudes[i]);
      precipitation[i] +=
        (420 + 1800 * belt) *
        Math.max(0.005, incoming) *
        (1 + lifting) *
        lee *
        noise *
        settings.rainfall *
        (reverse ? 1 - share : share);
    }
  }
  for (let i = 0; i < n; i++) precipitation[i] = clamp(precipitation[i], 10, 6500);
  return { temperature, precipitation };
}
