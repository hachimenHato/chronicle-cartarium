import type { GeneratedSettlement, MapObject, MapPoint } from '../../shared/cartography';
import type { GeneratedGeography, GeographicCell } from '../../shared/geography';
import type { GeneratedMapSnapshot } from '../../shared/generated-map';
import type { GeographicLayer } from '../../shared/map-layers';
import { pointInPolygon, smoothPath } from './terrain';
import { plateDisplayName } from '../../shared/plate-names';

export interface LabelObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CartographicLabel {
  id: string;
  name: string;
  entityId?: string;
  kind: 'settlement' | 'division' | 'land' | 'water' | 'plate';
  path: string;
  points: MapPoint[];
  fontSize: number;
  letterSpacing: number;
  bounds: LabelObstacle;
}
interface LabelRequest {
  id: string;
  name: string;
  entityId?: string;
  kind: CartographicLabel['kind'];
  cells: GeographicCell[];
  fontSize: number;
  spacing: number;
  priority: number;
}
const intersects = (a: LabelObstacle, b: LabelObstacle, margin: number) =>
  a.x < b.x + b.width + margin &&
  a.x + a.width + margin > b.x &&
  a.y < b.y + b.height + margin &&
  a.y + a.height + margin > b.y;
const textWidth = (name: string, size: number, spacing: number) =>
  [...name].reduce(
    (sum, c) => sum + (/[^\u0000-\u024f]/u.test(c) ? 1 : /[MW@]/.test(c) ? 0.83 : 0.57) * size,
    0,
  ) +
  Math.max(0, [...name].length - 1) * spacing;

function box(points: MapPoint[], size: number): LabelObstacle {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const x = Math.min(...xs) - size * 0.52,
    y = Math.min(...ys) - size;
  return {
    x,
    y,
    width: Math.max(...xs) + size * 0.52 - x,
    height: Math.max(...ys) + size * 0.24 - y,
  };
}
function sampleHeight(field: NonNullable<GeneratedMapSnapshot['elevation']>, p: MapPoint) {
  const x = Math.max(0, Math.min(field.columns - 1, (p.x / field.width) * field.columns - 0.5));
  const y = Math.max(0, Math.min(field.rows - 1, (p.y / field.height) * field.rows - 0.5));
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    x1 = Math.min(field.columns - 1, x0 + 1),
    y1 = Math.min(field.rows - 1, y0 + 1);
  const a =
    field.values[y0 * field.columns + x0] * (1 - (x - x0)) +
    field.values[y0 * field.columns + x1] * (x - x0);
  const b =
    field.values[y1 * field.columns + x0] * (1 - (x - x0)) +
    field.values[y1 * field.columns + x1] * (x - x0);
  return a * (1 - (y - y0)) + b * (y - y0);
}
function cellLookup(g: GeneratedGeography) {
  const size = Math.max(1, Math.sqrt((g.width * g.height) / Math.max(1, g.cells.length)) * 1.5);
  const bins = new Map<string, GeographicCell[]>();
  for (const c of g.cells) {
    const xs = c.polygon.map((p) => p.x),
      ys = c.polygon.map((p) => p.y);
    for (let y = Math.floor(Math.min(...ys) / size); y <= Math.floor(Math.max(...ys) / size); y++)
      for (
        let x = Math.floor(Math.min(...xs) / size);
        x <= Math.floor(Math.max(...xs) / size);
        x++
      ) {
        const key = `${x}:${y}`;
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key)!.push(c);
      }
  }
  return (p: MapPoint, ids: Set<number>) =>
    (bins.get(`${Math.floor(p.x / size)}:${Math.floor(p.y / size)}`) ?? []).some(
      (c) => ids.has(c.id) && pointInPolygon(p, c.polygon),
    );
}
function principalAxis(cells: GeographicCell[]) {
  const center = {
    x: cells.reduce((sum, c) => sum + c.center.x, 0) / cells.length,
    y: cells.reduce((sum, c) => sum + c.center.y, 0) / cells.length,
  };
  let xx = 0,
    xy = 0,
    yy = 0;
  for (const c of cells) {
    const x = c.center.x - center.x,
      y = c.center.y - center.y;
    xx += x * x;
    xy += x * y;
    yy += y * y;
  }
  let angle = Math.atan2(2 * xy, xx - yy) / 2;
  // Readable left-to-right labels; long north-south regions get a gentle slant, not vertical words.
  angle = Math.max(-Math.PI * 0.28, Math.min(Math.PI * 0.28, angle));
  return { center, angle };
}

/** Plan label curves in map units. No DOM measurement, persisted layout, or map regeneration. */
export function layoutCartographicLabels({
  geography: g,
  layer = 'atlas',
  sites = [],
  obstacles = [],
  elevation,
  objects = [],
  hiddenSiteIds = [],
}: {
  geography: GeneratedGeography;
  layer?: GeographicLayer;
  sites?: GeneratedSettlement[];
  obstacles?: LabelObstacle[];
  elevation?: GeneratedMapSnapshot['elevation'];
  objects?: MapObject[];
  hiddenSiteIds?: string[];
}): CartographicLabel[] {
  if (!['atlas', 'regions', 'countries', 'cultures', 'religions', 'plates'].includes(layer))
    return [];
  const unit = Math.max(g.width, g.height) / 1000;
  const result: CartographicLabel[] = [];
  const occupied = [...obstacles];
  const inBounds = (b: LabelObstacle) =>
    b.x >= 3 * unit &&
    b.y >= 3 * unit &&
    b.x + b.width <= g.width - 3 * unit &&
    b.y + b.height <= g.height - 3 * unit;
  const clear = (b: LabelObstacle, items = occupied) =>
    inBounds(b) && !items.some((other) => intersects(b, other, 3 * unit));
  const siteParts = new Map<number, MapObject[]>();
  for (const object of objects) {
    if (!object.visible || object.kind === 'text') continue;
    const match = /^聚落 ([1-9]\d*) · /.exec(object.name);
    if (!match) continue;
    const index = Number(match[1]) - 1;
    const parts = siteParts.get(index) ?? [];
    parts.push(object);
    siteParts.set(index, parts);
  }
  const allLandmarkBoxes = sites.map((s, index) => {
    const parts = siteParts.get(index) ?? [];
    const corners: MapPoint[] = [];
    for (const part of parts) {
      if (part.kind === 'symbol') {
        const scale =
          (part.size / 32) *
          (s.kind === 'castle'
            ? 0.52
            : s.kind === 'city'
              ? 0.65
              : s.kind === 'town'
                ? 0.8
                : s.kind === 'camp'
                  ? 0.85
                  : 0.95);
        corners.push(
          { x: s.x - 30 * scale, y: s.y - (s.kind === 'castle' ? 43 : 34) * scale },
          { x: s.x + 30 * scale, y: s.y + 27 * scale },
        );
      } else corners.push(...part.points);
    }
    if (!corners.length)
      return { x: s.x - 6 * unit, y: s.y - 9 * unit, width: 12 * unit, height: 15 * unit };
    const xs = corners.map((p) => p.x),
      ys = corners.map((p) => p.y),
      x = Math.min(...xs),
      y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  });
  const landmarkBoxes = allLandmarkBoxes.filter(
    (_, index) => !hiddenSiteIds.includes(sites[index].id),
  );
  if (['atlas', 'regions', 'countries', 'cultures', 'religions'].includes(layer)) {
    for (const site of sites
      .filter((site) => !hiddenSiteIds.includes(site.id))
      .sort(
        (a, b) =>
          ({ city: 0, castle: 1, town: 2, village: 3, camp: 4 })[a.kind] -
            { city: 0, castle: 1, town: 2, village: 3, camp: 4 }[b.kind] ||
          a.id.localeCompare(b.id),
      )) {
      const size =
        (site.kind === 'city' ? 11 : site.kind === 'castle' || site.kind === 'town' ? 10 : 9) *
        unit;
      const width = textWidth(site.name, size, 0.4 * unit);
      const landmark = allLandmarkBoxes[sites.findIndex((s) => s.id === site.id)];
      const below = landmark.y + landmark.height + size + 4 * unit,
        above = landmark.y - size * 0.3 - 4 * unit;
      const options = [
        { x: site.x, y: below },
        { x: site.x, y: above },
        { x: landmark.x + landmark.width + width / 2 + 8 * unit, y: site.y + size / 3 },
        { x: landmark.x - width / 2 - 8 * unit, y: site.y + size / 3 },
        { x: site.x + width * 0.32, y: below + 10 * unit },
        { x: site.x - width * 0.32, y: above - 10 * unit },
      ];
      for (const center of options) {
        const points = [
          { x: center.x - width / 2, y: center.y },
          { x: center.x + width / 2, y: center.y },
        ];
        const bounds = box(points, size);
        if (!clear(bounds) || landmarkBoxes.some((b) => intersects(bounds, b, unit))) continue;
        result.push({
          id: site.id,
          name: site.name,
          entityId: site.entityId,
          kind: 'settlement',
          points,
          path: smoothPath(points),
          fontSize: size,
          letterSpacing: 0.4 * unit,
          bounds,
        });
        occupied.push(bounds);
        break;
      }
    }
  }
  occupied.push(...landmarkBoxes);
  const requests: LabelRequest[] = [];
  const kind = layer === 'cultures' ? 'culture' : layer === 'religions' ? 'religion' : 'country';
  if (['atlas', 'countries', 'cultures', 'religions'].includes(layer))
    for (const d of g.divisions.filter((d) => d.kind === kind)) {
      const cells = g.cells.filter((c) => c.land && c[d.kind] === d.id);
      if (!cells.length) continue;
      requests.push({
        id: d.id,
        name: d.name,
        entityId: d.entityId,
        kind: 'division',
        cells,
        fontSize: Math.min(25, 13 + Math.sqrt(cells.length) * 0.65) * unit,
        spacing: 2.5 * unit,
        priority: 0,
      });
    }
  if (['atlas', 'regions'].includes(layer))
    for (const a of g.areas.filter(
      (a) => layer === 'regions' || ['continent', 'island', 'ocean', 'lake'].includes(a.kind),
    )) {
      const cells = a.cells.map((id) => g.cells[id]).filter((c): c is GeographicCell => !!c);
      if (!cells.length) continue;
      const water = a.kind === 'ocean' || a.kind === 'lake';
      requests.push({
        id: a.id,
        name: a.name,
        entityId: a.entityId,
        kind: water ? 'water' : 'land',
        cells,
        fontSize: (a.kind === 'ocean' || a.kind === 'continent' ? 24 : 13) * unit,
        spacing: (water ? 4.5 : 2) * unit,
        priority: water ? 1 : 2,
      });
    }
  if (layer === 'plates')
    for (const p of g.plates) {
      const cells = g.cells.filter((c) => c.plate === p.id);
      if (cells.length)
        requests.push({
          id: `plate-${p.id}`,
          name: plateDisplayName(p, g.seed),
          kind: 'plate',
          cells,
          fontSize: 17 * unit,
          spacing: 1.6 * unit,
          priority: 0,
        });
    }
  const contains = cellLookup(g);
  for (const request of requests.sort(
    (a, b) =>
      a.priority - b.priority || b.cells.length - a.cells.length || a.id.localeCompare(b.id),
  )) {
    const { center, angle } = principalAxis(request.cells);
    const ids = new Set(request.cells.map((c) => c.id));
    const inside = (p: MapPoint) =>
      contains(p, ids) &&
      (!elevation ||
        request.kind === 'plate' ||
        sampleHeight(elevation, p) > 0 !== (request.kind === 'water'));
    const anchors = [
      center,
      ...request.cells
        .map((c) => c.center)
        .sort(
          (a, b) =>
            Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y),
        )
        .slice(0, 32),
    ];
    let placed = false;
    for (const scale of [1, 0.86, 0.72, 0.6]) {
      if (placed) break;
      const fontSize = Math.max(8 * unit, request.fontSize * scale),
        spacing = request.spacing * scale;
      const length = textWidth(request.name, fontSize, spacing) * 1.03;
      for (const anchor of anchors) {
        if (placed) break;
        for (const direction of [angle, angle * 0.45, 0]) {
          if (placed) break;
          for (const bend of [-0.065, 0.065, 0]) {
            const points: MapPoint[] = [];
            let fits = true;
            const count = Math.max(12, [...request.name].length * 3);
            for (let i = 0; i <= count; i++) {
              const t = i / count,
                x = (t - 0.5) * length,
                y = bend * length * (1 - (2 * t - 1) ** 2);
              const p = {
                x: anchor.x + Math.cos(direction) * x - Math.sin(direction) * y,
                y: anchor.y + Math.sin(direction) * x + Math.cos(direction) * y,
              };
              points.push(p);
              // Reserve the actual glyph band, not just a centre point that may cross a strait.
              for (const offset of [-0.92, 0.2])
                if (
                  !inside({
                    x: p.x - Math.sin(direction) * fontSize * offset,
                    y: p.y + Math.cos(direction) * fontSize * offset,
                  })
                ) {
                  fits = false;
                  break;
                }
              if (!fits) break;
            }
            if (!fits) continue;
            const bounds = box(points, fontSize);
            if (!clear(bounds)) continue;
            result.push({
              id: request.id,
              name: request.name,
              entityId: request.entityId,
              kind: request.kind,
              points,
              path: smoothPath(points),
              fontSize,
              letterSpacing: spacing,
              bounds,
            });
            occupied.push(bounds);
            placed = true;
            break;
          }
        }
      }
    }
  }
  return result;
}
