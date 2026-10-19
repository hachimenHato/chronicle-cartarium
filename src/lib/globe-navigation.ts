import { extentCenter, isGlobalExtent, type WorldExtent } from '../../shared/world-extent';
import { globeExtentContour, globeGraticuleLines } from './globe-geometry';
import { projectGlobe, type GlobeLocation } from './globe-projection';

// 0.01° is the smallest supported selection. This ceiling leaves room to inspect it
// without making arbitrary tiny numerical ranges part of the persisted data contract.
export const maximumGlobeZoom = 16384;

/** Frame the real projected selection rather than mapping a preset to a magic zoom. */
export function globeSelectionZoom(extent: WorldExtent) {
  if (isGlobalExtent(extent)) return 1;
  const center = extentCenter(extent),
    points = globeExtentContour(extent)
      .map((point) =>
        projectGlobe(point.latitude, point.longitude, center.latitude, center.longitude),
      )
      .filter((point) => point.visible);
  if (!points.length) return 1;
  const width = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
    height = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
  return Math.min(maximumGlobeZoom, Math.max(1, (360 * 0.64) / Math.max(width, height, 1e-8)));
}

export function nextGlobeZoom(zoom: number, direction: -1 | 1) {
  // Keep the familiar overview steps; geometric steps avoid hundreds of clicks locally.
  if (zoom <= 4 && (direction < 0 || zoom < 4))
    return Math.max(1, Math.min(maximumGlobeZoom, zoom + direction * 0.5));
  return Math.max(1, Math.min(maximumGlobeZoom, zoom * 2 ** (direction / 2)));
}

export function globeRotationStep(zoom: number) {
  return { latitude: 5 / zoom, longitude: 10 / zoom };
}

function gridStep(value: number) {
  const power = 10 ** Math.floor(Math.log10(Math.max(value, 1e-8))),
    fraction = value / power;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
}

/** A local graticule remains useful when the global 15° grid lies outside the viewport. */
export function globeNavigationGrid(center: GlobeLocation, zoom: number) {
  if (zoom <= 4) return { lines: globeGraticuleLines, step: 15 };
  const angularRadius = (Math.asin(Math.min(1, 180 / (156 * zoom))) * 180) / Math.PI,
    latitudeRadius = Math.min(90, angularRadius * 1.5),
    longitudeRadius = Math.min(
      179.999,
      (angularRadius * 1.8) / Math.max(0.0001, Math.cos((center.latitude * Math.PI) / 180)),
    ),
    latitudeStep = gridStep(angularRadius / 3),
    longitudeStep = gridStep(longitudeRadius / 4),
    south = Math.max(-89.999999, center.latitude - latitudeRadius),
    north = Math.min(89.999999, center.latitude + latitudeRadius),
    west = center.longitude - longitudeRadius,
    east = center.longitude + longitudeRadius,
    lines: { type: 'LineString'; coordinates: number[][] }[] = [];
  for (let lat = Math.ceil(south / latitudeStep) * latitudeStep; lat <= north; lat += latitudeStep)
    lines.push({
      type: 'LineString',
      coordinates: Array.from({ length: 65 }, (_, n) => [west + ((east - west) * n) / 64, lat]),
    });
  for (let lon = Math.ceil(west / longitudeStep) * longitudeStep; lon <= east; lon += longitudeStep)
    lines.push({
      type: 'LineString',
      coordinates: Array.from({ length: 33 }, (_, n) => [lon, south + ((north - south) * n) / 32]),
    });
  return { lines, step: latitudeStep };
}
