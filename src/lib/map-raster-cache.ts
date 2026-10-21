import type { MapCameraMatrix, MapCameraView } from './map-camera';

/** A cache is optional: keep the original SVG when a full-resolution bitmap
 * would exceed these bounds instead of making a lower-resolution substitute.
 */
export const MAP_RASTER_CACHE_MAX_PIXELS = 40_000_000;
export const MAP_RASTER_CACHE_MAX_DIMENSION = 16_384;

export interface MapRasterCacheBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapRasterCachePlan {
  fit: number;
  left: number;
  top: number;
  pixelWidth: number;
  pixelHeight: number;
  dpr: number;
  maxZoom: number;
  bounds: MapRasterCacheBounds;
}

/** Match the root SVG's default xMidYMid meet, retaining enough device pixels
 * for the highest supported zoom. Bounds may include artwork outside the map.
 */
export function planMapRasterCache(
  mapWidth: number,
  mapHeight: number,
  frameWidth: number,
  frameHeight: number,
  dpr: number,
  maxZoom = 4,
  bounds: MapRasterCacheBounds = { x: 0, y: 0, width: mapWidth, height: mapHeight },
): MapRasterCachePlan | undefined {
  if (
    ![
      mapWidth,
      mapHeight,
      frameWidth,
      frameHeight,
      dpr,
      maxZoom,
      bounds.width,
      bounds.height,
    ].every((value) => Number.isFinite(value) && value > 0) ||
    ![bounds.x, bounds.y].every(Number.isFinite)
  )
    return undefined;

  const fit = Math.min(frameWidth / mapWidth, frameHeight / mapHeight);
  const pixelWidth = Math.ceil(bounds.width * fit * dpr * maxZoom);
  const pixelHeight = Math.ceil(bounds.height * fit * dpr * maxZoom);
  if (
    !Number.isFinite(fit) ||
    fit <= 0 ||
    !Number.isSafeInteger(pixelWidth) ||
    !Number.isSafeInteger(pixelHeight) ||
    pixelWidth <= 0 ||
    pixelHeight <= 0 ||
    pixelWidth > MAP_RASTER_CACHE_MAX_DIMENSION ||
    pixelHeight > MAP_RASTER_CACHE_MAX_DIMENSION ||
    pixelWidth * pixelHeight > MAP_RASTER_CACHE_MAX_PIXELS
  )
    return undefined;

  return {
    fit,
    left: (frameWidth - mapWidth * fit) / 2,
    top: (frameHeight - mapHeight * fit) / 2,
    pixelWidth,
    pixelHeight,
    dpr,
    maxZoom,
    bounds: { ...bounds },
  };
}

/** Position a world-sized HTML canvas beneath the original SVG. The camera's
 * temporary surface transform is applied to both by their common parent.
 */
export function cacheTransform(plan: MapRasterCachePlan, view: MapCameraView): MapCameraMatrix {
  const scale = plan.fit * view.zoom;
  return {
    a: scale,
    b: 0,
    c: 0,
    d: scale,
    e: plan.left + plan.fit * view.x + scale * plan.bounds.x,
    f: plan.top + plan.fit * view.y + scale * plan.bounds.y,
  };
}
