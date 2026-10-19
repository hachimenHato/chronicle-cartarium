import { memo, useEffect, useId, useMemo } from 'react';
import type { AtlasMap } from '../../shared/model';
import {
  biomeCatalog,
  type MapObject,
  type MapSymbolKind,
  type MapRegion,
  type MapPoint,
  type SketchGenerationSettings,
  type GeneratedSettlement,
} from '../../shared/cartography';
import { useComposedTerrain } from '../lib/useComposedTerrain';
import { linePath } from '../lib/terrain';
import { parchmentObject } from '../lib/map-palette';
import type { ElevationField } from '../lib/elevation';
import { ElevationLegend } from './ElevationLegend';
import type { ReactNode } from 'react';
import type { GeneratedGeography } from '../../shared/geography';
import { cartographicObjectLayers } from '../lib/map-artwork-layers';
import { coastlinesFromObjects } from '../lib/land-snap';
import { ExtendedMapGlyph } from './ExtendedMapGlyph';
import { SettlementGlyph } from './SettlementGlyph';
import { OceanTexture } from './OceanTexture';
import { objectLegend, type LegendItem } from '../lib/map-legend';
import type { GeneratedMapSnapshot } from '../../shared/generated-map';
import { hiddenFeatureObjects } from '../../shared/map-features';
export type GeographicUnderlayRenderer = (
  geography: GeneratedGeography,
  objects: MapObject[],
  elevation?: GeneratedMapSnapshot['elevation'],
  mapKind?: AtlasMap['kind'],
  sites?: GeneratedSettlement[],
) => ReactNode;

/** Original vector glyphs. They remain editable objects and need no external assets. */
export function MapGlyph({ kind }: { kind: MapSymbolKind }) {
  switch (kind) {
    case 'village':
    case 'town':
    case 'city':
    case 'castle':
    case 'camp':
      return <SettlementGlyph kind={kind} />;
    case 'tree':
      return (
        <>
          <path d="M-10 12Q0 15 11 11" fill="none" opacity=".25" />
          <path d="M0 3V12M0 8L-4 4M0 6L4 2" fill="none" />
          <path d="M-9 2C-15-8-5-15 0-12C9-17 16-4 9 2C6 7-5 8-9 2Z" />
          <path
            d="M0-12C9-17 16-4 9 2C7 6 1 7-3 6C5 1 6-6 0-12Z"
            fill="#294d3f"
            stroke="none"
            opacity=".23"
          />
          <path d="M-8-3Q-7-9-1-9" fill="none" stroke="#e4e9c4" opacity=".5" />
        </>
      );
    case 'pine':
      return (
        <>
          <path d="M0 5V13" fill="none" />
          <path d="M0-15L-7-4H-4L-10 6H10L4-4H7Z" />
          <path d="M0-15L7-4H4L10 6H0Z" fill="#294d3f" stroke="none" opacity=".24" />
          <path d="M-8 12Q0 14 8 11" fill="none" opacity=".24" />
        </>
      );
    case 'mountain':
      return (
        <>
          <path d="M-15 10L0-15L15 10Z" />
          <path d="M0-15L-2-2L2-5L7 5L15 10Z" fill="#56654e" stroke="none" opacity=".32" />
          <path d="M-6-5L0-15L6-5L2-7L0-4L-3-7Z" fill="#f8f5e7" />
          <path d="M0-4L6 10" fill="none" />
          <path
            d="M-19 13Q-6 8 0 12Q10 15 19 10M-12 6L-7-1M8 6L5 2"
            fill="none"
            opacity=".38"
            strokeWidth=".65"
          />
        </>
      );
    case 'hill':
      return (
        <>
          <path d="M-16 8Q-4-13 6 5Q13-3 18 8Z" />
          <path d="M-5 6Q1-4 5 4" fill="none" />
        </>
      );
    case 'dune':
      return (
        <>
          <path d="M-18 8Q-1-10 16 8M-12 1Q2-12 17 1M-10 12Q0 6 10 12" fill="none" />
        </>
      );
    case 'reeds':
      return (
        <>
          <path d="M-9 9L-10-5M0 9V-11M8 9L10-5M-14 10Q0 6 14 10" fill="none" />
          <path d="M-12-9H-8V-3H-12ZM-2-14H2V-7H-2ZM8-10H12V-3H8Z" />
        </>
      );
    case 'rock':
      return (
        <>
          <path d="M-12 8L-15 0L-7-9L4-11L14 2L10 9Z" />
          <path d="M-7-9L-3 3L10 9M-3 3L14 2" fill="none" />
        </>
      );
    case 'house':
      return (
        <>
          <path d="M-10 0L0-10L10 0V12H-10Z" />
          <path d="M-13 0L0-13L13 0M-2 12V5H3V12M-7 2H-4V5H-7Z" fill="none" />
        </>
      );
    case 'tower':
      return (
        <>
          <path d="M-9 12L-7-7H7L9 12ZM-11-7V-15H-6V-11H-2V-15H3V-11H7V-15H11V-7Z" />
          <path d="M-2-3H2V2H-2ZM-2 12V6H2V12" fill="none" />
        </>
      );
    case 'ruin':
      return (
        <>
          <path d="M-15 12V-8L-10-11L-7-3L-2-8V12M4 12V-14L9-10L11-3L15-5V12" />
          <path d="M-18 13H19M-11-4L-8 3L-12 7M8-4L6 5L11 8" fill="none" />
        </>
      );
    case 'temple':
      return (
        <>
          <path d="M-18-5L0-16L18-5ZM-18 12H18V16H-18Z" />
          <path d="M-13-4V12M-5-4V12M5-4V12M13-4V12" strokeWidth="3" fill="none" />
        </>
      );
    case 'bridge':
      return (
        <>
          <path d="M-18 10V-3Q0-17 18-3V10H12V1Q0-7-12 1V10Z" />
          <path d="M-18-3Q0-12 18-3M-10-8V-2M0-11V-5M10-8V-2" fill="none" />
        </>
      );
    case 'cave':
      return (
        <>
          <path d="M-18 11L-12-7L0-15L12-5L18 11Z" />
          <path d="M-8 11V3Q0-10 8 3V11Z" fill="#505c50" />
        </>
      );
    case 'port':
      return (
        <>
          <path
            d="M0-10V12M-15 1Q-15 14 0 14Q15 14 15 1M-15 1L-18 6M15 1L18 6M-8-3H8"
            fill="none"
            strokeWidth="2"
          />
          <circle cy="-13" r="4" fill="none" />
        </>
      );
    case 'farmland':
      return (
        <>
          <path d="M-18-12H18V12H-18Z" />
          <path d="M-12-12V12M-6-12V12M0-12V12M6-12V12M12-12V12M-18-3H18" fill="none" />
        </>
      );
    default:
      return <ExtendedMapGlyph kind={kind} />;
  }
}

export const MapObjectArtwork = memo(function MapObjectArtwork({
  object,
  interactive = false,
}: {
  object: MapObject;
  interactive?: boolean;
}) {
  const filterId = `map-soft-${useId().replaceAll(':', '')}`;
  if (!object.visible) return null;
  const point = object.points[0];
  if (!point) return null;
  const isSymbol = object.kind === 'symbol';
  return (
    <g
      data-map-object={interactive ? object.id : undefined}
      data-map-artwork={object.id}
      data-relief-part={
        object.name.startsWith('古典山脉 · ') ? object.name.split(' · ').at(-1) : undefined
      }
      data-settlement-surrounding={object.name.includes(' · 周边建筑 ') ? 'true' : undefined}
      data-mountain-style={
        /^古典山脉 · (high|middle|low|very-low)\//.test(object.name)
          ? object.name.split(' · ')[1].split(' ')[0]
          : undefined
      }
      opacity={object.opacity}
      pointerEvents={interactive ? 'visiblePainted' : 'none'}
      fill={object.color}
      stroke={object.stroke}
      strokeWidth={object.strokeWidth}
      strokeLinejoin="round"
      strokeLinecap="round"
      filter={object.blur ? `url(#${filterId})` : undefined}
    >
      {!!object.blur && (
        <defs>
          <filter
            id={filterId}
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation={object.blur} />
          </filter>
        </defs>
      )}
      {object.kind === 'image' ? (
        <image
          href={object.imageUrl}
          x={point.x}
          y={point.y}
          width={object.points[1].x - point.x}
          height={object.points[1].y - point.y}
          preserveAspectRatio="none"
          transform={`rotate(${object.rotation} ${(point.x + object.points[1].x) / 2} ${(point.y + object.points[1].y) / 2})`}
        />
      ) : object.kind === 'polygon' || object.kind === 'path' ? (
        <path
          d={linePath(object.points, object.kind === 'polygon')}
          fill={object.kind === 'path' ? 'none' : object.color}
        />
      ) : (
        <g transform={`translate(${point.x} ${point.y}) rotate(${object.rotation})`}>
          {isSymbol ? (
            <g transform={`scale(${object.size / 32})`}>
              <MapGlyph kind={object.symbol || 'tree'} />
            </g>
          ) : (
            <text
              fontSize={object.size}
              fontFamily="Georgia, SimSun, serif"
              textAnchor="middle"
              dominantBaseline="middle"
              paintOrder="stroke"
            >
              {object.text}
            </text>
          )}
        </g>
      )}
      {object.kind === 'polygon' && object.name === '海面' && (
        <OceanTexture
          width={Math.max(...object.points.map((p) => p.x))}
          height={Math.max(...object.points.map((p) => p.y))}
          points={object.points}
        />
      )}
    </g>
  );
});

/** Source hit areas stay editable while visible terrain is composed across strokes. */
const RegionHitArea = memo(function RegionHitArea({ region }: { region: MapRegion }) {
  if (!region.visible) return null;
  const polygon = region.geometry === 'polygon';
  const d =
    region.points.length === 1
      ? `M${region.points[0].x},${region.points[0].y}l.01 .01`
      : linePath(region.points, polygon);
  return (
    <g data-map-region={region.id} data-editor-hit="true">
      <path
        d={d}
        fill={polygon ? 'transparent' : 'none'}
        stroke={polygon ? 'none' : 'transparent'}
        strokeWidth={region.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents={polygon ? 'fill' : 'stroke'}
      />
    </g>
  );
});

const ComposedTerrainArtwork = memo(function ComposedTerrainArtwork({
  regions,
  width,
  height,
  interactive,
  preview,
  onPending,
  onError,
  generation,
  terrainView = 'atlas',
  onElevation,
  onCoastlines,
  scaleKm,
  mapKind,
  onLegend,
  onSettlements,
  snapshot,
  onSnapshot,
  renderUnderlay,
  hiddenObjects,
  hiddenSites,
}: {
  regions: MapRegion[];
  width: number;
  height: number;
  interactive: boolean;
  preview: boolean;
  onPending?: (pending: boolean) => void;
  onError?: (error: string) => void;
  generation?: SketchGenerationSettings;
  terrainView?: 'atlas' | 'elevation';
  onElevation?: (field: ElevationField | undefined) => void;
  onCoastlines?: (rings: MapPoint[][] | undefined) => void;
  scaleKm?: number;
  mapKind?: AtlasMap['kind'];
  onLegend?: (items: LegendItem[]) => void;
  onSettlements?: (sites: GeneratedSettlement[]) => void;
  snapshot?: GeneratedMapSnapshot;
  onSnapshot?: (snapshot: GeneratedMapSnapshot) => void;
  renderUnderlay?: GeographicUnderlayRenderer;
  hiddenObjects?: Set<string>;
  hiddenSites?: string[];
}) {
  const generated = useComposedTerrain(
    regions,
    width,
    height,
    generation,
    false,
    terrainView,
    scaleKm,
    mapKind,
    snapshot,
  );
  const displayObjects = useMemo(
    () =>
      (generation?.version === 2
        ? generated.objects
        : generated.objects.map(parchmentObject)
      ).filter((o) => !hiddenObjects?.has(o.id)),
    [generated.objects, generation?.version, hiddenObjects],
  );
  const divided = useMemo(() => cartographicObjectLayers(displayObjects), [displayObjects]);
  const visibleSites = useMemo(
    () => generated.sites?.filter((site) => !hiddenSites?.includes(site.id)),
    [generated.sites, hiddenSites],
  );
  const namedDetails = useMemo(
    () =>
      divided.detail.filter(
        (object) => !(object.kind === 'text' && /^聚落 \d+ · 名称$/.test(object.name)),
      ),
    [divided.detail],
  );
  useEffect(() => {
    if (!preview && !generated.pending && !generated.error && generated.snapshot)
      onSnapshot?.(generated.snapshot);
  }, [preview, generated.pending, generated.error, generated.snapshot, onSnapshot]);
  useEffect(() => {
    onLegend?.(objectLegend(displayObjects));
  }, [displayObjects, onLegend]);
  useEffect(() => {
    if (!generated.pending && !generated.error) onSettlements?.(generated.sites ?? []);
  }, [generated.sites, generated.pending, generated.error, onSettlements]);
  useEffect(() => {
    onPending?.(generated.pending);
  }, [onPending, generated.pending]);
  useEffect(() => {
    onError?.(generated.error);
  }, [onError, generated.error]);
  useEffect(() => {
    onElevation?.(generated.pending || generated.error ? undefined : generated.elevation);
  }, [onElevation, generated.elevation, generated.pending, generated.error]);
  useEffect(() => {
    onCoastlines?.(
      generated.pending || generated.error ? undefined : coastlinesFromObjects(generated.objects),
    );
  }, [onCoastlines, generated.objects, generated.pending, generated.error]);
  useEffect(
    () => () => {
      onPending?.(false);
      onError?.('');
      onElevation?.(undefined);
      onCoastlines?.(undefined);
    },
    [onPending, onError, onElevation, onCoastlines],
  );
  return (
    <g
      data-terrain-composite="true"
      data-terrain-preview={preview ? 'true' : undefined}
      data-terrain-pending={generated.pending}
      data-terrain-error={!!generated.error}
      data-source-preview="false"
      data-generation-rivers={generated.stats?.rivers}
      data-generation-settlements={generated.stats?.settlements}
      data-generation-roads={generated.stats?.roads}
      data-terrain-view={terrainView}
      data-elevation-min={generated.elevation?.min}
      data-elevation-max={generated.elevation?.max}
    >
      {terrainView === 'elevation' ? (
        (generated.elevationObjects || []).map((object) => (
          <MapObjectArtwork key={object.id} object={object} />
        ))
      ) : generated.geography ? (
        <>
          <g data-map-ground="true">
            {divided.ground.map((object) => (
              <MapObjectArtwork key={object.id} object={object} />
            ))}
          </g>
          {renderUnderlay?.(
            generated.geography,
            displayObjects,
            generated.snapshot?.elevation ?? snapshot?.elevation,
            mapKind,
            visibleSites,
          )}
          <g data-map-details="true">
            {namedDetails.map((object) => (
              <MapObjectArtwork key={object.id} object={object} />
            ))}
          </g>
        </>
      ) : (
        displayObjects.map((object) => <MapObjectArtwork key={object.id} object={object} />)
      )}
      {generated.error && (
        <g pointerEvents="none">
          <text x="24" y="36" fill="#814b38" fontSize="14">
            地形暂时无法合成：{generated.error}
          </text>
          <text x="24" y="56" fill="#814b38" fontSize="12">
            原始区域仍保留，可选择调整或撤销。
          </text>
        </g>
      )}
      {terrainView === 'elevation' && generated.elevation && (
        <ElevationLegend field={generated.elevation} />
      )}
      {generation && terrainView !== 'elevation' && generated.stats && !generated.pending && (
        <g data-editor-overlay="true" pointerEvents="none">
          <rect
            x="14"
            y={height - 36}
            width="310"
            height="25"
            rx="6"
            fill="#fffdf3"
            opacity=".88"
          />
          <text x="24" y={height - 19} fill="#52654b" fontSize="11">
            自动布局 · {generated.stats.rivers} 段河道 · {generated.stats.settlements} 处聚落 ·{' '}
            {generated.stats.roads} 条道路
          </text>
        </g>
      )}
      {interactive && regions.map((region) => <RegionHitArea key={region.id} region={region} />)}
    </g>
  );
});
const emptyRegions: MapRegion[] = [];
const SourceRegion = memo(function SourceRegion({ region }: { region: MapRegion }) {
  if (!region.visible) return null;
  const color = biomeCatalog.find((b) => b.id === region.biome)!.color;
  const polygon = region.geometry === 'polygon';
  const path =
    linePath(region.points, polygon) + (!polygon && region.points.length === 1 ? 'l.01 .01' : '');
  return (
    <path
      d={path}
      fill={polygon ? color : 'none'}
      stroke={color}
      strokeWidth={polygon ? 1 : region.width}
      strokeLinecap="round"
      strokeLinejoin="round"
      pointerEvents="none"
    />
  );
});
/** Separate component: the source view never mounts a generator or terrain worker. */
const SourceTerrainArtwork = memo(function SourceTerrainArtwork({
  regions,
  preview,
}: {
  regions: MapRegion[];
  preview: boolean;
}) {
  return (
    <g
      data-terrain-composite="true"
      data-source-preview="true"
      data-terrain-pending="false"
      data-terrain-error="false"
      data-terrain-preview={preview ? 'true' : undefined}
    >
      {regions.map((region) => (
        <SourceRegion key={region.id} region={region} />
      ))}
    </g>
  );
});
export const EditorArtwork = memo(function EditorArtwork({
  map,
  interactive = false,
  objectPreview,
  regionPreview,
  elevationPreview = false,
  onPending,
  onError,
  sourcePreview = false,
  terrainView = 'atlas',
  onElevation,
  onCoastlines,
  onLegend,
  onSettlements,
  onSnapshot,
  renderUnderlay,
}: {
  map: AtlasMap;
  interactive?: boolean;
  objectPreview?: MapObject;
  regionPreview?: MapRegion;
  elevationPreview?: boolean;
  onPending?: (pending: boolean) => void;
  onError?: (error: string) => void;
  sourcePreview?: boolean;
  terrainView?: 'atlas' | 'elevation';
  onElevation?: (field: ElevationField | undefined) => void;
  onCoastlines?: (rings: MapPoint[][] | undefined) => void;
  onLegend?: (items: LegendItem[]) => void;
  onSettlements?: (sites: GeneratedSettlement[]) => void;
  onSnapshot?: (snapshot: GeneratedMapSnapshot) => void;
  renderUnderlay?: GeographicUnderlayRenderer;
}) {
  const original = map.editor?.regions || emptyRegions;
  const frozenObjects = map.editor?.generation ? undefined : map.editor?.objects;
  const hasGeneration = Boolean(map.editor?.generation);
  // Authored drafts do not change generated feature ownership. Retain these
  // sets while moving a component instead of re-indexing the generated roads.
  const hiddenGenerated = useMemo(
    () => hiddenFeatureObjects(map),
    [map.editor?.generated, frozenObjects, hasGeneration, map.editor?.hiddenFeatures],
  );
  const hiddenAuthored = useMemo(
    () => hiddenFeatureObjects(map, 'object'),
    [map.editor?.objects, map.editor?.generated, hasGeneration, map.editor?.hiddenFeatures],
  );
  const regions = useMemo(
    () =>
      regionPreview
        ? original.some((r) => r.id === regionPreview.id)
          ? original.map((r) => (r.id === regionPreview.id ? regionPreview : r))
          : [...original, regionPreview]
        : original,
    [original, regionPreview],
  );
  return (
    <g>
      {!sourcePreview &&
        (map.editor?.objects || [])
          .filter((o) => o.layer === 'base' && !hiddenAuthored.has(o.id))
          .map((object) => (
            <MapObjectArtwork
              key={object.id}
              object={objectPreview?.id === object.id ? objectPreview : object}
              interactive={interactive}
            />
          ))}
      {sourcePreview ? (
        <SourceTerrainArtwork regions={regions} preview={!!regionPreview} />
      ) : (
        <ComposedTerrainArtwork
          key={map.id}
          regions={regions}
          width={map.width}
          height={map.height}
          scaleKm={map.scaleKm}
          mapKind={map.kind}
          interactive={interactive}
          preview={!!regionPreview || elevationPreview}
          onPending={onPending}
          onError={onError}
          generation={map.editor?.generation}
          terrainView={terrainView}
          onElevation={onElevation}
          onCoastlines={onCoastlines}
          onLegend={onLegend}
          onSettlements={onSettlements}
          snapshot={map.editor?.generated}
          onSnapshot={onSnapshot}
          renderUnderlay={renderUnderlay}
          hiddenObjects={hiddenGenerated}
          hiddenSites={map.editor?.hiddenFeatures?.settlements}
        />
      )}
      {!sourcePreview &&
        (map.editor?.objects || [])
          .filter((o) => o.layer !== 'base' && !hiddenAuthored.has(o.id))
          .map((object) => (
            <MapObjectArtwork
              key={object.id}
              object={objectPreview?.id === object.id ? objectPreview : object}
              interactive={interactive}
            />
          ))}
    </g>
  );
});
