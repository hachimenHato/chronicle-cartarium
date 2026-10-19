import { memo, useMemo } from 'react';
import type { GeneratedGeography } from '../../shared/geography';
import type { GeneratedMapSnapshot } from '../../shared/generated-map';
import type { AtlasMap } from '../../shared/model';
import { buildTerrainRelief } from '../lib/terrain-relief';

const pigments = {
  shadow: '#514335',
  light: '#fff6d9',
  woodland: '#3f5737',
  meadow: '#7b8a4c',
  arid: '#c19a58',
  wetland: '#627654',
  rock: '#806e53',
  cold: '#d8e0cf',
};

/** Continuous, quiet ground modelling; engraved detail and all map furniture stay above. */
export const TerrainRelief = memo(function TerrainRelief({
  geography,
  elevation,
  clipPath,
  subtle = false,
  mapKind = 'world',
}: {
  geography: GeneratedGeography;
  elevation?: GeneratedMapSnapshot['elevation'];
  clipPath?: string;
  subtle?: boolean;
  mapKind?: AtlasMap['kind'];
}) {
  const relief = useMemo(
    () => buildTerrainRelief(geography, elevation, mapKind),
    [geography, elevation, mapKind],
  );
  return (
    <g
      data-terrain-relief="continuous"
      data-relief-source={relief.source}
      data-relief-samples={relief.samples}
      data-relief-vertices={relief.vertices}
      clipPath={clipPath}
      pointerEvents="none"
      opacity={subtle ? 0.74 : 1}
      fillRule="evenodd"
      stroke="none"
    >
      {relief.washes.map((wash, index) => (
        <path
          key={`${wash.kind}-${index}`}
          data-relief-wash={wash.kind}
          d={wash.path}
          fill={pigments[wash.kind]}
          opacity={wash.opacity}
        />
      ))}
    </g>
  );
});
