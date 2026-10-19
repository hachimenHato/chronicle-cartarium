import type { WorldExtent } from '../../shared/world-extent';
import { longitudeSpan } from '../../shared/world-extent';
import { globePolygon, type GlobeLocation } from './globe-projection';

// Fictional silhouettes only help orientation; these are never used as generated coastlines.
const landSeeds = [
  [25, -115, 23, 34],
  [-18, -68, 16, 31],
  [47, 48, 63, 27],
  [-9, 20, 24, 34],
  [-28, 130, 25, 17],
  [65, -32, 12, 13],
  [-59, 40, 54, 8],
];

export const globeLandContours: readonly (readonly GlobeLocation[])[] = landSeeds.map(
  ([lat, lon, rx, ry], i) =>
    Array.from({ length: 80 }, (_, n) => {
      const a = (n * Math.PI) / 40,
        rough = 1 + 0.13 * Math.sin(a * 5 + i) + 0.09 * Math.cos(a * 7);
      return {
        latitude: Math.max(-88, Math.min(88, lat + Math.sin(a) * ry * rough)),
        longitude: lon + Math.cos(a) * rx * rough,
      };
    }),
);

export const globeGraticules: readonly (readonly GlobeLocation[])[] = [
  ...Array.from({ length: 11 }, (_, i) =>
    Array.from({ length: 181 }, (_, n) => ({ latitude: (i - 5) * 15, longitude: n * 2 - 180 })),
  ),
  ...Array.from({ length: 24 }, (_, i) =>
    Array.from({ length: 91 }, (_, n) => ({ latitude: n * 2 - 90, longitude: i * 15 - 180 })),
  ),
];

// Normalization and ring winding depend on the geometry, not on rotation or zoom.
export const globeLandPolygons = globeLandContours.map((contour) => globePolygon(contour)!);
export const globeGraticuleLines = globeGraticules.map((points) => ({
  type: 'LineString' as const,
  coordinates: points.map((point) => [point.longitude, point.latitude]),
}));

/** Densify parallels before spherical projection; an extent edge is not a single great circle. */
export function globeExtentContour(extent: WorldExtent): GlobeLocation[] {
  const span = longitudeSpan(extent),
    height = extent.latitudeNorth - extent.latitudeSouth;
  // A great-circle chord between parallel samples bows toward the pole. Its
  // latitude error grows with the square of its angle, so fixed sampling can
  // overwhelm a thin, wide selection. Keep that bow below about 5% of its height;
  // even the smallest supported 360° × 0.01° band needs only 532 segments.
  const maxParallelStep = Math.min(
      360 / 64,
      (Math.sqrt((Math.max(0.01, height) * Math.PI * 0.8) / 180) * 180) / Math.PI,
    ),
    parallelSegments = Math.min(1024, Math.max(64, Math.ceil(span / maxParallelStep)));
  return [
    ...Array.from({ length: parallelSegments + 1 }, (_, n) => ({
      latitude: extent.latitudeNorth,
      longitude: extent.longitudeWest + (span * n) / parallelSegments,
    })),
    ...Array.from({ length: 33 }, (_, n) => ({
      latitude: extent.latitudeNorth - (height * n) / 32,
      longitude: extent.longitudeWest + span,
    })),
    ...Array.from({ length: parallelSegments + 1 }, (_, n) => ({
      latitude: extent.latitudeSouth,
      longitude: extent.longitudeWest + span * (1 - n / parallelSegments),
    })),
    ...Array.from({ length: 33 }, (_, n) => ({
      latitude: extent.latitudeSouth + (height * n) / 32,
      longitude: extent.longitudeWest,
    })),
  ];
}
