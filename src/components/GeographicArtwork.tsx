import { memo, useId, useMemo } from 'react';
import type { GeneratedGeography } from '../../shared/geography';
import type { GeneratedMapSnapshot, MapMilitaryLine } from '../../shared/generated-map';
import type { GeneratedSettlement, MapObject } from '../../shared/cartography';
import { coastlinesFromObjects } from '../lib/land-snap';
import { buildCartographicBorders } from '../lib/geographic-borders';
import { MapSurfaceDefs } from './MapSurfaceDefs';
import { linePath } from '../lib/terrain';
import type { AtlasMap, Entity } from '../../shared/model';
import { useEntityTooltip } from './EntityTooltip';
import type { SVGProps } from 'react';
import { layoutCartographicLabels, type LabelObstacle } from '../lib/cartographic-labels';
import { buildMilitaryArtwork } from '../lib/military-artwork';
import { terrainLayerColors, thematicCellColor, thematicBlendRadius } from '../lib/thematic-colors';
import { OceanTexture } from './OceanTexture';
import type { GeographicLayer } from '../../shared/map-layers';
import { TerrainTexture } from './TerrainTexture';
import { TerrainRelief } from './TerrainRelief';
import { administrativeBorderPaths } from '../lib/administrative-borders';
export { geographicLayerLabels, type GeographicLayer } from '../../shared/map-layers';
const emptyEntities: Entity[] = [];
const emptyObjects: MapObject[] = [];
const emptySites: GeneratedSettlement[] = [];
const emptyObstacles: LabelObstacle[] = [];

function GeographicLabel({
  entity,
  onOpen,
  ...props
}: SVGProps<SVGTextElement> & { entity?: Entity; onOpen?: (id: string) => void }) {
  const tooltip = useEntityTooltip(entity);
  return (
    <text
      {...props}
      {...tooltip}
      // Spaced, curved names stay usable between glyphs as well as on their ink.
      pointerEvents={entity ? 'bounding-box' : 'none'}
      style={entity ? { cursor: 'pointer' } : undefined}
      onPointerDown={(e) => entity && e.stopPropagation()}
      onClick={(e) => {
        if (entity) {
          e.stopPropagation();
          onOpen?.(entity.id);
        }
      }}
    />
  );
}

export const GeographicArtwork = memo(function GeographicArtwork({
  geography: g,
  layer = 'atlas',
  names = true,
  routes = true,
  entities = emptyEntities,
  onOpen,
  objects = emptyObjects,
  elevation,
  surfaceId,
  phase = 'all',
  sites = emptySites,
  obstacles = emptyObstacles,
  extraTextureObjects = emptyObjects,
  hiddenFeatures,
  mapKind,
}: {
  geography?: GeneratedGeography;
  layer?: GeographicLayer;
  names?: boolean;
  routes?: boolean;
  entities?: Entity[];
  onOpen?: (id: string) => void;
  objects?: MapObject[];
  elevation?: GeneratedMapSnapshot['elevation'];
  surfaceId?: string;
  /** Ground tint is drawn before terrain marks; lines and names are drawn afterward. */
  phase?: 'underlay' | 'overlay' | 'all';
  sites?: GeneratedSettlement[];
  obstacles?: LabelObstacle[];
  /** Accepted visible authored objects, used only to keep decorative ground ink clear. */
  extraTextureObjects?: MapObject[];
  hiddenFeatures?: import('../../shared/cartography').MapEditorData['hiddenFeatures'];
  mapKind?: AtlasMap['kind'];
}) {
  const palette = useMemo(() => new Map(g?.divisions.map((d) => [d.id, d.color])), [g?.divisions]);
  const localId = useId().replaceAll(':', '');
  const id = surfaceId ?? `geographic-${localId}`;
  const coast = useMemo(() => coastlinesFromObjects(objects), [objects]);
  const textureObjects = useMemo(
    () => (extraTextureObjects.length ? [...objects, ...extraTextureObjects] : objects),
    [objects, extraTextureObjects],
  );
  const boundaryKind =
    layer === 'cultures' ? 'culture' : layer === 'religions' ? 'religion' : 'country';
  const needsBorders =
    phase !== 'underlay' &&
    ['atlas', 'regions', 'countries', 'cultures', 'religions'].includes(layer);
  const borders = useMemo(
    () =>
      g && needsBorders
        ? buildCartographicBorders(g, boundaryKind, { coastline: coast, elevation })
        : undefined,
    [g, needsBorders, boundaryKind, coast, elevation],
  );
  const labels = useMemo(
    () =>
      g && names && phase !== 'underlay'
        ? layoutCartographicLabels({
            geography: g,
            layer,
            sites,
            hiddenSiteIds: hiddenFeatures?.settlements,
            obstacles,
            elevation,
            objects,
          })
        : [],
    [g, names, phase, layer, sites, obstacles, elevation, objects, hiddenFeatures?.settlements],
  );
  const administrative = useMemo(
    () =>
      g && phase !== 'overlay' && layer === 'regions' ? administrativeBorderPaths(g) : undefined,
    [g, phase, layer],
  );
  if (!g) return null;
  const underlay = phase !== 'overlay';
  const overlay = phase !== 'underlay';
  const unit = Math.max(g.width, g.height) / 1000;
  const divisionKind =
    layer === 'countries'
      ? 'country'
      : layer === 'cultures'
        ? 'culture'
        : layer === 'religions'
          ? 'religion'
          : undefined;
  const thematic = !['atlas', 'regions'].includes(layer);
  const blended = ['terrain', 'temperature', 'precipitation'].includes(layer);
  const blendRadius = thematicBlendRadius(g.width, g.height, g.cells.length);
  const landClip = coast.length ? `url(#${id}-land)` : undefined;
  const color = (c: GeneratedGeography['cells'][number]) => {
    if (blended) return thematicCellColor(c, layer);
    if (layer === 'plates') return g.plates[c.plate]?.color ?? '#cbbd98';
    if (divisionKind)
      return c[divisionKind]
        ? (palette.get(c[divisionKind]!) ?? '#ded5bc')
        : c.land
          ? '#ded5bc'
          : '#b9c3b8';
    return 'none';
  };
  return (
    <g data-geographic-layer={layer} data-geographic-phase={phase} pointerEvents="none">
      <MapSurfaceDefs id={id} objects={objects} coast={coast} width={g.width} height={g.height} />
      {underlay && layer === 'atlas' && (
        <g clipPath={landClip} opacity=".28" data-political-ground="true">
          {g.cells
            .filter((c) => c.land && c.country)
            .map((c) => (
              <path
                key={c.id}
                d={linePath(c.polygon, true)}
                fill={palette.get(c.country!)}
                stroke={palette.get(c.country!)}
                strokeWidth={0.5 * unit}
              />
            ))}
        </g>
      )}
      {underlay && thematic && (
        <g
          opacity={divisionKind ? 0.66 : 1}
          data-political-ground={divisionKind ? 'true' : undefined}
        >
          {blended && (
            <defs>
              <filter
                id={`${id}-thematic-blend`}
                x="-10%"
                y="-10%"
                width="120%"
                height="120%"
                colorInterpolationFilters="sRGB"
              >
                <feGaussianBlur stdDeviation={blendRadius} />
              </filter>
              <clipPath id={`${id}-thematic-bounds`}>
                <rect width={g.width} height={g.height} />
              </clipPath>
            </defs>
          )}
          {layer === 'terrain' && (
            <>
              <rect
                data-terrain-water="true"
                width={g.width}
                height={g.height}
                fill={terrainLayerColors.water}
              />
              <OceanTexture width={g.width} height={g.height} />
            </>
          )}
          <g
            clipPath={
              divisionKind || layer === 'terrain'
                ? landClip
                : blended
                  ? `url(#${id}-thematic-bounds)`
                  : undefined
            }
          >
            <g
              data-thematic-blend={blended ? layer : undefined}
              filter={blended ? `url(#${id}-thematic-blend)` : undefined}
            >
              {g.cells
                .filter((c) => !(divisionKind || layer === 'terrain') || c.land)
                .map((c) => (
                  <path
                    key={c.id}
                    d={linePath(c.polygon, true)}
                    fill={color(c)}
                    stroke={color(c)}
                    strokeWidth={0.6 * unit}
                  />
                ))}
            </g>
          </g>
        </g>
      )}
      {underlay &&
        ['atlas', 'terrain', 'regions', 'countries', 'cultures', 'religions'].includes(layer) && (
          <>
            <TerrainRelief
              geography={g}
              elevation={elevation}
              clipPath={landClip}
              subtle={layer !== 'terrain'}
              mapKind={mapKind}
            />
            <TerrainTexture
              geography={g}
              elevation={elevation}
              clipPath={landClip}
              subtle={layer !== 'terrain'}
              mapKind={mapKind}
              objects={textureObjects}
              sites={sites}
              obstacles={obstacles}
            />
          </>
        )}
      {overlay && layer === 'plates' && (
        <g fill="none" stroke="#615843" strokeWidth={unit} opacity=".8">
          {g.cells
            .filter((c) => c.shelf)
            .map((c) => (
              <path
                key={c.id}
                d={linePath(c.polygon, true)}
                strokeDasharray={`${2 * unit} ${4 * unit}`}
              />
            ))}
        </g>
      )}
      {underlay && layer === 'regions' && administrative && (
        <g
          data-administrative-borders="true"
          clipPath={landClip}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path
            data-cell-boundaries="true"
            d={administrative.grid}
            stroke="#75664d"
            strokeWidth={0.48 * unit}
            opacity=".3"
          />
          <path
            d={administrative.administrative}
            stroke="#f4ead2"
            strokeWidth={2.1 * unit}
            opacity=".8"
          />
          <path
            data-province-boundaries="true"
            d={administrative.administrative}
            stroke="#695943"
            strokeWidth={0.85 * unit}
            strokeDasharray={`${3.6 * unit} ${1.8 * unit}`}
            opacity=".9"
          />
        </g>
      )}
      {overlay &&
        layer === 'plates' &&
        g.borders
          .filter((b) => b.kind === 'plate')
          .map((b) => (
            <path
              key={b.id}
              d={linePath(b.points)}
              fill="none"
              stroke={
                b.motion === 'convergent'
                  ? '#984c37'
                  : b.motion === 'divergent'
                    ? '#376a82'
                    : '#776a43'
              }
              strokeWidth={1.3 * unit}
              opacity=".75"
            />
          ))}
      {overlay && ['atlas', 'regions', 'countries', 'cultures', 'religions'].includes(layer) && (
        <g
          data-political-borders="true"
          clipPath={landClip}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {borders?.map((b) => (
            <g key={b.id}>
              <path d={linePath(b.points)} stroke="#efe4ca" strokeWidth={2.5 * unit} opacity=".6" />
              <path
                data-border-chain={b.id}
                d={linePath(b.points)}
                stroke="#756149"
                strokeWidth={(layer === 'regions' ? 1.3 : 0.9) * unit}
                strokeDasharray={`${5 * unit} ${2.4 * unit}`}
                opacity=".86"
              />
            </g>
          ))}
        </g>
      )}
      {overlay && routes && layer === 'atlas' && (
        <g
          data-sea-routes="true"
          fill="none"
          stroke="#537b83"
          strokeWidth={0.7 * unit}
          strokeDasharray={`${5 * unit} ${4 * unit}`}
          strokeLinecap="round"
          strokeLinejoin="round"
          mask={coast.length ? `url(#${id}-water)` : undefined}
          opacity=".85"
        >
          {g.seaRoutes
            .filter((r) => !hiddenFeatures?.seaRoutes?.includes(r.id))
            .map((r) => (
              <path key={r.id} data-sea-route={r.id} d={linePath(r.points)}>
                <title>{r.name}</title>
              </path>
            ))}
        </g>
      )}
      {overlay &&
        routes &&
        layer === 'atlas' &&
        g.ports
          .filter((p) => !hiddenFeatures?.ports?.includes(p.id))
          .map((p) => (
            <g
              key={p.id}
              data-map-port={p.id}
              transform={`translate(${p.harbor.x} ${p.harbor.y}) scale(${0.22 * unit})`}
              fill="#efe4c8"
              stroke="#435f62"
              strokeWidth="2"
            >
              <circle cy="-15" r="4" fill="none" />
              <path
                d="M0-11V19M-7-5H7M-17 7Q-17 20 0 23Q17 20 17 7M-17 7L-20 13M17 7L20 13"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <title>{p.name}</title>
            </g>
          ))}
      {overlay && names && (
        <g
          textAnchor="middle"
          fill="#514a3a"
          fontFamily="Georgia, Noto Serif SC, serif"
          stroke="#efe5ce"
          strokeWidth={2.2 * unit}
          paintOrder="stroke"
          strokeLinejoin="round"
        >
          <defs>
            {labels.map((label, index) => (
              <path key={`${label.kind}-${label.id}`} id={`${id}-label-${index}`} d={label.path} />
            ))}
          </defs>
          {labels.map((label, index) => (
            <GeographicLabel
              key={`${label.kind}-${label.id}`}
              entity={entities.find((e) => e.id === label.entityId)}
              onOpen={onOpen}
              data-geographic-name={label.id}
              data-cartographic-label={label.kind}
              fontSize={label.fontSize}
              letterSpacing={label.letterSpacing}
              fontWeight={label.kind === 'division' ? 600 : label.kind === 'settlement' ? 500 : 400}
              fontStyle={label.kind === 'water' ? 'italic' : undefined}
              fill={
                label.kind === 'water'
                  ? '#3e5c65'
                  : label.kind === 'settlement'
                    ? '#433729'
                    : '#514a3a'
              }
              strokeWidth={(label.kind === 'settlement' ? 1.8 : 2.4) * unit}
              opacity={label.kind === 'division' ? 0.94 : label.kind === 'settlement' ? 1 : 0.8}
            >
              <textPath href={`#${id}-label-${index}`} startOffset="50%">
                {label.name}
              </textPath>
            </GeographicLabel>
          ))}
          {layer === 'plates' &&
            g.plates.map((p) => (
              <g key={p.id}>
                <path
                  d={`M${p.center.x},${p.center.y + 8 * unit}l${p.velocity.x * 18 * unit},${p.velocity.y * 18 * unit}`}
                  stroke="#514a3a"
                  strokeWidth={2 * unit}
                />
              </g>
            ))}
        </g>
      )}
    </g>
  );
});

export const MilitaryArtwork = memo(function MilitaryArtwork({
  lines,
}: {
  lines: MapMilitaryLine[];
}) {
  return (
    <g data-military-lines="true" pointerEvents="none">
      {lines
        .filter((l) => l.visible && l.points.length >= 2)
        .map((l) => {
          const geometry = buildMilitaryArtwork(l);
          return (
            <g
              key={l.id}
              data-military-line={l.id}
              data-military-kind={l.kind}
              strokeLinejoin="round"
              strokeLinecap="round"
            >
              {l.kind === 'advance' ? (
                <>
                  <path
                    d={geometry.ribbon}
                    fill="#f3e8cf"
                    stroke="#f3e8cf"
                    strokeWidth={Math.max(1, l.width)}
                    opacity=".8"
                  />
                  <path
                    data-military-ribbon="true"
                    d={geometry.ribbon}
                    fill={l.color}
                    fillOpacity=".74"
                    stroke={l.color}
                    strokeWidth={Math.max(0.5, l.width * 0.38)}
                  />
                </>
              ) : (
                <>
                  <path
                    d={geometry.centerline}
                    fill="none"
                    stroke="#f3e8cf"
                    strokeWidth={l.width + 2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  <path
                    d={geometry.centerline}
                    fill="none"
                    stroke={l.color}
                    strokeWidth={l.kind === 'defense' ? l.width * 1.3 : l.width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={
                      l.kind === 'retreat' ? `${l.width * 4} ${l.width * 3}` : undefined
                    }
                  />
                  {geometry.arrowhead && (
                    <path
                      d={geometry.arrowhead}
                      fill="none"
                      stroke={l.color}
                      strokeWidth={l.width * 1.6}
                      strokeLinejoin="round"
                    />
                  )}
                  {geometry.marks.map((mark, i) => (
                    <path
                      key={i}
                      data-military-mark={l.kind}
                      d={mark.path}
                      fill={l.kind === 'defense' ? l.color : 'none'}
                      stroke={l.color}
                      strokeWidth={Math.max(0.7, l.width * 0.7)}
                    />
                  ))}
                </>
              )}
              <title>{l.name}</title>
            </g>
          );
        })}
    </g>
  );
});
