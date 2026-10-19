import { memo, useMemo } from 'react';
import type { GeneratedGeography } from '../../shared/geography';
import type { GeneratedMapSnapshot } from '../../shared/generated-map';
import type { GeneratedSettlement, MapObject } from '../../shared/cartography';
import type { AtlasMap } from '../../shared/model';
import type { LabelObstacle } from '../lib/cartographic-labels';
import { buildTerrainTexture } from '../lib/terrain-texture';

const emptyObjects: MapObject[] = [];
const emptySites: GeneratedSettlement[] = [];
const emptyObstacles: LabelObstacle[] = [];

/** Delicate land-cover engraving stays below rivers, roads, settlements and labels. */
export const TerrainTexture = memo(function TerrainTexture({
  geography,
  elevation,
  clipPath,
  subtle = false,
  mapKind = 'world',
  objects = emptyObjects,
  sites = emptySites,
  obstacles = emptyObstacles,
}: {
  geography: GeneratedGeography;
  elevation?: GeneratedMapSnapshot['elevation'];
  clipPath?: string;
  subtle?: boolean;
  mapKind?: AtlasMap['kind'];
  objects?: MapObject[];
  sites?: GeneratedSettlement[];
  obstacles?: LabelObstacle[];
}) {
  const ink = useMemo(
    () => buildTerrainTexture(geography, elevation, { mapKind, objects, sites, obstacles }),
    [geography, elevation, mapKind, objects, sites, obstacles],
  );
  const unit = Math.max(geography.width, geography.height) / 1000;
  return (
    <g
      data-terrain-texture="engraved"
      data-terrain-marks={ink.marks}
      clipPath={clipPath}
      pointerEvents="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={subtle ? 0.74 : 1}
    >
      <g data-terrain-relief="elevation" fill="none" strokeWidth={0.7 * unit}>
        <path d={ink.slope} stroke="#65503a" opacity=".2" />
        <path d={ink.slopeLight} stroke="#fff5d9" opacity=".45" />
      </g>
      {ink.biomes.map((biome) => {
        const vegetation = ['grass', 'forest', 'rainforest', 'taiga', 'savanna', 'swamp'].includes(
          biome.biome,
        );
        const pigment = biome.biome === 'snow' ? '#72888c' : vegetation ? '#324c2b' : '#74543a';
        return (
          <g key={biome.biome} data-terrain-texture-biome={biome.biome}>
            {biome.shade && (
              <path
                d={biome.shade}
                fill={vegetation ? '#30492b' : '#70543d'}
                opacity={vegetation ? '.19' : '.16'}
                stroke="none"
              />
            )}
            <path
              d={biome.line}
              fill="none"
              stroke={pigment}
              strokeWidth={0.58 * unit}
              opacity={vegetation ? '.5' : '.52'}
            />
            {biome.light && (
              <path
                d={biome.light}
                fill="none"
                stroke="#fff3cd"
                strokeWidth={0.67 * unit}
                opacity=".48"
              />
            )}
          </g>
        );
      })}
    </g>
  );
});
