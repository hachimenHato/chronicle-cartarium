import type { AtlasMap } from '../../shared/model';
import type { DivisionKind, DivisionPaint, MapPoint, MapRegion } from '../../shared/cartography';
import { pointInRegion, regionContours } from './cartography';
import { linePath } from './terrain';

const cache = new WeakMap<DivisionPaint, { width: number; height: number; path: string }>();
function region(stroke: DivisionPaint): MapRegion {
  return {
    ...stroke,
    id: stroke.id,
    name: '',
    biome: 'grass',
    density: 0,
    visible: true,
    locked: false,
  };
}
/** One identical cutout is used for both neighbors: no independently jittered borders. */
export function divisionStrokePath(stroke: DivisionPaint, width: number, height: number) {
  const old = cache.get(stroke);
  if (old?.width === width && old.height === height) return old.path;
  const path =
    stroke.geometry === 'polygon' && stroke.roughness === 0
      ? `${linePath(stroke.points)} Z`
      : regionContours(region(stroke), width, height)
          .map((ring) => `${linePath(ring)} Z`)
          .join(' ');
  cache.set(stroke, { width, height, path });
  return path;
}
export function divisionAt(map: AtlasMap, kind: DivisionKind, point: MapPoint) {
  const divisions = map.editor?.divisions ?? [];
  const ids = new Set(divisions.filter((d) => d.kind === kind).map((d) => d.id));
  let owner: string | undefined;
  for (const stroke of map.editor?.divisionPaint ?? []) {
    if (!ids.has(stroke.divisionId) || !pointInRegion(point, region(stroke))) continue;
    if (stroke.operation === 'paint') owner = stroke.divisionId;
    else if (owner === stroke.divisionId) owner = undefined;
  }
  return divisions.find((d) => d.id === owner);
}
export function divisionAnchor(map: AtlasMap, divisionId: string): MapPoint | undefined {
  const division = map.editor?.divisions?.find((d) => d.id === divisionId);
  if (!division) return;
  const strokes = (map.editor?.divisionPaint ?? []).filter(
    (s) => s.divisionId === divisionId && s.operation === 'paint',
  );
  const points = strokes.flatMap((s) => s.points);
  if (!points.length) return;
  const center = {
    x: points.reduce((n, p) => n + p.x, 0) / points.length,
    y: points.reduce((n, p) => n + p.y, 0) / points.length,
  };
  for (const p of [center, ...points.slice().reverse()])
    if (divisionAt(map, division.kind, p)?.id === divisionId) return p;
  // A polygon's vertices may belong to a neighbor; sample its interior before omitting its label.
  const minX = Math.min(...points.map((p) => p.x)),
    maxX = Math.max(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y)),
    maxY = Math.max(...points.map((p) => p.y));
  for (let y = 1; y < 12; y++)
    for (let x = 1; x < 12; x++) {
      const p = { x: minX + ((maxX - minX) * x) / 12, y: minY + ((maxY - minY) * y) / 12 };
      if (divisionAt(map, division.kind, p)?.id === divisionId) return p;
    }
}
