import { geoArea, geoContains, geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { wrapLongitude } from '../../shared/world-extent';

export interface GlobeLocation {
  latitude: number;
  longitude: number;
}
export interface GlobePoint {
  x: number;
  y: number;
  visible: boolean;
}
/** An orthographic view of the actual sphere, rotated about its geographic center. */
export function projectGlobe(
  latitude: number,
  longitude: number,
  centerLatitude: number,
  centerLongitude: number,
  radius = 156,
): GlobePoint {
  const rad = Math.PI / 180,
    lat = latitude * rad,
    origin = centerLatitude * rad,
    delta = (longitude - centerLongitude) * rad;
  return {
    x: 180 + radius * Math.cos(lat) * Math.sin(delta),
    y:
      180 -
      radius *
        (Math.cos(origin) * Math.sin(lat) - Math.sin(origin) * Math.cos(lat) * Math.cos(delta)),
    visible:
      Math.sin(origin) * Math.sin(lat) + Math.cos(origin) * Math.cos(lat) * Math.cos(delta) >=
      -1e-8,
  };
}
const sameCoordinate = (a: number[], b: number[]) =>
  Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(wrapLongitude(a[0] - b[0])) < 1e-9;

function coordinates(points: readonly GlobeLocation[]) {
  const result: number[][] = [];
  for (const point of points) {
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return [];
    const latitude = Math.max(-90, Math.min(90, point.latitude));
    // A pole is one point, regardless of the meridian used to reach it.
    const coordinate = [Math.abs(latitude) === 90 ? 0 : wrapLongitude(point.longitude), latitude];
    if (!result.length || !sameCoordinate(coordinate, result[result.length - 1]))
      result.push(coordinate);
  }
  return result;
}

/** Normalize and close exactly once before D3 does spherical (not screen-space) clipping. */
export function globePolygon(
  points: readonly GlobeLocation[],
  expectedArea?: number,
  interior?: GlobeLocation,
) {
  const ring = coordinates(points);
  while (ring.length > 1 && sameCoordinate(ring[0], ring[ring.length - 1])) ring.pop();
  if (ring.length < 3) return undefined;
  ring.push([...ring[0]]);
  const polygon = { type: 'Polygon' as const, coordinates: [ring] };
  const area = geoArea(polygon);
  if (!Number.isFinite(area) || area < 1e-12) return undefined;
  // Area alone cannot distinguish the two sides of a hemisphere. An explicit
  // interior point also keeps wide selections and polar caps on their intended side.
  if (
    interior
      ? !geoContains(polygon, [wrapLongitude(interior.longitude), interior.latitude])
      : expectedArea === undefined
        ? area > Math.PI * 2
        : Math.abs(4 * Math.PI - area - expectedArea) < Math.abs(area - expectedArea)
  )
    ring.reverse();
  return polygon;
}

/** One projection per view for land, graticules and selection, including limb intersections. */
export function createGlobePathRenderer(
  centerLatitude: number,
  centerLongitude: number,
  options: { zoom?: number; clipToViewport?: boolean } = {},
) {
  const zoom = Math.max(1, options.zoom ?? 1),
    projection = geoOrthographic()
      .translate([180, 180])
      .scale(156)
      .rotate([-wrapLongitude(centerLongitude), -centerLatitude])
      .precision(0.2 / zoom);
  if (options.clipToViewport) {
    const radius = 180 / zoom;
    projection.clipExtent([
      [180 - radius, 180 - radius],
      [180 + radius, 180 + radius],
    ]);
  }
  // SVG's default three decimal places become visibly stepped at town scales.
  // Keep the original compact paths at overview scales and sub-pixel precision locally.
  const path = geoPath(projection).digits(zoom > 4 ? 8 : 3);
  return {
    geometry(geometry: GeoPermissibleObjects) {
      return path(geometry) ?? '';
    },
    polygon(points: readonly GlobeLocation[], expectedArea?: number, interior?: GlobeLocation) {
      const polygon = globePolygon(points, expectedArea, interior);
      return polygon ? (path(polygon) ?? '') : '';
    },
    line(points: readonly GlobeLocation[]) {
      const line = coordinates(points);
      return line.length > 1 ? (path({ type: 'LineString', coordinates: line }) ?? '') : '';
    },
  };
}

export function visibleGlobePath(
  points: readonly GlobeLocation[],
  centerLatitude: number,
  centerLongitude: number,
) {
  return createGlobePathRenderer(centerLatitude, centerLongitude).line(points);
}

/** Spherical clipping closes polygons along the limb, never across hidden vertices. */
export function globePolygonPath(
  points: readonly GlobeLocation[],
  centerLatitude: number,
  centerLongitude: number,
  expectedArea?: number,
  interior?: GlobeLocation,
) {
  return createGlobePathRenderer(centerLatitude, centerLongitude).polygon(
    points,
    expectedArea,
    interior,
  );
}
