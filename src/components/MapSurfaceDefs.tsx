import { memo, useMemo } from 'react';
import type { MapObject, MapPoint } from '../../shared/cartography';
import { coastlinesFromObjects } from '../lib/land-snap';
import { linePath } from '../lib/terrain';

/** The same shore rings as the artwork, including lake holes and small islands. */
export const MapSurfaceDefs = memo(function MapSurfaceDefs({
  id,
  objects,
  width,
  height,
  coast,
}: {
  id: string;
  objects: MapObject[];
  width: number;
  height: number;
  /** Reuse the caller's exact rings, including lake holes and small islands. */
  coast?: MapPoint[][];
}) {
  const rings = useMemo(() => coast ?? coastlinesFromObjects(objects), [coast, objects]);
  const path = useMemo(() => rings.map((ring) => linePath(ring, true)).join(' '), [rings]);
  if (!rings.length) return null;
  return (
    <defs>
      <clipPath id={`${id}-land`}>
        <path d={path} fillRule="evenodd" clipRule="evenodd" />
      </clipPath>
      <mask id={`${id}-water`} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}>
        <rect width={width} height={height} fill="white" />
        <path d={path} fill="black" fillRule="evenodd" />
      </mask>
    </defs>
  );
});
