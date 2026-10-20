import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { BRAND_TITLE } from '../../shared/branding';
import { plateDisplayName } from '../../shared/plate-names';
import type { PointerEvent as ReactPointerEvent, SVGProps } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Brush,
  Building2,
  Check,
  ChevronRight,
  Compass,
  Dice5,
  Download,
  Eraser,
  Hand,
  Layers,
  Map as MapIcon,
  MapPin as PinIcon,
  Maximize,
  Minimize,
  LoaderCircle,
  PanelRightClose,
  PanelRightOpen,
  ImagePlus,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Route,
  Sparkles,
  Trash2,
  Undo2,
  Waves,
  X,
} from 'lucide-react';
import { makeId } from '../../shared/model';
import type { AtlasMap, Entity, MapPin, MapStroke, World } from '../../shared/model';
import { biomeCatalog, type DivisionKind, type MapPoint } from '../../shared/cartography';
import type { GeneratedSettlement } from '../../shared/cartography';
import { sampleCurve } from '../lib/cartography';
import { coastlinesFromObjects } from '../lib/land-snap';
import { distanceToSegment, generateTerrain, linePath, smoothPath } from '../lib/terrain';
import type { Point } from '../lib/terrain';
import { downloadFile } from '../lib/api';
import './Atlas.css';
import { MapDimensionsPanel, MapSizeFields, type MapDimensions } from './MapDimensions';
import { mapSizePresets, mapCoverageKm, formatDistance, mapScaleBar } from '../lib/map-scale';
import { useDivisionStudio } from './useDivisionStudio';
import { MapDivisions, DivisionPanel } from './MapDivisions';
import { EditorArtwork, type GeographicUnderlayRenderer } from './MapArtwork';
import { MapPaper } from './MapPaper';
import { parchmentPaper, parchmentPigment, parchmentSea } from '../lib/map-palette';
import { sampleElevation, type ElevationField } from '../lib/elevation';
import { useMapStudio, type StudioTool } from './useMapStudio';
import { MapStudioPanel, StudioModeBar, StudioOverlay } from './MapStudioPanel';
import { useEntityTooltip } from './EntityTooltip';
import { TOOLTIP_SHOW_MS } from '../lib/entity-tooltip-state';
import { MapImageImport, type MapImageImportOptions } from './MapImageImport';
import { uploadMapImage, fitMapImage, embedMapImages } from '../lib/map-image';
import { createEditorData } from '../lib/cartography';
import { OceanTexture } from './OceanTexture';
import { MapGlyph } from './MapArtwork';
import { authoredLegend, type LegendItem } from '../lib/map-legend';
import { useAccess } from './AccessContext';
import { RecordPublication } from './RecordPublication';
import { EntityLink } from './Common';
import type { GeneratedMapSnapshot, MapMilitaryLine } from '../../shared/generated-map';
import { militaryLineLabels } from '../../shared/generated-map';
import type { GeneratedGeography, GeographicSettings } from '../../shared/geography';
import { generationSignature, restoreElevation } from '../lib/generated-map';
import {
  assignGeographicCells,
  clearGeographicCells,
  preserveGeographicNames,
} from '../lib/geographic-edits';
import { frontierGraph, snapFrontPoint, followFrontEdge, lineOnFront } from '../lib/military';
import { GeographyPanel, type GeographyTool } from './GeographyPanel';
import { GeographicArtwork, MilitaryArtwork, type GeographicLayer } from './GeographicArtwork';
import { defaultGeographicSettings, GEOGRAPHY_LIMITS } from '../../shared/geography';
import { colorBlockRegions } from '../lib/color-block-import';
import { MapCreationSource, freshMapCreationSource } from './MapCreationSource';
import { useGeographicSelection } from './useGeographicSelection';
import { GeographicSelectionArtwork } from './GeographicSelectionArtwork';
import { associateGeographicDivisions } from '../lib/geographic-associations';
import { MapLayerBar } from './MapLayerBar';
import { ClimateLayerGuide } from './ClimateLayerGuide';
import { MapPlacesPanel } from './MapPlacesPanel';
import { selectableGeographicCell } from '../lib/geographic-selection';
import { climateLegendItems, terrainLayerColors } from '../lib/thematic-colors';
import { featureHidden, hiddenFeatureObjects } from '../../shared/map-features';
import { useFrameState } from '../lib/useFrameState';
import { useMapPanCamera } from '../lib/useMapPanCamera';
import './AtlasLayout.css';

const mapKinds = { world: '世界地图', region: '区域地图', town: '城镇地图' };
const pinKinds = { city: '城镇', landmark: '地标', danger: '危险', note: '笔记' };
type Tool = StudioTool;
const tools = [
  { id: 'pan', label: '平移地图', Icon: Hand },
  { id: 'select', label: '选择 / 移动标记', Icon: MousePointer2 },
  { id: 'pin', label: '添加标记', Icon: PinIcon },
  { id: 'brush', label: '自由绘画', Icon: Brush },
  { id: 'road', label: '绘制道路', Icon: Route },
  { id: 'river', label: '绘制河流', Icon: Waves },
  { id: 'erase', label: '擦除笔画', Icon: Eraser },
] as const;
interface AtlasProps {
  maps: AtlasMap[];
  entities: Entity[];
  worldId: string;
  world?: World;
  selectedMapId?: string;
  onChange: (maps: AtlasMap[]) => void;
  onOpenEntity: (id: string) => void;
  onCreateDivision: (entity: Entity, map: AtlasMap) => void;
  onCommitGenerated: (map: AtlasMap, entities: Entity[]) => void;
}

/** A read-only, entirely native SVG cartographic layer, also useful in dashboard previews. */
function LegacyTerrainArtwork({ map }: { map: AtlasMap }) {
  const uid = useId().replaceAll(':', '');
  const terrain = useMemo(
    () => generateTerrain(map.seed, map.width, map.height, map.kind, map.scaleKm),
    [map.seed, map.width, map.height, map.kind, map.scaleKm],
  );
  const town = map.kind === 'town',
    blank = map.seed === 0;
  return (
    <g className="terrain-artwork" pointerEvents="none">
      <defs>
        <pattern id={`${uid}-sea`} width="47" height="34" patternUnits="userSpaceOnUse">
          <path
            d="M2 15 Q7 12 12 15 M29 30 Q34 27 39 30"
            fill="none"
            stroke={parchmentPigment('#8baba7')}
            strokeWidth=".7"
            opacity=".34"
          />
        </pattern>
        <clipPath id={`${uid}-land`}>
          {terrain.land.map((land, i) => (
            <path key={i} d={land.path} />
          ))}
        </clipPath>
      </defs>
      <rect
        width={map.width}
        height={map.height}
        fill={town || blank ? parchmentPaper : parchmentSea}
      />
      {!town && !blank && <OceanTexture width={map.width} height={map.height} />}
      {terrain.land.map((land, i) => (
        <g key={i}>
          <path
            d={land.path}
            fill="none"
            stroke={parchmentPigment('#adc2b8')}
            strokeWidth="15"
            opacity=".26"
          />
          <path
            d={land.path}
            fill="none"
            stroke={parchmentPigment('#adc2b8')}
            strokeWidth="7"
            opacity=".65"
          />
          <path
            d={land.path}
            fill={parchmentPigment('#e8e2c9')}
            stroke={parchmentPigment('#7f9682')}
            strokeWidth="1.4"
          />
          {land.elevation.map((path, j) => (
            <path
              key={j}
              d={path}
              fill={parchmentPigment(j ? '#c7c9a6' : '#d7d5b5')}
              opacity={j ? 0.23 : 0.36}
              stroke={parchmentPigment('#a0aa83')}
              strokeWidth=".7"
              strokeDasharray="2 5"
            />
          ))}
        </g>
      ))}
      {town && (
        <>
          <path
            d={smoothPath(terrain.wall, true)}
            fill={parchmentPigment('#ddd7bd')}
            fillOpacity=".34"
            stroke={parchmentPigment('#8d977f')}
            strokeWidth="6"
          />
          <path
            d={smoothPath(terrain.wall, true)}
            fill="none"
            stroke={parchmentPigment('#e9e4d2')}
            strokeWidth="2"
            strokeDasharray="3 9"
          />
        </>
      )}
      <g clipPath={town ? undefined : `url(#${uid}-land)`}>
        {terrain.rivers.map((river, i) => (
          <g key={i}>
            <path
              d={smoothPath(river)}
              fill="none"
              stroke={parchmentPigment('#96b8af')}
              strokeWidth={town ? 26 : 3.8}
              strokeLinecap="round"
            />
            <path
              d={smoothPath(river)}
              fill="none"
              stroke={parchmentPigment('#c2d6ca')}
              strokeWidth={town ? 18 : 1.8}
            />
          </g>
        ))}
      </g>
      {terrain.roads.map((road, i) => (
        <g key={i}>
          <path
            d={smoothPath(road)}
            fill="none"
            stroke={parchmentPigment('#c2b599')}
            strokeWidth="12"
          />
          <path
            d={smoothPath(road)}
            fill="none"
            stroke={parchmentPigment('#ede5cb')}
            strokeWidth="8"
          />
        </g>
      ))}
      {terrain.blocks.map((block, i) => (
        <g key={i}>
          <path
            d={block.path}
            fill={parchmentPigment(
              block.shade > 0.6 ? '#929b81' : block.shade > 0.3 ? '#b0ae90' : '#c4baa0',
            )}
            stroke={parchmentPigment('#777e66')}
            strokeWidth="1"
          />
          <path
            d={linePath([block.points[0], block.points[2]])}
            stroke={parchmentPigment('#7f866e')}
            strokeWidth=".7"
            opacity=".7"
          />
        </g>
      ))}
      {terrain.symbols.map((symbol, i) => (
        <g
          key={i}
          transform={`translate(${symbol.x},${symbol.y}) scale(${symbol.size / 10})`}
          opacity={symbol.kind === 'tree' ? 0.5 + symbol.shade * 0.25 : 0.85}
        >
          {symbol.kind === 'mountain' ? (
            <>
              <path
                d="M-12 5 L0-15 L12 5 Z"
                fill={parchmentPigment('#b7b89b')}
                stroke={parchmentPigment('#7c866e')}
                strokeWidth=".7"
              />
              <path
                d="M0-15 L-2-3 L2-6 L6 0 L12 5"
                fill={parchmentPigment('#8e9b7c')}
                opacity=".48"
              />
              <path d="M-5-7 L0-15 L5-7 L1-9 L-1-7 L-3-9 Z" fill={parchmentPigment('#eee9d5')} />
              <path
                d="M-15 7 Q0 4 14 7"
                stroke={parchmentPigment('#919e7d')}
                strokeWidth=".4"
                fill="none"
              />
            </>
          ) : (
            <>
              <path d="M0 5 V11" stroke={parchmentPigment('#586f56')} strokeWidth="1" />
              <path
                d="M-6 6 L-2 0 L-5 0 L0-9 L5 0 L2 0 L6 6 Z"
                fill={parchmentPigment(symbol.shade > 0.5 ? '#6c8965' : '#8c9e74')}
                stroke={parchmentPigment('#5c7a59')}
                strokeWidth=".6"
              />
            </>
          )}
        </g>
      ))}
      {!blank && (
        <g
          fill={parchmentPigment('#678176')}
          fontFamily="Georgia, serif"
          fontStyle="italic"
          letterSpacing="5"
          opacity=".65"
          textAnchor="middle"
        >
          <text x={map.width * 0.77} y={map.height * 0.79} fontSize="17">
            {town ? 'THE OLD QUARTER' : 'THE WHISPERING SEA'}
          </text>
          {!town && (
            <text x={map.width * 0.31} y={map.height * 0.65} fontSize="12">
              T H E V E R D A N T R E A C H
            </text>
          )}
        </g>
      )}
    </g>
  );
}

const renderAtlasUnderlay: GeographicUnderlayRenderer = (
  geography,
  objects,
  elevation,
  mapKind,
  sites,
) => (
  <GeographicArtwork
    phase="underlay"
    geography={geography}
    objects={objects}
    elevation={elevation}
    mapKind={mapKind}
    sites={sites}
    names={false}
    routes={false}
  />
);

export function TerrainArtwork({ map }: { map: AtlasMap }) {
  return (
    <g pointerEvents="none">
      {map.editor?.baseVisible !== false ? (
        <LegacyTerrainArtwork map={map} />
      ) : (
        <rect width={map.width} height={map.height} fill={parchmentSea} />
      )}
      <EditorArtwork map={map} renderUnderlay={renderAtlasUnderlay} />
      <GeographicArtwork
        phase="overlay"
        geography={map.editor?.generated?.geography}
        objects={map.editor?.generated?.objects}
        elevation={map.editor?.generated?.elevation}
        sites={map.editor?.generated?.sites}
        hiddenFeatures={map.editor?.hiddenFeatures}
      />
      <MilitaryArtwork lines={map.editor?.military ?? []} />
      {!map.editor?.generated?.geography && <MapDivisions map={map} />}
      <MapPaper width={map.width} height={map.height} />
      {map.strokes
        .filter((s) => !featureHidden(map, 'roads', s.id))
        .map((stroke) => (
          <Stroke key={stroke.id} stroke={stroke} />
        ))}
    </g>
  );
}
function TooltipMapPin({
  entity,
  children,
  ...props
}: SVGProps<SVGGElement> & { entity?: Entity }) {
  const tooltip = useEntityTooltip(entity);
  return (
    <g
      {...props}
      {...tooltip}
      onMouseEnter={(event) => {
        tooltip.onMouseEnter(event);
        props.onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        tooltip.onMouseLeave();
        props.onMouseLeave?.(event);
      }}
    >
      {children}
    </g>
  );
}
function Stroke({ stroke }: { stroke: MapStroke }) {
  return (
    <g pointerEvents="none">
      {stroke.tool === 'road' && (
        <path
          d={linePath(stroke.points)}
          fill="none"
          stroke="#f4ebd7"
          strokeWidth={stroke.width + 3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      <path
        d={
          stroke.points.length === 1
            ? `M${stroke.points[0].x},${stroke.points[0].y} l.01 .01`
            : linePath(stroke.points)
        }
        fill="none"
        stroke={stroke.color}
        strokeWidth={stroke.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={stroke.tool === 'road' ? '7 5' : undefined}
      />
    </g>
  );
}

function PinSymbol({ kind, active = false }: { kind: MapPin['kind']; active?: boolean }) {
  const color = kind === 'danger' ? '#ad704d' : kind === 'note' ? '#9c895a' : '#355b4a';
  return (
    <g>
      <circle r={active ? 14 : 11} fill="#f8f3e5" stroke={color} strokeWidth={active ? 2 : 1.5} />
      {kind === 'city' ? (
        <path
          d="M-5 4 V-3 H-2 V-6 H2 V-3 H5 V4Z M-1 4 V0 H1 V4"
          fill={color}
          stroke={color}
          strokeWidth=".7"
        />
      ) : kind === 'danger' ? (
        <>
          <path d="M0-6 L6 5 H-6Z" fill={color} />
          <path d="M0-2 V1 M0 3 v.1" stroke="#fff" strokeWidth="1.1" />
        </>
      ) : kind === 'note' ? (
        <path d="M-4-5 H4 V5 H-4Z M-2-2 H2 M-2 1 H2" fill="none" stroke={color} strokeWidth="1.2" />
      ) : (
        <path d="M0-6 L5 0 L0 6 L-5 0Z" fill={color} />
      )}
    </g>
  );
}

export default function Atlas({
  maps,
  entities,
  worldId,
  world,
  selectedMapId,
  onChange,
  onOpenEntity,
  onCreateDivision,
  onCommitGenerated,
}: AtlasProps) {
  const access = useAccess();
  const [currentId, setCurrentId] = useState(selectedMapId || maps[0]?.id || '');
  const [selectedPinId, setSelectedPinId] = useState<string>();
  const [tool, setTool] = useState<Tool>('pan');
  const [inspectorHidden, setInspectorHidden] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [imageImportOpen, setImageImportOpen] = useState(false);
  const [exportingImages, setExportingImages] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [generatedLegend, setGeneratedLegend] = useState<LegendItem[]>([]);
  const [generatedSettlements, setGeneratedSettlements] = useState<GeneratedSettlement[]>([]);
  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', change);
    return () => {
      document.removeEventListener('fullscreenchange', change);
      if (stageRef.current && document.fullscreenElement === stageRef.current)
        void document.exitFullscreen().catch(() => {});
    };
  }, []);
  async function toggleFullscreen() {
    try {
      studio.cancel();
      divisionStudio.cancel();
      if (document.fullscreenElement === stageRef.current) await document.exitFullscreen();
      else await stageRef.current?.requestFullscreen();
    } catch {
      studio.setNotice('浏览器暂时无法进入全屏。可先收起左右栏扩大画布。');
    }
  }
  const [studioTab, setStudioTab] = useState(true);
  const [divisionTab, setDivisionTab] = useState(false);
  const [geographyTab, setGeographyTab] = useState(false);
  const [placesTab, setPlacesTab] = useState(false);
  const [geographySection, setGeographySection] = useState<'divisions' | 'military'>('military');
  const surfaceId = `atlas-surface-${useId().replaceAll(':', '')}`;
  const [geographicLayer, setGeographicLayer] = useState<GeographicLayer>('atlas');
  const [geographyTool, setGeographyTool] = useState<GeographyTool>('pan');
  const [selectedGeoDivision, setSelectedGeoDivision] = useState<string>();
  const [selectedGeoKind, setSelectedGeoKind] = useState<DivisionKind>('country');
  const [geographyDraft, setGeographyDraft] = useState<GeneratedGeography>();
  const [militaryDraft, setMilitaryDraft] = useFrameState<MapMilitaryLine | undefined>(undefined);
  const geographyGesture = useRef<
    | {
        line?: MapMilitaryLine;
        node?: number;
        selection?: {
          id: number;
          start: Point;
          client: Point;
          view: typeof view;
          shift: boolean;
          group: boolean;
          kind: DivisionKind;
          moved: boolean;
        };
        source: GeneratedGeography;
      }
    | undefined
  >(undefined);
  const [showDivisions, setShowDivisions] = useState(true);
  const [terrainPending, setTerrainPending] = useState(false);
  const [elevation, setElevation] = useState<ElevationField>();
  const [generatedCoasts, setGeneratedCoasts] = useState<MapPoint[][]>();
  const [terrainError, setTerrainError] = useState('');
  const [view, setViewState, latestView] = useFrameState({ x: 0, y: 0, zoom: 1 });
  const [draftStroke, setDraftStroke] = useFrameState<MapStroke | undefined>(undefined);
  const [draftPin, setDraftPin] = useFrameState<Point | undefined>(undefined);
  const [color, setColor] = useState('#6d8664');
  const [width, setWidth] = useState(12);
  const [grid, setGrid] = useState(false);
  const [showTerrain, setShowTerrain] = useState(true);
  const [showPins, setShowPins] = useState(true);
  const [showStrokes, setShowStrokes] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [seedDraft, setSeedDraft] = useState('');
  const [mapNameDraft, setMapNameDraft] = useState('');
  const [pinNameDraft, setPinNameDraft] = useState('');
  const [newMap, setNewMap] = useState<{ parentId?: string; pinId?: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<AtlasMap['kind']>('world');
  const [newSource, setNewSource] = useState(freshMapCreationSource);
  const [newSize, setNewSize] = useState<MapDimensions>(mapSizePresets.world);
  const [hoverPin, setHoverPin] = useState<string>();
  const [notePreviewId, setNotePreviewId] = useState<string>();
  const [, setHistoryVersion] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null),
    groupRef = useRef<SVGGElement>(null);
  const createModalRef = useRef<HTMLFormElement>(null);
  const mapsRef = useRef(maps);
  mapsRef.current = maps;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const history = useRef<Record<string, { past: AtlasMap[]; future: AtlasMap[] }>>({});
  const interaction = useRef<
    | {
        kind: 'pan' | 'stroke' | 'pin' | 'erase';
        start: Point;
        view?: typeof view;
        stroke?: MapStroke;
        pinId?: string;
        point?: Point;
        preview?: Point;
        before?: AtlasMap;
      }
    | undefined
  >(undefined);
  const map = maps.find((item) => item.id === currentId) || maps[0];
  const panCamera = useMapPanCamera(svgRef, view, map?.id, setViewState, latestView, () => {
    if (interaction.current?.kind === 'pan') interaction.current = undefined;
    if (geographyGesture.current?.selection) geographyGesture.current = undefined;
  });
  const setView = panCamera.replace;
  const writable = Boolean(map && access.update('maps', map));
  const geography = geographyDraft ?? map?.editor?.generated?.geography;
  const labelObstacles = useMemo(
    () =>
      (map?.pins ?? [])
        .filter((p) => showPins && !featureHidden(map!, 'settlements', p.id))
        .map((p) => {
          const unit = (map?.width ?? 1000) / 1000;
          return {
            x: p.x - 12 * unit,
            y: p.y - 24 * unit,
            width: Math.max(32, p.label.length * 7 + 24) * unit,
            height: 42 * unit,
          };
        }),
    [map?.pins, map?.width, map?.editor?.hiddenFeatures, showPins],
  );
  const authoredTextureObjects = useMemo(() => {
    if (!map?.editor?.objects.length) return [];
    const hidden = hiddenFeatureObjects(map, 'object');
    return map.editor.objects.filter((object) => object.visible && !hidden.has(object.id));
  }, [
    map?.editor?.objects,
    map?.editor?.generated,
    Boolean(map?.editor?.generation),
    map?.editor?.hiddenFeatures,
  ]);
  const renderUnderlay = useCallback<GeographicUnderlayRenderer>(
    (geography, objects, elevation, mapKind, sites) => (
      <GeographicArtwork
        phase="underlay"
        geography={geography}
        layer={geographicLayer}
        objects={objects}
        elevation={elevation}
        mapKind={mapKind}
        sites={sites}
        obstacles={labelObstacles}
        extraTextureObjects={authoredTextureObjects}
        names={false}
        routes={false}
      />
    ),
    [geographicLayer, labelObstacles, authoredTextureObjects],
  );
  const geographicSelection = useGeographicSelection(map?.id, geography);
  const selectionSurface = useMemo(
    () => restoreElevation(map?.editor?.generated?.elevation),
    [map?.editor?.generated?.elevation],
  );
  const edgeGraph = useMemo(
    () => map?.editor?.generated?.geography && frontierGraph(map.editor.generated.geography),
    [map?.editor?.generated?.geography],
  );
  useEffect(() => {
    setGeographyDraft(undefined);
    setMilitaryDraft(undefined);
    geographyGesture.current = undefined;
    setGeographyTool('pan');
    setGeographicLayer('atlas');
    setSelectedGeoDivision(undefined);
    setSelectedGeoKind('country');
    setPlacesTab(false);
  }, [map?.id]);
  const studio = useMapStudio(map, update, tool, setTool);
  const legend = useMemo<LegendItem[]>(() => {
    if (!map) return [];
    if (geography && !studio.sourcePreview && geographicLayer !== 'atlas') {
      if (geographicLayer === 'elevation') return [];
      if (geographicLayer === 'temperature' || geographicLayer === 'precipitation')
        return climateLegendItems(geographicLayer);
      if (geographicLayer === 'plates')
        return geography.plates.map((p) => ({
          id: String(p.id),
          label: plateDisplayName(p, geography.seed),
          color: p.color,
        }));
      if (geographicLayer === 'regions')
        return [
          { id: 'cell', label: '基础单元', color: '#857c69', line: true },
          {
            id: 'province',
            label:
              map.kind === 'town' ? '街区边界' : map.kind === 'region' ? '地区边界' : '省区边界',
            color: '#6b5c48',
            line: true,
          },
          { id: 'country', label: '国界', color: '#66523d', line: true },
        ];
      if (geographicLayer === 'terrain')
        return [...new Set(geography.cells.map((c) => c.biome))].map((biome) => {
          const item = biomeCatalog.find((b) => b.id === biome)!;
          return { id: biome, label: item.label, color: terrainLayerColors[biome] };
        });
      const kind =
        geographicLayer === 'countries'
          ? 'country'
          : geographicLayer === 'cultures'
            ? 'culture'
            : 'religion';
      return geography.divisions
        .filter((d) => d.kind === kind && geography.cells.some((c) => c[kind] === d.id))
        .map((d) => ({ id: d.id, label: d.name, color: d.color }));
    }
    const items = showTerrain
      ? authoredLegend(map, studio.sourcePreview, showStrokes)
      : authoredLegend({ ...map, editor: undefined }, false, showStrokes);
    if (showTerrain && !studio.sourcePreview) {
      if (map.editor?.regions.length || map.editor?.generation) items.push(...generatedLegend);
      if ((map.editor?.baseVisible ?? true) && map.seed !== 0) {
        const t = generateTerrain(map.seed, map.width, map.height, map.kind, map.scaleKm);
        if (t.land.length && map.kind !== 'town')
          items.push({ id: 'sea', label: '海域', color: parchmentSea });
        for (const kind of new Set(t.symbols.map((s) => s.kind)))
          items.push({
            id: kind,
            label: kind === 'tree' ? '林木' : '山脉',
            symbol: kind,
            color: kind === 'tree' ? '#82956c' : '#b8a486',
          });
        if (t.rivers.length)
          items.push({ id: 'river', label: '河流', color: '#657d79', line: true });
        if (t.roads.length) items.push({ id: 'road', label: '道路', color: '#95805c', line: true });
      }
    }
    if (showPins)
      for (const kind of new Set(
        map.pins.filter((p) => !featureHidden(map, 'settlements', p.id)).map((p) => p.kind),
      ))
        items.push({ id: `pin_${kind}`, label: `${pinKinds[kind]}标记`, color: '#456c58' });
    if (geography && !studio.sourcePreview) {
      if (geography.borders.some((b) => b.kind === 'country'))
        items.push({ id: 'national-border', label: '国界', color: '#706044', line: true });
      if (geography.ports.some((p) => !featureHidden(map, 'ports', p.id)))
        items.push({ id: 'port', label: '港口', color: '#435f62', symbol: 'port' });
      if (geography.seaRoutes.some((r) => !featureHidden(map, 'seaRoutes', r.id)))
        items.push({ id: 'sea-route', label: '海路', color: '#537b83', line: true });
    }
    return [...new Map(items.map((i) => [i.id, i])).values()];
  }, [
    map,
    studio.sourcePreview,
    showTerrain,
    showPins,
    showStrokes,
    generatedLegend,
    geography,
    geographicLayer,
  ]);
  const divisionStudio = useDivisionStudio(map, update, divisionTab, studio.radius);
  const coastlines = useMemo(() => {
    if (!map || terrainPending || terrainError || studio.sourcePreview) return;
    if (map.editor?.generation || map.editor?.regions.length) return generatedCoasts;
    const frozen = map.editor && coastlinesFromObjects(map.editor.objects);
    if (frozen?.length) return frozen;
    if (map.editor?.baseVisible === false || map.seed === 0 || map.kind === 'town') return [];
    return generateTerrain(map.seed, map.width, map.height, map.kind, map.scaleKm).land.map(
      (land) => sampleCurve(land.points, true, map.width, map.height),
    );
  }, [map, generatedCoasts, terrainPending, terrainError, studio.sourcePreview]);
  // Continue the map's full-canvas ground into the letterboxed viewport. This
  // also follows the editable sea polygon after a generated map is frozen.
  const backgroundObject = useMemo(
    () =>
      [...studio.editor.objects]
        .reverse()
        .find(
          (object) =>
            object.visible &&
            object.layer === 'base' &&
            object.kind === 'polygon' &&
            object.opacity === 1 &&
            !object.blur &&
            object.color !== 'none' &&
            object.points.length === 4 &&
            new Set(object.points.map((point) => `${point.x},${point.y}`)).size === 4 &&
            object.points.every(
              (point) =>
                (point.x === 0 || point.x === map?.width) &&
                (point.y === 0 || point.y === map?.height),
            ),
        ),
    [studio.editor.objects, map?.width, map?.height],
  );
  const displayElevation =
    studio.terrainView === 'elevation' && studio.editor.generation?.version === 2;
  const cursorVisible =
    !fullscreen &&
    (displayElevation ||
      (divisionTab
        ? ['paint', 'erase'].includes(divisionStudio.tool)
        : ['terrain', 'cluster', 'sampler', 'elevation'].includes(tool)));
  useEffect(() => {
    if (!cursorVisible) studio.setCursor(null);
  }, [cursorVisible, studio.setCursor]);
  const militaryLines = useMemo(
    () =>
      militaryDraft
        ? [...(map?.editor?.military ?? []), militaryDraft]
        : (map?.editor?.military ?? []),
    [map?.editor?.military, militaryDraft],
  );
  const canvasBackground = displayElevation
    ? '#66888e'
    : !showTerrain
      ? parchmentPaper
      : studio.editor.generation && !studio.sourcePreview
        ? parchmentSea
        : backgroundObject?.color ||
          (map?.seed === 0 || map?.kind === 'town' ? parchmentPaper : parchmentSea);
  const currentIdRef = useRef(map?.id);
  currentIdRef.current = map?.id;
  const selectedPin = map?.pins.find((pin) => pin.id === selectedPinId);
  const entity = selectedPin?.entityId
    ? entities.find((item) => item.id === selectedPin.entityId)
    : undefined;
  useEffect(() => {
    setNotePreviewId(undefined);
    if (!hoverPin) return;
    const timer = setTimeout(() => setNotePreviewId(hoverPin), TOOLTIP_SHOW_MS);
    return () => clearTimeout(timer);
  }, [hoverPin, map?.id]);
  const hoveredPin =
    hoverPin === notePreviewId ? map?.pins.find((pin) => pin.id === hoverPin) : undefined;
  const hoveredEntity = entities.find((item) => item.id === hoveredPin?.entityId);
  const currentHistory = map ? history.current[map.id] : undefined;
  const childMaps = maps.filter((item) => item.parentId === map?.id);
  const ancestors: AtlasMap[] = [];
  if (map) {
    let item: AtlasMap | undefined = map;
    const visited = new Set<string>();
    while (item && !visited.has(item.id)) {
      visited.add(item.id);
      ancestors.unshift(item);
      item = maps.find((m) => m.id === item!.parentId);
    }
  }

  useEffect(() => {
    if (selectedMapId && maps.some((item) => item.id === selectedMapId))
      setCurrentId(selectedMapId);
  }, [selectedMapId]);
  useEffect(() => {
    setCurrentId(
      selectedMapId && maps.some((item) => item.id === selectedMapId)
        ? selectedMapId
        : maps[0]?.id || '',
    );
    setNewMap(null);
    history.current = {};
  }, [worldId]);
  useEffect(() => {
    setSelectedPinId(undefined);
    setGeneratedSettlements([]);
    setTool('pan');
    setView({ x: 0, y: 0, zoom: 1 });
    setDraftStroke(undefined);
    setDraftPin(undefined);
    interaction.current = undefined;
  }, [map?.id]);
  useEffect(() => {
    setSeedDraft(String(map?.editor?.generation?.seed ?? map?.seed ?? 0));
  }, [map?.id, map?.editor?.generation?.seed, map?.seed]);
  useEffect(() => setMapNameDraft(map?.name || ''), [map?.id, map?.name]);
  useEffect(() => setPinNameDraft(selectedPin?.label || ''), [selectedPin?.id, selectedPin?.label]);
  useEffect(() => {
    if (!newMap) return;
    const previous = document.activeElement as HTMLElement | null;
    createModalRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNewMap(null);
      if (event.key === 'Tab') {
        const nodes = createModalRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [Boolean(newMap)]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const viewport = panCamera.frame.current ?? svg;
    const wheel = (input: Event) => {
      const event = input as WheelEvent;
      event.preventDefault();
      if (interaction.current?.kind === 'pan' || geographyGesture.current?.selection) {
        panCamera.move(event);
        interaction.current = undefined;
        if (geographyGesture.current?.selection) geographyGesture.current = undefined;
      }
      panCamera.zoomAt(event, event.deltaY > 0 ? 0.9 : 1.1);
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [map?.id]);

  function emit(next: AtlasMap[]) {
    mapsRef.current = next;
    onChangeRef.current(next);
  }
  function remember(before: AtlasMap) {
    const item =
      history.current[before.id] || (history.current[before.id] = { past: [], future: [] });
    item.past = [...item.past.slice(-39), historyCopy(before)];
    item.future = [];
    setHistoryVersion((v) => v + 1);
  }
  function historyCopy(source: AtlasMap): AtlasMap {
    // Accepted snapshots are immutable. Share this large payload across undo
    // entries, while keeping authored arrays isolated from gesture previews.
    const copy: AtlasMap = structuredClone({
      ...source,
      editor: source.editor && { ...source.editor, generated: undefined },
    });
    if (copy.editor) copy.editor.generated = source.editor?.generated;
    return copy;
  }
  function update(patch: Partial<AtlasMap>, record = true) {
    if (!writable) return;
    const before = mapsRef.current.find((m) => m.id === map?.id);
    if (!before) return;
    if (record) remember(before);
    emit(mapsRef.current.map((m) => (m.id === before.id ? { ...m, ...patch } : m)));
  }
  // Geometry does not change while the view moves. A stable callback lets the
  // memoized artwork skip those frames while accepting against current data.
  const acceptGeneratedRef = useRef<(snapshot: GeneratedMapSnapshot) => void>(() => {});
  const generationMapId = map?.id;
  const acceptGenerated = useCallback(
    (snapshot: GeneratedMapSnapshot) => {
      // An old worker may finish after navigation. Even identical recipes on two
      // maps must not let the previous map's completion attach to the new map.
      if (!generationMapId || currentIdRef.current !== generationMapId) return;
      acceptGeneratedRef.current(snapshot);
    },
    [generationMapId],
  );
  acceptGeneratedRef.current = (snapshot: GeneratedMapSnapshot) => {
    const current = mapsRef.current.find((m) => m.id === map?.id);
    if (
      !current?.editor ||
      !writable ||
      studio.draftRegion ||
      studio.draftElevation ||
      current.editor.generated?.signature === snapshot.signature
    )
      return;
    if (
      generationSignature(
        current.editor.regions,
        current.width,
        current.height,
        current.editor.generation,
        current.scaleKm,
        current.kind,
      ) !== snapshot.signature
    )
      return;
    const accepted = snapshot.geography
      ? {
          ...snapshot,
          geography: preserveGeographicNames(
            snapshot.geography,
            current.editor.generated?.geography,
          ),
        }
      : snapshot;
    const military = current.editor.military?.filter(
      (l) =>
        l.kind !== 'front' ||
        (accepted.geography &&
          lineOnFront(
            l.points,
            accepted.geography,
            Math.max(current.width, current.height) * 0.00005,
          )),
    );
    const associated = associateGeographicDivisions(
      { ...current, editor: { ...current.editor, generated: accepted, military } },
      entities,
      { world, actorId: access.actor.id, canCreate: access.create('lore') },
    );
    mapsRef.current = mapsRef.current.map((m) => (m.id === associated.map.id ? associated.map : m));
    onCommitGenerated(associated.map, associated.entities);
    if (associated.unlinked)
      studio.setNotice(
        `地图已生成；${associated.unlinked}个分区尚未关联条目。当前账号没有创建设定权限，可在疆域分区中关联已有条目。`,
      );
  };
  function changeGeography(next: GeneratedGeography) {
    const current = mapsRef.current.find((m) => m.id === map?.id);
    if (!current?.editor?.generated || terrainPending) return;
    update({
      editor: { ...current.editor, generated: { ...current.editor.generated, geography: next } },
    });
  }
  function buildGeography(settings: GeographicSettings) {
    const previous = studio.editor.generation;
    const seed = previous?.seed ?? map!.seed;
    if (
      settings.source === 'sketch' &&
      !studio.editor.regions.some((r) => r.visible && r.biome !== 'water')
    ) {
      studio.setNotice('请先用地形色块画出陆地，再构建地理。');
      return;
    }
    studio.commit({
      baseVisible: false,
      generated: studio.editor.generated && {
        ...studio.editor.generated,
        signature: '0000000000000000-0',
      },
      generation: {
        ...(previous ?? { climate: 'temperate', settlements: 8, rivers: true, routes: true }),
        version: 2,
        seed,
        detail: previous?.version === 2 ? previous.detail : 'high',
        linework: 'organic',
        geography: settings,
        elevation:
          previous?.version === 2 && previous.elevation
            ? previous.elevation
            : {
                version: 1,
                preset: settings.source === 'sketch' ? 'sketch' : 'continent',
                seed,
                relief: 1,
                seaLevel: 0,
                strokes: [],
              },
      },
    });
    studio.setSourcePreview(false);
    studio.setTerrainView('atlas');
    setGeographicLayer('atlas');
    setTool('pan');
  }
  async function importMapImage(file: File, options: MapImageImportOptions) {
    if (options.mode === 'new' ? !access.create('maps') : !writable)
      throw new Error('当前账户没有执行此地图导入操作的权限。');
    if (!options.name.trim()) throw new Error('请填写图片地图名称。');
    const targetId = map?.id;
    if (options.mode === 'overlay' && (!map || (map.editor?.objects.length ?? 0) >= 8000))
      throw new Error('请选择尚有组件容量的地图再导入。');
    const uploaded = await uploadMapImage(file);
    if (options.mode === 'new') {
      const width = Math.max(100, Math.min(10000, uploaded.width));
      const height = Math.max(100, Math.min(10000, uploaded.height));
      const image = fitMapImage(
        uploaded.url,
        options.name,
        width,
        height,
        uploaded.width,
        uploaded.height,
      );
      const created: AtlasMap = {
        createdBy: access.actor.id,
        id: makeId('map'),
        worldId,
        name: options.name.trim(),
        summary: '导入图片地图',
        kind: options.kind,
        width,
        height,
        scaleKm: options.scaleKm,
        seed: 0,
        pins: [],
        strokes: [],
        editor: { ...createEditorData(), mode: 'detail', baseVisible: false, objects: [image] },
      };
      emit([...mapsRef.current, created]);
      setCurrentId(created.id);
    } else {
      const target = mapsRef.current.find((m) => m.id === targetId);
      if (!target) throw new Error('原地图已不存在，请重新选择导入目标。');
      const editor = target.editor ?? createEditorData();
      if (editor.objects.length >= 8000) throw new Error('当前地图组件已达上限，请先整理。');
      const image = fitMapImage(
        uploaded.url,
        options.name,
        target.width,
        target.height,
        uploaded.width,
        uploaded.height,
        true,
      );
      remember(target);
      emit(
        mapsRef.current.map((m) =>
          m.id === target.id
            ? { ...m, editor: { ...editor, objects: [...editor.objects, image] } }
            : m,
        ),
      );
    }
    setTool('pan');
    setStudioTab(true);
    setDivisionTab(false);
    studio.setSourcePreview(false);
    studio.setNotice('图片已导入并锁定，可从精细编辑的对象列表调整。');
  }
  function updatePin(patch: Partial<MapPin>) {
    const current = mapsRef.current.find((m) => m.id === map?.id);
    if (current && selectedPinId)
      update({
        pins: current.pins.map((pin) => (pin.id === selectedPinId ? { ...pin, ...patch } : pin)),
      });
  }
  function commitMapName() {
    const name = mapNameDraft.trim();
    if (name && name !== map?.name) update({ name });
    setMapNameDraft(name || map?.name || '');
  }
  function commitPinName() {
    const label = pinNameDraft.trim();
    if (label && label !== selectedPin?.label) updatePin({ label });
    setPinNameDraft(label || selectedPin?.label || '');
  }
  function travelHistory(redo = false) {
    if (!map) return;
    const item = history.current[map.id];
    const stack = redo ? item?.future : item?.past;
    if (!item || !stack?.length) return;
    studio.cancel();
    divisionStudio.cancel();
    studio.setNotice('');
    studio.setBakeConfirm(false);
    studio.setFreshConfirm(false);
    const saved = stack.pop()!;
    const current = mapsRef.current.find((m) => m.id === map.id)!;
    (redo ? item.past : item.future).push(historyCopy(current));
    emit(mapsRef.current.map((m) => (m.id === map.id ? saved : m)));
    setSeedDraft(String(saved.editor?.generation?.seed ?? saved.seed));
    setHistoryVersion((v) => v + 1);
  }
  function localPoint(event: ReactPointerEvent, untransformed = false): Point {
    const svg = svgRef.current!,
      matrix = (untransformed ? svg : groupRef.current!)?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }
  function bounded(p: Point): Point {
    return {
      x: Math.max(0, Math.min(map!.width, p.x)),
      y: Math.max(0, Math.min(map!.height, p.y)),
    };
  }
  function eraseAt(p: Point) {
    const current = mapsRef.current.find((m) => m.id === map?.id);
    if (!current) return;
    const strokes = current.strokes.filter(
      (stroke) =>
        featureHidden(current, 'roads', stroke.id) ||
        !stroke.points.some(
          (point, i) =>
            distanceToSegment(p, point, stroke.points[Math.max(0, i - 1)]) <
            stroke.width / 2 + 9 / latestView().zoom,
        ),
    );
    if (strokes.length !== current.strokes.length) update({ strokes }, false);
  }
  function beginPan(event: ReactPointerEvent<SVGSVGElement>) {
    interaction.current = { kind: 'pan', start: localPoint(event, true), view };
    panCamera.begin(event);
  }
  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (!map || event.button !== 0) return;
    panCamera.finish();
    const point = bounded(localPoint(event));
    svgRef.current?.setPointerCapture(event.pointerId);
    if (fullscreen) {
      beginPan(event);
      return;
    }
    if (
      geographyTab &&
      geographyTool !== 'pan' &&
      writable &&
      geography &&
      !terrainPending &&
      !studio.sourcePreview
    ) {
      if (geographyTool === 'assign') {
        const cell = selectableGeographicCell(geography, point, selectionSurface);
        if (!cell) {
          beginPan(event);
          return;
        }
        geographyGesture.current = {
          source: geography,
          selection: {
            id: cell.id,
            start: localPoint(event, true),
            client: { x: event.clientX, y: event.clientY },
            view,
            shift: event.shiftKey,
            group: event.ctrlKey || event.metaKey,
            kind: selectedGeoKind,
            moved: false,
          },
        };
        panCamera.begin(event);
        return;
      }
      if (
        (map.editor?.military?.length ?? 0) >= 128 ||
        (map.editor?.military ?? []).reduce((n, l) => n + l.points.length, 0) >= 32766
      ) {
        studio.setNotice('兵棋线条已达128条，请先整理。');
        return;
      }
      const node =
        geographyTool === 'front' && edgeGraph
          ? snapFrontPoint(point, edgeGraph, Math.max(map.width, map.height) / 32)
          : undefined;
      if (geographyTool === 'front' && node === undefined) {
        studio.setNotice('前线只能沿陆地区域边界绘制，请从边界附近开始。');
        return;
      }
      const line: MapMilitaryLine = {
        id: makeId('military'),
        name: militaryLineLabels[geographyTool],
        kind: geographyTool,
        points: [node !== undefined ? edgeGraph!.nodes[node] : point],
        color:
          geographyTool === 'advance'
            ? '#a54939'
            : geographyTool === 'retreat'
              ? '#577788'
              : '#7a4d3d',
        width: Math.max(0.8, Math.min(20, map.width / 550)),
        visible: true,
      };
      geographyGesture.current = { source: geography, line, node };
      setMilitaryDraft(line);
      return;
    }
    if (geographyTab && geographyTool === 'pan') {
      beginPan(event);
      return;
    }
    if (divisionTab && divisionStudio.pointerDown(event, point)) {
      setSelectedPinId(undefined);
      return;
    }
    if (divisionTab && divisionStudio.tool === 'pan') {
      beginPan(event);
      return;
    }
    if (studio.pointerDown(event, point)) {
      setSelectedPinId(undefined);
      setStudioTab(true);
      return;
    }
    if (tool === 'pan' || (tool === 'select' && !event.ctrlKey)) {
      setSelectedPinId(undefined);
      beginPan(event);
    } else if (tool === 'pin') {
      const pin: MapPin = {
        id: makeId('pin'),
        ...point,
        label: '未命名地点',
        description: '',
        kind: 'landmark',
      };
      update({ pins: [...map.pins, pin] });
      setSelectedPinId(pin.id);
      setTool('select');
    } else if (tool === 'erase') {
      interaction.current = { kind: 'erase', start: point, before: historyCopy(map) };
      eraseAt(point);
    } else if (tool === 'brush' || tool === 'road' || tool === 'river') {
      const stroke: MapStroke = {
        id: makeId('stroke'),
        points: [point],
        color: tool === 'road' ? '#a59168' : tool === 'river' ? '#7aa9a8' : color,
        width: tool === 'brush' ? width : tool === 'road' ? 3 : 5,
        tool,
      };
      interaction.current = { kind: 'stroke', start: point, stroke };
      setDraftStroke(stroke);
    }
  }
  function pinDown(event: ReactPointerEvent<SVGGElement>, pin: MapPin) {
    event.stopPropagation();
    if (event.button !== 0) return;
    panCamera.finish();
    setSelectedPinId(pin.id);
    if (event.ctrlKey && pin.entityId) {
      onOpenEntity(pin.entityId);
      return;
    }
    if (tool === 'select' && !fullscreen) {
      svgRef.current?.setPointerCapture(event.pointerId);
      interaction.current = {
        kind: 'pin',
        start: localPoint(event),
        pinId: pin.id,
        point: { x: pin.x, y: pin.y },
      };
    }
  }
  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    // Panning needs only client deltas. Avoid forcing SVG layout just to ask
    // inactive drawing tools whether they have a gesture.
    if (map && interaction.current?.kind === 'pan' && panCamera.move(event)) return;
    if (map && cursorVisible) studio.setCursor(bounded(localPoint(event)));
    const geoActive = geographyGesture.current;
    if (geoActive && map) {
      if (geoActive.selection) {
        if (
          Math.hypot(
            event.clientX - geoActive.selection.client.x,
            event.clientY - geoActive.selection.client.y,
          ) > 4
        )
          geoActive.selection.moved = true;
        if (geoActive.selection.moved && !panCamera.move(event)) {
          const screen = localPoint(event, true);
          setView({
            ...geoActive.selection.view,
            x: geoActive.selection.view.x + screen.x - geoActive.selection.start.x,
            y: geoActive.selection.view.y + screen.y - geoActive.selection.start.y,
          });
        }
      } else if (geoActive.line) {
        const p = bounded(localPoint(event));
        let addition: MapPoint[] = [];
        if (geoActive.line.kind === 'front' && edgeGraph) {
          const next = snapFrontPoint(p, edgeGraph, Math.max(map.width, map.height) / 32);
          if (next !== undefined && next !== geoActive.node)
            addition = followFrontEdge(edgeGraph, geoActive.node!, next).slice(1);
        } else if (
          Math.hypot(p.x - geoActive.line.points.at(-1)!.x, p.y - geoActive.line.points.at(-1)!.y) >
          3 / latestView().zoom
        )
          addition = [p];
        if (
          addition.length &&
          geoActive.line.points.length + addition.length <= 2000 &&
          (map.editor?.military ?? []).reduce((n, l) => n + l.points.length, 0) +
            geoActive.line.points.length +
            addition.length <=
            32768
        ) {
          if (geoActive.line.kind === 'front' && edgeGraph)
            geoActive.node = snapFrontPoint(addition.at(-1)!, edgeGraph, 0.01);
          geoActive.line = { ...geoActive.line, points: [...geoActive.line.points, ...addition] };
          setMilitaryDraft(geoActive.line);
        }
      }
      return;
    }
    if (!fullscreen && map && divisionStudio.pointerMove(bounded(localPoint(event)))) return;
    if (!fullscreen && map && studio.pointerMove(bounded(localPoint(event)))) return;
    const active = interaction.current;
    if (!active || !map) return;
    if (active.kind === 'pan') {
      if (panCamera.move(event)) return;
      const point = localPoint(event, true);
      setView({
        ...active.view!,
        x: active.view!.x + point.x - active.start.x,
        y: active.view!.y + point.y - active.start.y,
      });
    }
    if (active.kind === 'pin') {
      const point = localPoint(event);
      active.preview = bounded({
        x: active.point!.x + point.x - active.start.x,
        y: active.point!.y + point.y - active.start.y,
      });
      setDraftPin(active.preview);
    }
    if (active.kind === 'erase') eraseAt(bounded(localPoint(event)));
    if (active.kind === 'stroke') {
      const point = bounded(localPoint(event));
      const previous = active.stroke!.points.at(-1)!;
      if (Math.hypot(point.x - previous.x, point.y - previous.y) < 2 / latestView().zoom) return;
      active.stroke = { ...active.stroke!, points: [...active.stroke!.points, point] };
      setDraftStroke(active.stroke);
    }
  }
  function pointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    // A browser can deliver the release before the next animation frame (or
    // without a move at the release position). Sample it into the gesture refs
    // before any tool commits; the preview is only a throttled view of them.
    pointerMove(event);
    const geoActive = geographyGesture.current;
    if (geoActive && map) {
      if (geoActive.selection) panCamera.finish();
      if (geoActive.selection && !geoActive.selection.moved)
        geographicSelection.selectCell(geoActive.selection.id, {
          extend: geoActive.selection.shift,
          group: geoActive.selection.group,
          kind: geoActive.selection.kind,
        });
      if (geoActive.line && geoActive.line.points.length >= 2)
        update({
          editor: {
            ...studio.editor,
            military: [...(studio.editor.military ?? []), geoActive.line],
          },
        });
      geographyGesture.current = undefined;
      setGeographyDraft(undefined);
      setMilitaryDraft(undefined);
      if (svgRef.current?.hasPointerCapture(event.pointerId))
        svgRef.current.releasePointerCapture(event.pointerId);
      return;
    }
    if (divisionStudio.pointerUp()) {
      if (svgRef.current?.hasPointerCapture(event.pointerId))
        svgRef.current.releasePointerCapture(event.pointerId);
      return;
    }
    if (studio.pointerUp()) {
      if (svgRef.current?.hasPointerCapture(event.pointerId))
        svgRef.current.releasePointerCapture(event.pointerId);
      return;
    }
    const active = interaction.current;
    if (!active || !map) return;
    // Persist ref-backed samples, never the potentially older preview frame.
    if (active.kind === 'pan') panCamera.finish();
    if (active.kind === 'stroke' && active.stroke)
      update({ strokes: [...map.strokes, active.stroke] });
    if (
      active.kind === 'pin' &&
      active.preview &&
      active.point &&
      Math.hypot(active.preview.x - active.point.x, active.preview.y - active.point.y) > 1e-6
    )
      update({
        pins: map.pins.map((pin) =>
          pin.id === active.pinId ? { ...pin, ...active.preview } : pin,
        ),
      });
    if (
      active.kind === 'erase' &&
      active.before &&
      mapsRef.current.find((m) => m.id === map.id)?.strokes.length !== active.before.strokes.length
    )
      remember(active.before);
    interaction.current = undefined;
    setDraftStroke(undefined);
    setDraftPin(undefined);
    if (svgRef.current?.hasPointerCapture(event.pointerId))
      svgRef.current.releasePointerCapture(event.pointerId);
  }
  function pointerCancel() {
    panCamera.finish();
    geographyGesture.current = undefined;
    setGeographyDraft(undefined);
    setMilitaryDraft(undefined);
    studio.cancel();
    divisionStudio.cancel();
    const active = interaction.current;
    if (
      active?.kind === 'erase' &&
      active.before &&
      mapsRef.current.find((m) => m.id === active.before!.id)?.strokes.length !==
        active.before.strokes.length
    )
      remember(active.before);
    interaction.current = undefined;
    setDraftStroke(undefined);
    setDraftPin(undefined);
  }
  function openCreate(parentId?: string, pinId?: string) {
    if (!access.create('maps')) return;
    setNewName(pinId ? `${selectedPin?.label || '地点'} · 详图` : '');
    setNewKind(parentId ? (map?.kind === 'world' ? 'region' : 'town') : 'world');
    setNewSize(mapSizePresets[parentId ? (map?.kind === 'world' ? 'region' : 'town') : 'world']);
    setNewSource(freshMapCreationSource());
    setNewMap({ parentId, pinId });
  }
  function createMap() {
    if (!newName.trim() || !newMap || newSource.busy) return;
    const seed = Number(newSource.seed);
    if (!newSource.seed.trim() || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) return;
    if (newMap.parentId && !mapsRef.current.some((item) => item.id === newMap.parentId)) {
      setNewMap(null);
      return;
    }
    const created: AtlasMap = {
      createdBy: access.actor.id,
      id: makeId('map'),
      worldId,
      name: newName.trim(),
      summary: '',
      kind: newKind,
      parentId: newMap.parentId,
      seed,
      width: newSize.width,
      height: newSize.height,
      scaleKm: newSize.scaleKm,
      pins: [],
      strokes: [],
      editor: {
        version: 1,
        mode: 'sketch',
        baseVisible: false,
        regions:
          newSource.source === 'sketch' && newSource.image
            ? colorBlockRegions(newSource.image, newSize.width, newSize.height, seed)
            : [],
        objects: [],
        generation: {
          version: 2,
          detail: 'high',
          linework: 'organic',
          seed,
          climate: 'temperate',
          settlements: newKind === 'world' ? 10 : newKind === 'region' ? 6 : 3,
          settlementCounts:
            newKind === 'world'
              ? { village: 4, town: 2, city: 2, castle: 1, camp: 1 }
              : newKind === 'region'
                ? { village: 2, town: 1, city: 1, castle: 1, camp: 1 }
                : { village: 0, town: 1, city: 1, castle: 1, camp: 0 },
          rivers: true,
          routes: true,
          elevation: {
            version: 1,
            preset: newSource.source === 'sketch' ? 'sketch' : newSource.preset,
            seed,
            relief: 1,
            seaLevel: 0,
            strokes: [],
          },
          geography: {
            ...defaultGeographicSettings(newKind),
            ...newSource.extent,
            source: newSource.source,
            ...(newSource.source === 'sketch'
              ? { sketchMode: newSource.sketchMode ?? 'balanced' }
              : {}),
          },
        },
      },
    };
    if (created.editor?.generation?.version === 2 && created.editor.generation.elevation) {
      created.editor.generation.seed = created.seed;
      created.editor.generation.elevation.seed = created.seed;
    }
    const next = mapsRef.current.map((item) =>
      item.id === newMap.parentId && newMap.pinId
        ? {
            ...item,
            pins: item.pins.map((pin) =>
              pin.id === newMap.pinId ? { ...pin, childMapId: created.id } : pin,
            ),
          }
        : item,
    );
    emit([...next, created]);
    setCurrentId(created.id);
    setDivisionTab(false);
    setStudioTab(true);
    setNewMap(null);
  }
  function zoom(delta: number) {
    if (!map) return;
    panCamera.zoomBy(delta);
  }
  function removeMap() {
    if (!map || !window.confirm(`删除「${map.name}」？子地图将保留并移至顶层。此操作无法撤销。`))
      return;
    history.current = {};
    emit(
      mapsRef.current
        .filter((m) => m.id !== map.id)
        .map((m) => ({
          ...m,
          parentId: m.parentId === map.id ? undefined : m.parentId,
          pins: m.pins.map((pin) =>
            pin.childMapId === map.id ? { ...pin, childMapId: undefined } : pin,
          ),
        })),
    );
    setCurrentId(map.parentId || '');
  }
  async function exportSvg() {
    if (studio.sourcePreview) {
      studio.setNotice('请切换到生成预览后再导出地图。');
      return;
    }
    if (terrainPending || svgRef.current?.querySelector('[data-terrain-pending="true"]')) {
      studio.setNotice('正在融合最新地形，请稍后导出。');
      return;
    }
    if (svgRef.current?.querySelector('[data-terrain-error="true"]')) {
      studio.setNotice('请先调整无法合成的区域，再导出地图。');
      return;
    }
    if (!map || !svgRef.current) return;
    const snapshot = svgRef.current.cloneNode(true) as SVGSVGElement;
    snapshot.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    snapshot.setAttribute('width', String(map.width));
    snapshot.setAttribute('height', String(map.height));
    snapshot.setAttribute('role', 'img');
    snapshot.setAttribute('aria-label', map.name);
    snapshot.removeAttribute('class');
    snapshot.querySelector('[data-map-viewport]')?.removeAttribute('transform');
    snapshot.querySelectorAll('[tabindex]').forEach((node) => node.removeAttribute('tabindex'));
    snapshot.querySelectorAll('.atlas-pin').forEach((node) => node.removeAttribute('role'));
    snapshot
      .querySelectorAll('[data-editor-overlay],[data-editor-hit]')
      .forEach((node) => node.remove());
    snapshot.querySelectorAll('[data-map-object],[data-map-region]').forEach((node) => {
      node.removeAttribute('data-map-object');
      node.removeAttribute('data-map-region');
    });
    snapshot.querySelectorAll('[fill="transparent"]').forEach((node) => node.remove());
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = map.name;
    snapshot.prepend(title);
    const desc = document.createElementNS('http://www.w3.org/2000/svg', 'desc');
    desc.textContent = `${map.summary} — ${BRAND_TITLE} · ${mapKinds[map.kind]} · seed ${map.seed}`;
    snapshot.append(desc);
    const filename =
      map.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '') || '世界地图';
    setExportingImages(true);
    try {
      await embedMapImages(snapshot);
    } catch (error) {
      studio.setNotice((error as Error).message);
      return;
    } finally {
      setExportingImages(false);
    }
    downloadFile(
      `${filename}.svg`,
      `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(snapshot)}`,
      'image/svg+xml;charset=utf-8',
    );
  }

  const modal = newMap && (
    <div
      className="atlas-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setNewMap(null);
      }}
    >
      <form
        ref={createModalRef}
        role="dialog"
        aria-modal="true"
        aria-label="绘制新的疆域"
        className="atlas-create-modal atlas-geographic-create"
        onSubmit={(event) => {
          event.preventDefault();
          createMap();
        }}
      >
        <div className="atlas-panel-heading">
          <h2>绘制新的疆域</h2>
          <button type="button" className="icon-btn" title="关闭" onClick={() => setNewMap(null)}>
            <X size={18} />
          </button>
        </div>
        <p>选择地图范围与创建方式，让地理、气候和疆域从同一片世界生长。</p>
        <label className="atlas-label">
          地图名称
          <input
            autoFocus
            className="field"
            placeholder="例如：暮星港与外城区"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            required
            maxLength={120}
          />
        </label>
        <label className="atlas-label">
          地图尺度
          <select
            className="field"
            value={newKind}
            onChange={(event) => {
              const kind = event.target.value as AtlasMap['kind'];
              setNewKind(kind);
              setNewSize(mapSizePresets[kind]);
            }}
          >
            {Object.entries(mapKinds).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <MapSizeFields value={newSize} onChange={setNewSize} />
        <MapCreationSource
          value={newSource}
          onChange={setNewSource}
          kind={newKind}
          width={newSize.width}
          height={newSize.height}
          scaleKm={newSize.scaleKm}
        />
        {newMap.parentId && (
          <div className="atlas-subtle">
            归属于：{maps.find((m) => m.id === newMap.parentId)?.name}
          </div>
        )}
        <button className="btn primary" type="submit" disabled={!newName.trim() || newSource.busy}>
          <Plus size={15} />
          创建地图
        </button>
      </form>
    </div>
  );
  if (!map)
    return (
      <div className="atlas-empty panel">
        <Compass size={42} />
        <h2>你的世界，从一张地图开始</h2>
        <p>生成世界、描绘城镇，把故事放在它发生的地方。</p>
        <button
          className="btn primary"
          disabled={!access.create('maps')}
          onClick={() => openCreate()}
        >
          <Plus size={16} />
          创建第一张地图
        </button>
        <button className="btn" onClick={() => setImageImportOpen(true)}>
          <ImagePlus size={16} />
          导入地图图片
        </button>
        {imageImportOpen && (
          <MapImageImport
            hasMap={false}
            onClose={() => setImageImportOpen(false)}
            onImport={importMapImage}
          />
        )}
        {modal}
      </div>
    );

  return (
    <div
      className={`atlas-workspace ${inspectorHidden ? 'inspector-hidden' : ''} ${fullscreen ? 'is-fullscreen' : ''}`}
    >
      <div className="atlas-topbar" hidden={fullscreen}>
        <div className="atlas-breadcrumb">
          <MapIcon size={17} />
          {ancestors.map((item, i) => (
            <span key={item.id}>
              {i > 0 && <ChevronRight size={13} />}
              <button
                onClick={() => setCurrentId(item.id)}
                className={i === ancestors.length - 1 ? 'current' : ''}
              >
                {item.name}
              </button>
            </span>
          ))}
        </div>
        <div className="atlas-top-actions">
          <button
            className="btn"
            disabled={!access.create('maps') && !writable}
            onClick={() => setImageImportOpen(true)}
          >
            <ImagePlus size={16} />
            <span>导入地图图片</span>
          </button>
          <button
            className="btn"
            aria-label={inspectorHidden ? '显示右侧工具栏' : '隐藏右侧工具栏'}
            title={inspectorHidden ? '显示右侧工具栏' : '隐藏右侧工具栏'}
            aria-pressed={inspectorHidden}
            onClick={() => setInspectorHidden(!inspectorHidden)}
          >
            {inspectorHidden ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
            <span>{inspectorHidden ? '显示工具' : '隐藏工具'}</span>
          </button>
          <button
            className="btn"
            aria-label={fullscreen ? '退出地图全屏' : '地图全屏'}
            title={fullscreen ? '退出全屏 · Esc' : '地图全屏'}
            aria-pressed={fullscreen}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            <span>{fullscreen ? '退出全屏' : '全屏'}</span>
          </button>
          <button
            className="btn atlas-export-button"
            title={
              studio.sourcePreview
                ? '请切换到生成预览后导出'
                : terrainPending
                  ? '正在计算最新地形，请稍候'
                  : '导出完整画布 SVG（当前可见图层）'
            }
            onClick={() => void exportSvg()}
            disabled={
              !access.exportAllowed || terrainPending || studio.sourcePreview || exportingImages
            }
          >
            <Download size={14} />
            {exportingImages ? '准备图片导出…' : '导出 SVG'}
          </button>
          <select
            aria-label="切换地图"
            className="atlas-map-select"
            value={map.id}
            onChange={(event) => setCurrentId(event.target.value)}
          >
            {maps.map((item) => (
              <option key={item.id} value={item.id}>
                {item.parentId ? '↳ ' : ''}
                {item.name}
              </option>
            ))}
          </select>
          <button className="btn" disabled={!access.create('maps')} onClick={() => openCreate()}>
            <Plus size={14} />
            新地图
          </button>
        </div>
      </div>
      {writable && (
        <StudioModeBar
          studio={studio}
          onChange={() => {
            setSelectedPinId(undefined);
            divisionStudio.cancel();
            setDivisionTab(false);
            setStudioTab(true);
          }}
        />
      )}
      {studio.editor.generation &&
        (studio.editor.generation.version !== 2 ||
          studio.editor.generation.linework !== 'organic' ||
          terrainError) && (
          <div
            className={`atlas-generator-status ${studio.editor.generation.version === 2 && studio.editor.generation.linework === 'organic' ? 'current' : 'legacy'}`}
            aria-label="当前地图生成方式"
          >
            <Sparkles size={18} aria-hidden="true" />
            {studio.editor.generation.version === 2 &&
            studio.editor.generation.linework === 'organic' ? (
              <span>
                <strong>精细生成 v2 · 柔和河流与道路</strong>
                <small>
                  {terrainError
                    ? '预览生成失败，请查看绘图面板中的提示。'
                    : studio.sourcePreview
                      ? '正在查看色块草稿'
                      : '已显示最新生成预览'}
                </small>
              </span>
            ) : (
              <>
                <span>
                  <strong>
                    {studio.editor.generation.version === 1
                      ? '当前地图还在使用旧版生成 v1'
                      : '当前地图尚未启用柔和河流与道路'}
                  </strong>
                  <small>
                    启用新版可按原种子重绘；重新生成也会启用新版曲线。保留色块与人工内容，可撤销。
                  </small>
                </span>
                <button
                  className="btn primary"
                  disabled={terrainPending}
                  onClick={() => {
                    if (studio.editor.generation?.version === 1) studio.upgradeGeneration();
                    else {
                      studio.generationOptions({ linework: 'organic' });
                      studio.setSourcePreview(false);
                      studio.setNotice('已启用柔和曲线。可撤销对比原画面。');
                    }
                  }}
                >
                  启用新版河流与道路
                </button>
              </>
            )}
          </div>
        )}
      <MapLayerBar
        layer={geographicLayer}
        available={Boolean(geography)}
        elevationAvailable={Boolean(map.editor?.generated?.elevation)}
        onLayer={(next) => {
          studio.setSourcePreview(false);
          studio.setTerrainView(next === 'elevation' ? 'elevation' : 'atlas');
          setGeographicLayer(next);
        }}
      />
      {!studio.sourcePreview && !fullscreen && (
        <ClimateLayerGuide geography={geography} layer={geographicLayer} />
      )}
      <div className="atlas-layout">
        <div className="atlas-stage-shell" ref={stageRef}>
          {fullscreen && (
            <button
              className="atlas-fullscreen-exit btn"
              onClick={() => void toggleFullscreen()}
              aria-label="退出地图全屏"
            >
              <Minimize size={16} />
              退出全屏 · Esc
            </button>
          )}
          {terrainPending && !studio.sourcePreview && (
            <div className="atlas-generation-overlay" role="status" aria-live="polite">
              <div>
                <LoaderCircle className="spin" size={28} aria-hidden="true" />
                <strong>正在生成地图…</strong>
                <span>地势、水系与道路正在更新</span>
              </div>
            </div>
          )}
          {studio.notice && (inspectorHidden || !studioTab || selectedPin) && (
            <div className="atlas-floating-notice" role="status">
              <span>{studio.notice}</span>
              <button
                className="icon-btn"
                aria-label="关闭地图提示"
                onClick={() => studio.setNotice('')}
              >
                ×
              </button>
            </div>
          )}
          <div className="atlas-map-title">
            <span className="atlas-kicker">CARTOGRAPHER’S DESK</span>
            <h2 title={map.name}>{map.name}</h2>
            <span>
              {mapKinds[map.kind]}
              <i /> {map.pins.length} 处已记载地点
            </span>
          </div>
          <div className="atlas-tools" role="toolbar" aria-label="地图绘制工具">
            {tools
              .filter(
                (t) =>
                  (writable || t.id === 'pan') &&
                  (studio.terrainView !== 'elevation' || ['pan', 'pin'].includes(t.id)) &&
                  (studio.editor.mode !== 'sketch' || ['select', 'pan', 'pin'].includes(t.id)),
              )
              .map(({ id, label, Icon }) => (
                <button
                  key={id}
                  className={tool === id ? 'active' : ''}
                  title={label}
                  aria-label={label}
                  aria-pressed={tool === id}
                  onClick={() => {
                    divisionStudio.cancel();
                    setDivisionTab(false);
                    setTool(id);
                  }}
                >
                  <Icon size={18} />
                </button>
              ))}
            <span className="atlas-tool-divider" />
            <button
              aria-label="撤销地图编辑"
              title="撤销"
              disabled={!writable || !currentHistory?.past.length}
              onClick={() => travelHistory()}
            >
              <Undo2 size={17} />
            </button>
            <button
              aria-label="重做地图编辑"
              title="重做"
              disabled={!writable || !currentHistory?.future.length}
              onClick={() => travelHistory(true)}
            >
              <Redo2 size={17} />
            </button>
          </div>
          <div
            ref={panCamera.frame}
            className="atlas-canvas-frame"
            style={{ backgroundColor: canvasBackground }}
          >
            <div ref={panCamera.surface} className="atlas-pan-surface">
              <svg
                ref={svgRef}
                className={`atlas-canvas atlas-tool-${tool} ${divisionTab ? `division-tool-${divisionStudio.tool}` : ''} ${geographyTab && geographyTool !== 'pan' ? 'geography-drawing' : ''}`}
                style={{ backgroundColor: canvasBackground }}
                viewBox={`0 0 ${map.width} ${map.height}`}
                role="group"
                aria-label={`${map.name}，使用工具栏添加标记或绘制地图`}
                onPointerDown={pointerDown}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
                onPointerCancel={pointerCancel}
                onPointerLeave={() => {
                  setHoverPin(undefined);
                  studio.setCursor(null);
                }}
              >
                <defs>
                  <pattern
                    id="atlas-edit-grid"
                    width="40"
                    height="40"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M40 0H0V40"
                      fill="none"
                      stroke="#5a7469"
                      strokeWidth=".6"
                      opacity=".2"
                    />
                  </pattern>
                </defs>
                <g
                  ref={groupRef}
                  data-map-viewport="true"
                  transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}
                >
                  {showTerrain ? (
                    <g>
                      {studio.editor.baseVisible && !studio.sourcePreview ? (
                        <LegacyTerrainArtwork map={map} />
                      ) : (
                        <rect width={map.width} height={map.height} fill={parchmentSea} />
                      )}
                      <EditorArtwork
                        map={studio.previewMap!}
                        interactive
                        objectPreview={studio.draftObject}
                        regionPreview={studio.draftRegion}
                        elevationPreview={!!studio.draftElevation}
                        onPending={setTerrainPending}
                        onError={setTerrainError}
                        sourcePreview={studio.sourcePreview}
                        terrainView={displayElevation ? 'elevation' : 'atlas'}
                        onElevation={setElevation}
                        onCoastlines={setGeneratedCoasts}
                        onLegend={setGeneratedLegend}
                        onSettlements={setGeneratedSettlements}
                        onSnapshot={acceptGenerated}
                        renderUnderlay={renderUnderlay}
                      />
                    </g>
                  ) : (
                    <rect width={map.width} height={map.height} fill={parchmentPaper} />
                  )}
                  {!studio.sourcePreview && !displayElevation && (
                    <MapPaper width={map.width} height={map.height} />
                  )}
                  {!studio.sourcePreview && !displayElevation && (
                    <GeographicArtwork
                      phase="overlay"
                      geography={geography}
                      layer={geographicLayer}
                      entities={entities}
                      onOpen={onOpenEntity}
                      objects={map.editor?.generated?.objects}
                      elevation={map.editor?.generated?.elevation}
                      surfaceId={surfaceId}
                      sites={
                        generatedSettlements.length
                          ? generatedSettlements
                          : map.editor?.generated?.sites
                      }
                      obstacles={labelObstacles}
                      hiddenFeatures={map.editor?.hiddenFeatures}
                    />
                  )}
                  {geographyTab && !studio.sourcePreview && !fullscreen && (
                    <g
                      clipPath={
                        map.editor?.generated?.objects.some(
                          (o) =>
                            o.name === '沿岸浅海' ||
                            o.name === '大陆' ||
                            o.name === '陆地 · 共享地表',
                        )
                          ? `url(#${surfaceId}-land)`
                          : undefined
                      }
                    >
                      <GeographicSelectionArtwork
                        geography={geography}
                        cells={geographicSelection.selectedCells}
                      />
                    </g>
                  )}
                  {!studio.sourcePreview && <MilitaryArtwork lines={militaryLines} />}
                  {grid && (
                    <rect
                      width={map.width}
                      height={map.height}
                      fill="url(#atlas-edit-grid)"
                      pointerEvents="none"
                    />
                  )}
                  {!studio.sourcePreview &&
                    showStrokes &&
                    map.strokes
                      .filter((s) => !featureHidden(map, 'roads', s.id))
                      .map((stroke) => <Stroke key={stroke.id} stroke={stroke} />)}
                  {draftStroke && <Stroke stroke={draftStroke} />}
                  {!geography && !studio.sourcePreview && showDivisions && (
                    <MapDivisions
                      map={divisionStudio.previewMap!}
                      entities={entities}
                      kind={divisionStudio.kind}
                      onOpen={onOpenEntity}
                      studio={divisionTab ? divisionStudio : undefined}
                      zoom={view.zoom}
                    />
                  )}
                  <g
                    data-map-scale="true"
                    pointerEvents="none"
                    transform={`translate(${map.width * 0.04} ${map.height * 0.94})`}
                  >
                    <path
                      d={`M0,-5V0H${mapScaleBar(map).width}V-5`}
                      fill="none"
                      stroke="#554733"
                      strokeWidth={Math.max(1, map.width / 850)}
                    />
                    <text
                      x={mapScaleBar(map).width / 2}
                      y={-9}
                      textAnchor="middle"
                      fontSize={Math.max(10, map.width / 100)}
                      fill="#554733"
                      stroke="#f5ebd1"
                      strokeWidth="2"
                      paintOrder="stroke"
                    >
                      {mapScaleBar(map).label}
                      {map.scaleKm === undefined ? '（估算）' : ''}
                    </text>
                  </g>
                  {!divisionTab && <StudioOverlay studio={studio} tool={tool} zoom={view.zoom} />}
                  {!divisionTab &&
                    studio.cursor &&
                    (tool === 'terrain' ||
                      tool === 'cluster' ||
                      tool === 'sampler' ||
                      tool === 'elevation') && (
                      <g data-editor-overlay="true" pointerEvents="none">
                        <circle
                          cx={studio.cursor.x}
                          cy={studio.cursor.y}
                          r={
                            tool === 'sampler'
                              ? 8 / view.zoom
                              : (tool === 'elevation' ? studio.elevationWidth : studio.radius) / 2
                          }
                          fill="none"
                          stroke="#fffdf1"
                          strokeWidth={3 / view.zoom}
                        />
                        <circle
                          cx={studio.cursor.x}
                          cy={studio.cursor.y}
                          r={
                            tool === 'sampler'
                              ? 8 / view.zoom
                              : (tool === 'elevation' ? studio.elevationWidth : studio.radius) / 2
                          }
                          fill="none"
                          stroke={
                            tool === 'elevation'
                              ? '#72502d'
                              : biomeCatalog.find((b) => b.id === studio.biome)?.color || '#456951'
                          }
                          strokeWidth={1.5 / view.zoom}
                          strokeDasharray={`${5 / view.zoom} ${3 / view.zoom}`}
                        />
                        <path
                          d={`M${studio.cursor.x - 4 / view.zoom},${studio.cursor.y}h${8 / view.zoom}M${studio.cursor.x},${studio.cursor.y - 4 / view.zoom}v${8 / view.zoom}`}
                          stroke="#496852"
                          strokeWidth={1 / view.zoom}
                        />
                      </g>
                    )}
                  {divisionTab &&
                    studio.cursor &&
                    ['paint', 'erase'].includes(divisionStudio.tool) && (
                      <circle
                        data-editor-overlay="true"
                        cx={studio.cursor.x}
                        cy={studio.cursor.y}
                        r={studio.radius / 2}
                        fill="none"
                        stroke={divisionStudio.selected?.color ?? '#66523c'}
                        strokeWidth={1.5 / view.zoom}
                        strokeDasharray={`${5 / view.zoom} ${3 / view.zoom}`}
                        pointerEvents="none"
                      />
                    )}
                  {showPins &&
                    map.pins
                      .filter((p) => !featureHidden(map, 'settlements', p.id))
                      .map((pin) => {
                        const position = pin.id === selectedPinId && draftPin ? draftPin : pin;
                        return (
                          <TooltipMapPin
                            entity={entities.find((e) => e.id === pin.entityId)}
                            key={pin.id}
                            className="atlas-pin"
                            transform={`translate(${position.x},${position.y})`}
                            role="button"
                            tabIndex={0}
                            aria-label={`${pin.label}，${pinKinds[pin.kind]}`}
                            onPointerDown={(event) => pinDown(event, pin)}
                            onPointerEnter={() => {
                              setHoverPin(pin.id);
                            }}
                            onPointerLeave={() => setHoverPin(undefined)}
                            onDoubleClick={() => {
                              if (pin.childMapId) setCurrentId(pin.childMapId);
                              else if (pin.entityId) onOpenEntity(pin.entityId);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setSelectedPinId(pin.id);
                              }
                              if (event.key === 'Enter' && event.ctrlKey && pin.entityId)
                                onOpenEntity(pin.entityId);
                            }}
                          >
                            <PinSymbol kind={pin.kind} active={pin.id === selectedPinId} />
                            <text
                              x="0"
                              y="28"
                              textAnchor="middle"
                              stroke="#eae6d4"
                              strokeWidth="4"
                              paintOrder="stroke"
                              fill="#3d5747"
                              fontSize="12"
                              fontWeight="600"
                            >
                              {pin.label}
                            </text>
                            {pin.childMapId && (
                              <g transform="translate(12,-13)">
                                <circle r="6" fill="#b49459" />
                                <path
                                  d="M-2 2 L2-2 M-2-2 H2 V2"
                                  fill="none"
                                  stroke="white"
                                  strokeWidth="1"
                                />
                              </g>
                            )}
                          </TooltipMapPin>
                        );
                      })}
                </g>
              </svg>
            </div>
          </div>
          {hoveredPin && !hoveredEntity && (
            <div className="atlas-hover-card" role="tooltip">
              <span className="atlas-kicker">
                {pinKinds[hoveredPin.kind]} {hoveredEntity && '· 关联设定'}
              </span>
              <strong>{hoveredPin.label}</strong>
              <p>{hoveredPin.description || '这个地点尚未留下笔记。'}</p>
            </div>
          )}
          <div className="atlas-bottom-bar">
            {elevation && (tool === 'elevation' || studio.terrainView === 'elevation') ? (
              <div className="atlas-height-readout" role="status">
                {studio.cursor
                  ? `${Math.round(sampleElevation(elevation, studio.cursor)).toLocaleString()} 米`
                  : '移动鼠标查看海拔'}
                <small>
                  相对当前海平面 · 全图 {Math.round(elevation.min)}～{Math.round(elevation.max)} 米
                </small>
              </div>
            ) : (
              <details className="atlas-map-legend">
                <summary>
                  {terrainPending && !studio.sourcePreview
                    ? '图例更新中…'
                    : `图例 · ${legend.length} 项`}
                </summary>
                <div className="atlas-legend-panel">
                  <small>仅列出当前可见图层中的元素</small>
                  {legend.length === 0 && <span>当前没有可标识的地图元素</span>}
                  {legend.map((item) => (
                    <span key={item.id} data-legend-id={item.id}>
                      {item.symbol ? (
                        <svg
                          viewBox="-20 -20 40 40"
                          width="20"
                          height="20"
                          fill={item.color}
                          stroke="#6e674e"
                          strokeWidth="1"
                        >
                          <MapGlyph kind={item.symbol} />
                        </svg>
                      ) : (
                        <i style={{ background: item.color, height: item.line ? 3 : 12 }} />
                      )}
                      {item.label}
                    </span>
                  ))}
                </div>
              </details>
            )}
            <div className="atlas-status-tip">
              {divisionTab ? (
                {
                  paint: '拖动涂抹领地 · 悬停预览摘要 · Esc 取消',
                  erase: '仅擦除当前分区 · 小笔刷可细修',
                  lasso: '按住鼠标沿边界画一圈，松开闭合',
                  vertices: '拖动控制点，或在右侧输入坐标',
                  pan: '拖动画布探索分区',
                }[divisionStudio.tool]
              ) : (
                <>
                  {tool === 'elevation'
                    ? '拖动塑造海拔 · 松开保存一笔 · Esc 取消 · 可撤销'
                    : tool === 'pin'
                      ? '点击地图，标记故事发生的地方'
                      : tool === 'erase'
                        ? '点击或拖动擦除手绘笔画'
                        : tool === 'select'
                          ? '选择并拖动地形或组件 · Delete 删除 · 悬停预览词条'
                          : tool === 'pan'
                            ? '拖动画布探索地图'
                            : tool === 'terrain'
                              ? '拖动塑造地形 · 相交区域自动融合 · [ / ] 调整笔刷'
                              : tool === 'sampler'
                                ? '点击地形取样，继续使用相同笔刷绘制'
                                : tool === 'cluster'
                                  ? '点击放置组合场景，每个组件均可继续编辑'
                                  : '按住鼠标拖动进行绘画'}
                </>
              )}
            </div>
            <span className="atlas-scale">
              范围 {formatDistance(mapCoverageKm(map))} · {map.width} × {map.height}
            </span>
          </div>
          <div className="atlas-zoom">
            <button title="缩小" aria-label="缩小地图" onClick={() => zoom(-0.2)}>
              <Minus size={16} />
            </button>
            <span ref={panCamera.zoomLabel}>{Math.round(view.zoom * 100)}%</span>
            <button title="放大" aria-label="放大地图" onClick={() => zoom(0.2)}>
              <Plus size={16} />
            </button>
            <button
              title="重置视图"
              aria-label="重置地图视图"
              onClick={() => setView({ x: 0, y: 0, zoom: 1 })}
            >
              <Maximize size={15} />
            </button>
          </div>
          <div className="atlas-layers">
            <button
              className={layersOpen ? 'active' : ''}
              title="显示图层"
              aria-label="显示地图图层"
              onClick={() => setLayersOpen(!layersOpen)}
            >
              <Layers size={18} />
            </button>
            {layersOpen && (
              <div className="atlas-layer-menu">
                {[
                  ['地形底图', showTerrain, setShowTerrain],
                  ['地图标记', showPins, setShowPins],
                  ['手绘笔画', showStrokes, setShowStrokes],
                  ['疆域分区', showDivisions, setShowDivisions],
                  ['辅助网格', grid, setGrid],
                ].map(([label, value, setter]) => (
                  <label key={String(label)}>
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(event) => (setter as (v: boolean) => void)(event.target.checked)}
                    />
                    {String(label)}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <aside
          hidden={inspectorHidden}
          className={`atlas-inspector ${studioTab && !selectedPin ? 'studio-active' : ''}`}
        >
          {writable && (
            <div className="studio-inspector-tabs">
              <button
                className={
                  !selectedPin && studioTab && !divisionTab && !geographyTab && !placesTab
                    ? 'active'
                    : ''
                }
                onClick={() => {
                  setSelectedPinId(undefined);
                  setPlacesTab(false);
                  setGeographyTab(false);
                  setGeographyTool('pan');
                  divisionStudio.cancel();
                  setDivisionTab(false);
                  setStudioTab(true);
                }}
              >
                创作工具
              </button>
              <button
                className={
                  !selectedPin && geographyTab && geographySection === 'divisions' ? 'active' : ''
                }
                onClick={() => {
                  setPlacesTab(false);
                  setGeographyTab(true);
                  setGeographySection('divisions');
                  setGeographyTool('assign');
                  studio.cancel();
                  divisionStudio.cancel();
                  studio.setSelected(null);
                  setTool('pan');
                  setSelectedPinId(undefined);
                  setDivisionTab(false);
                  studio.setSourcePreview(false);
                  setStudioTab(true);
                  setShowDivisions(true);
                }}
              >
                疆域分区
              </button>
              <button
                className={
                  !selectedPin && geographyTab && geographySection === 'military' ? 'active' : ''
                }
                onClick={() => {
                  setSelectedPinId(undefined);
                  setPlacesTab(false);
                  studio.cancel();
                  divisionStudio.cancel();
                  setTool('pan');
                  setDivisionTab(false);
                  setGeographyTab(true);
                  setGeographySection('military');
                  setGeographyTool('pan');
                  setStudioTab(true);
                  studio.setSourcePreview(false);
                }}
              >
                兵棋推演
              </button>
              <button
                className={!selectedPin && placesTab ? 'active' : ''}
                onClick={() => {
                  studio.cancel();
                  divisionStudio.cancel();
                  setSelectedPinId(undefined);
                  setTool('pan');
                  setGeographyTool('pan');
                  setGeographyTab(false);
                  setDivisionTab(false);
                  setStudioTab(true);
                  setPlacesTab(true);
                }}
              >
                地名与地点
              </button>
              <button
                className={
                  !selectedPin && !studioTab && !divisionTab && !geographyTab && !placesTab
                    ? 'active'
                    : ''
                }
                onClick={() => {
                  setSelectedPinId(undefined);
                  setPlacesTab(false);
                  setGeographyTab(false);
                  setGeographyTool('pan');
                  divisionStudio.cancel();
                  setDivisionTab(false);
                  setStudioTab(false);
                }}
              >
                地图档案
              </button>
            </div>
          )}
          {!writable && !geographyTab && !placesTab ? (
            <div className="atlas-readonly-panel">
              <h2>{map.name}</h2>
              <p>{map.summary || '此地图还没有摘要。'}</p>
              <p>当前账户仅可查看此地图，可平移、缩放及进入关联内容。</p>
              <button
                className="btn"
                onClick={() => {
                  setPlacesTab(true);
                  studio.setSourcePreview(false);
                }}
              >
                浏览地名与地点
              </button>
              <RecordPublication module="maps" record={map} onChange={() => {}} />
              <h3>关联地点</h3>
              {map.pins.map((pin) => (
                <div key={pin.id}>
                  <button
                    className="text-btn"
                    onClick={() =>
                      setView({
                        zoom: 1.6,
                        x: map.width / 2 - pin.x * 1.6,
                        y: map.height / 2 - pin.y * 1.6,
                      })
                    }
                  >
                    {pin.label || '地点标记'}
                  </button>
                  <p>{pin.description}</p>
                  {pin.entityId && (
                    <EntityLink
                      entity={entities.find((e) => e.id === pin.entityId)}
                      onOpen={onOpenEntity}
                    />
                  )}
                  {pin.childMapId && (
                    <button className="text-btn" onClick={() => setCurrentId(pin.childMapId!)}>
                      打开详细地图
                    </button>
                  )}
                </div>
              ))}
              <h3>详细地图</h3>
              {maps
                .filter((m) => m.parentId === map.id)
                .map((m) => (
                  <button key={m.id} className="text-btn" onClick={() => setCurrentId(m.id)}>
                    {m.name}
                  </button>
                ))}
            </div>
          ) : selectedPin ? (
            <>
              <div className="atlas-panel-heading">
                <span>
                  <PinIcon size={15} />
                  地点档案
                </span>
                <button
                  className="text-btn"
                  aria-label="取消选择标记"
                  onClick={() => setSelectedPinId(undefined)}
                >
                  <ArrowLeft size={14} />
                  返回地图工具
                </button>
              </div>
              <label className="atlas-label">
                地点名称
                <input
                  className="field"
                  value={pinNameDraft}
                  maxLength={120}
                  onChange={(event) => setPinNameDraft(event.target.value)}
                  onBlur={commitPinName}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
              </label>
              <label className="atlas-label">
                标记类型
                <select
                  className="field"
                  value={selectedPin.kind}
                  onChange={(event) => updatePin({ kind: event.target.value as MapPin['kind'] })}
                >
                  {Object.entries(pinKinds).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="atlas-label">
                地理笔记
                <textarea
                  className="field"
                  rows={4}
                  placeholder="传闻、地貌、途经此处的冒险者……"
                  value={selectedPin.description}
                  onChange={(event) => updatePin({ description: event.target.value })}
                />
              </label>
              <label className="atlas-label">
                关联设定
                <select
                  className="field"
                  value={selectedPin.entityId || ''}
                  onChange={(event) => updatePin({ entityId: event.target.value || undefined })}
                >
                  <option value="">不关联</option>
                  {entities.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {entity && (
                <button className="atlas-linked-entity" onClick={() => onOpenEntity(entity.id)}>
                  <span>
                    <strong>{entity.name}</strong>
                    <small>{entity.summary || '打开完整设定档案'}</small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              )}
              <label className="atlas-label">
                关联详细地图
                <select
                  className="field"
                  value={selectedPin.childMapId || ''}
                  onChange={(event) => updatePin({ childMapId: event.target.value || undefined })}
                >
                  <option value="">不关联</option>
                  {maps
                    .filter((item) => item.id !== map.id)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
              {selectedPin.childMapId ? (
                <button
                  className="btn atlas-full-width"
                  onClick={() => setCurrentId(selectedPin.childMapId!)}
                >
                  <MapIcon size={15} />
                  进入详细地图
                  <ArrowUpRight size={14} />
                </button>
              ) : (
                <button
                  className="btn atlas-full-width"
                  onClick={() => openCreate(map.id, selectedPin.id)}
                >
                  <Plus size={15} />
                  为这个地点创建详图
                </button>
              )}
              <div className="atlas-coordinates">
                坐标 {Math.round(selectedPin.x)}, {Math.round(selectedPin.y)}
                <button
                  title="删除标记"
                  onClick={() => {
                    update({ pins: map.pins.filter((pin) => pin.id !== selectedPin.id) });
                    setSelectedPinId(undefined);
                  }}
                >
                  <Trash2 size={14} />
                  删除标记
                </button>
              </div>
            </>
          ) : placesTab ? (
            <MapPlacesPanel
              map={map}
              world={world}
              entities={entities}
              writable={writable}
              pending={terrainPending}
              settlements={
                generatedSettlements.length
                  ? generatedSettlements
                  : (map.editor?.generated?.sites ?? [])
              }
              onGeneration={(patch) => studio.generationOptions(patch)}
              onChangeGeography={changeGeography}
              onChangeMap={(next) => {
                studio.setSelected(null);
                setSelectedPinId(undefined);
                update(next);
              }}
              onFocus={(p) =>
                setView({ zoom: 1.6, x: map.width / 2 - p.x * 1.6, y: map.height / 2 - p.y * 1.6 })
              }
              onOpen={onOpenEntity}
              onCreatePlace={(entity, next) => {
                if (!writable || !access.create('lore')) return false;
                const before = mapsRef.current.find((m) => m.id === next.id);
                if (!before) return false;
                remember(before);
                mapsRef.current = mapsRef.current.map((m) => (m.id === next.id ? next : m));
                onCreateDivision({ ...entity, createdBy: access.actor.id }, next);
                return true;
              }}
            />
          ) : geographyTab ? (
            <GeographyPanel
              map={map}
              world={world}
              section={geographySection}
              onChange={changeGeography}
              onSettings={buildGeography}
              entities={entities}
              writable={writable}
              pending={terrainPending}
              tool={geographyTool}
              onTool={(next) => {
                setGeographyTool(next);
                setTool('pan');
              }}
              selectedDivision={selectedGeoDivision}
              onDivision={setSelectedGeoDivision}
              selectedKind={selectedGeoKind}
              onKind={(kind) => {
                setSelectedGeoKind(kind);
                setSelectedGeoDivision(geography?.divisions.find((d) => d.kind === kind)?.id);
                setTool('pan');
              }}
              selectedCells={geographicSelection.selectedCells}
              onClearSelection={geographicSelection.clearSelection}
              onApplySelection={(kind, divisionId) => {
                const current = mapsRef.current.find((m) => m.id === map.id)?.editor?.generated
                  ?.geography;
                if (!current || !writable || terrainPending) return;
                const division = current.divisions.find(
                  (d) => d.id === divisionId && d.kind === kind,
                );
                if (divisionId && !division) return;
                changeGeography(
                  divisionId
                    ? assignGeographicCells(current, divisionId, geographicSelection.selectedCells)
                    : clearGeographicCells(current, kind, geographicSelection.selectedCells),
                );
                geographicSelection.clearSelection();
              }}
              onFocus={(p) =>
                setView({ zoom: 1.6, x: map.width / 2 - p.x * 1.6, y: map.height / 2 - p.y * 1.6 })
              }
              onOpen={onOpenEntity}
              onAddDivision={(kind, entity) => {
                const current = mapsRef.current.find((m) => m.id === map.id);
                const geo = current?.editor?.generated?.geography;
                if (
                  !current?.editor?.generated ||
                  !geo ||
                  !writable ||
                  terrainPending ||
                  !access.create('lore') ||
                  geo.divisions.length >= GEOGRAPHY_LIMITS.divisions ||
                  geo.divisions.filter((d) => d.kind === kind).length >= 24
                )
                  return false;
                const id = makeId(kind);
                const land = geo.cells.find((c) => c.land);
                const colors = ['#aa856b', '#7c978a', '#a2a678', '#9683a5', '#b3975c', '#7796a4'];
                const next = {
                  ...current,
                  editor: {
                    ...current.editor,
                    generated: {
                      ...current.editor.generated,
                      geography: {
                        ...geo,
                        divisions: [
                          ...geo.divisions,
                          {
                            id,
                            kind,
                            name: entity.name,
                            entityId: entity.id,
                            center: land?.center ?? { x: current.width / 2, y: current.height / 2 },
                            color: colors[geo.divisions.length % colors.length],
                          },
                        ],
                      },
                    },
                  },
                };
                remember(current);
                mapsRef.current = mapsRef.current.map((m) => (m.id === next.id ? next : m));
                onCreateDivision({ ...entity, createdBy: access.actor.id }, next);
                setSelectedGeoDivision(id);
                setSelectedGeoKind(kind);
                return true;
              }}
              onCreateEntry={(divisionId, entity) => {
                const current = mapsRef.current.find((m) => m.id === map.id);
                if (!current?.editor?.generated?.geography || !writable || !access.create('lore'))
                  return false;
                const next = {
                  ...current,
                  editor: {
                    ...current.editor,
                    generated: {
                      ...current.editor.generated,
                      geography: {
                        ...current.editor.generated.geography,
                        divisions: current.editor.generated.geography.divisions.map((d) =>
                          d.id === divisionId
                            ? { ...d, entityId: entity.id, name: entity.name }
                            : d,
                        ),
                      },
                    },
                  },
                };
                remember(current);
                mapsRef.current = mapsRef.current.map((m) => (m.id === next.id ? next : m));
                onCreateDivision({ ...entity, createdBy: access.actor.id }, next);
                return true;
              }}
              onDeleteLine={(id) =>
                update({
                  editor: {
                    ...studio.editor,
                    military: studio.editor.military?.filter((l) => l.id !== id),
                  },
                })
              }
              onLineChange={(line) =>
                update({
                  editor: {
                    ...studio.editor,
                    military: studio.editor.military?.map((l) => (l.id === line.id ? line : l)),
                  },
                })
              }
              onReturn={() => {
                setGeographyTab(false);
                setGeographyTool('pan');
              }}
            />
          ) : divisionTab ? (
            <DivisionPanel
              map={map}
              world={world}
              studio={divisionStudio}
              entities={entities}
              width={studio.radius}
              setWidth={studio.setRadius}
              onOpen={onOpenEntity}
              coastlines={coastlines}
              onCreate={(entity) =>
                divisionStudio.add(entity, (next) => {
                  const before = mapsRef.current.find((m) => m.id === next.id);
                  if (before) remember(before);
                  mapsRef.current = mapsRef.current.map((m) => (m.id === next.id ? next : m));
                  onCreateDivision(entity, next);
                })
              }
            />
          ) : studioTab ? (
            <MapStudioPanel
              map={map}
              studio={studio}
              tool={tool}
              terrainPending={terrainPending}
              terrainError={terrainError}
              settlements={generatedSettlements}
              onFocusSettlement={(site) => {
                setView((previous) => {
                  const zoom = Math.max(1.6, previous.zoom);
                  return {
                    zoom,
                    x: map.width / 2 - site.x * zoom,
                    y: map.height / 2 - site.y * zoom,
                  };
                });
              }}
              setTool={(next) => {
                setTool(next);
                setShowTerrain(true);
                if (['brush', 'road', 'river'].includes(next)) setShowStrokes(true);
              }}
            />
          ) : (
            <>
              <RecordPublication
                module="maps"
                record={map}
                onChange={(visibility) => update({ visibility })}
              />
              <div className="atlas-panel-heading">
                <span>
                  <Compass size={16} />
                  地图档案
                </span>
                <span className="badge">{mapKinds[map.kind]}</span>
              </div>
              <label className="atlas-label">
                地图名称
                <input
                  className="field"
                  value={mapNameDraft}
                  maxLength={120}
                  onChange={(event) => setMapNameDraft(event.target.value)}
                  onBlur={commitMapName}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                  }}
                />
              </label>
              <label className="atlas-label">
                关于这片土地
                <textarea
                  className="field"
                  rows={3}
                  maxLength={2000}
                  value={map.summary}
                  onChange={(event) => update({ summary: event.target.value })}
                  placeholder="记录地理概况、气候与尚待揭开的秘密。"
                />
              </label>
              <div className="atlas-inspector-section">
                <MapDimensionsPanel
                  map={map}
                  onResize={(resized) => {
                    studio.cancel();
                    divisionStudio.cancel();
                    update(resized);
                    setView({ x: 0, y: 0, zoom: 1 });
                  }}
                />
                <div className="atlas-section-title">
                  {studio.editor.generation ? '色块生成' : '随机底图'}
                  <span>PROCEDURAL</span>
                </div>
                {!studio.editor.generation && (
                  <label className="studio-check">
                    <input
                      type="checkbox"
                      checked={studio.editor.baseVisible}
                      onChange={(event) => studio.commit({ baseVisible: event.target.checked })}
                    />
                    显示随机底图
                  </label>
                )}
                {!studio.editor.generation && !studio.editor.baseVisible && (
                  <p className="atlas-help">
                    随机底图已关闭。重新启用后可更换种子；已转换的底图组件可能仍会覆盖它。
                  </p>
                )}
                <label className="atlas-label">
                  {studio.editor.generation ? '地图生成种子' : '地形种子'}
                  <div className="atlas-seed-input">
                    <input
                      className="field"
                      type="number"
                      aria-label={studio.editor.generation ? '地图生成种子' : '地形种子'}
                      min="0"
                      max="4294967295"
                      value={seedDraft}
                      disabled={
                        studio.editor.generation ? terrainPending : !studio.editor.baseVisible
                      }
                      onChange={(event) => setSeedDraft(event.target.value)}
                    />
                    <button
                      className="icon-btn"
                      title={
                        studio.editor.generation ? '随机种子并使用新版重新生成' : '随机种子并生成'
                      }
                      aria-label={
                        studio.editor.generation ? '随机种子重新生成色块地图' : '随机生成地图'
                      }
                      disabled={
                        studio.editor.generation ? terrainPending : !studio.editor.baseVisible
                      }
                      onClick={() => {
                        const next = Math.floor(Math.random() * 999999) + 1;
                        setSeedDraft(String(next));
                        if (studio.editor.generation) studio.regenerate(next);
                        else update({ seed: next });
                      }}
                    >
                      <Dice5 size={18} />
                    </button>
                  </div>
                </label>
                <button
                  className="btn atlas-full-width"
                  disabled={
                    (studio.editor.generation ? terrainPending : !studio.editor.baseVisible) ||
                    !seedDraft.trim() ||
                    !Number.isInteger(Number(seedDraft)) ||
                    Number(seedDraft) < 0 ||
                    Number(seedDraft) > 4294967295
                  }
                  onClick={() => {
                    if (studio.editor.generation) studio.regenerate(Number(seedDraft));
                    else update({ seed: Number(seedDraft) });
                  }}
                >
                  <Waves size={15} />
                  {studio.editor.generation ? '按此种子重新生成（新版）' : '从种子重新生成'}
                </button>
                <p className="atlas-help">
                  {studio.editor.generation
                    ? '使用新版曲线重新生成当前色块地图，保留色块、人工组件、标记与笔画，可撤销。相同配方和种子会重现相同结果。'
                    : '同一种子生成相同底图，标记与笔画会保留。种子设为 0 即为空白画布。'}
                </p>
              </div>
              <div className="atlas-inspector-section">
                <div className="atlas-section-title">
                  地点索引<span>{String(map.pins.length).padStart(2, '0')}</span>
                </div>
                {map.pins.length === 0 ? (
                  <div className="atlas-small-empty">
                    点击 <PinIcon size={13} /> 在地图上标记首个地点
                  </div>
                ) : (
                  map.pins.map((pin) => (
                    <button
                      className="atlas-place-row"
                      key={pin.id}
                      onClick={() => {
                        setSelectedPinId(pin.id);
                        setShowPins(true);
                        setView({
                          zoom: 1.3,
                          x: map.width / 2 - pin.x * 1.3,
                          y: map.height / 2 - pin.y * 1.3,
                        });
                      }}
                    >
                      <span className={`atlas-place-dot ${pin.kind}`} />
                      <span>{pin.label || '未命名地点'}</span>
                      {pin.childMapId ? <ArrowUpRight size={13} /> : <ChevronRight size={13} />}
                    </button>
                  ))
                )}
              </div>
              <div className="atlas-inspector-section">
                <div className="atlas-section-title">
                  详细地图
                  <button title="创建子地图" onClick={() => openCreate(map.id)}>
                    <Plus size={14} />
                  </button>
                </div>
                {childMaps.length ? (
                  childMaps.map((child) => (
                    <button
                      key={child.id}
                      className="atlas-child-map"
                      onClick={() => setCurrentId(child.id)}
                    >
                      <Building2 size={17} />
                      <span>
                        {child.name}
                        <small>{mapKinds[child.kind]}</small>
                      </span>
                      <ChevronRight size={14} />
                    </button>
                  ))
                ) : (
                  <p className="atlas-help">为城镇、遗迹与秘境创建更细致的地图。</p>
                )}
              </div>
              {map.parentId && (
                <button
                  className="btn atlas-full-width"
                  onClick={() => setCurrentId(map.parentId!)}
                >
                  <ArrowLeft size={14} />
                  返回上级地图
                </button>
              )}
              <button className="atlas-delete-map" onClick={removeMap}>
                <Trash2 size={13} />
                删除这张地图
              </button>
            </>
          )}
          {(tool === 'brush' || tool === 'road' || tool === 'river') && (
            <div className="atlas-brush-options">
              <div className="atlas-section-title">
                {tool === 'brush' ? '画笔设置' : tool === 'road' ? '道路工具' : '河流工具'}
              </div>
              {tool === 'brush' ? (
                <>
                  <div className="atlas-color-swatches">
                    {['#6d8664', '#b5b28a', '#cab28b', '#7aa9a8', '#716c59', '#e9e4d2'].map(
                      (value) => (
                        <button
                          key={value}
                          aria-label={`画笔颜色 ${value}`}
                          className={value === color ? 'active' : ''}
                          style={{ background: value }}
                          onClick={() => setColor(value)}
                        >
                          {value === color && <Check size={13} />}
                        </button>
                      ),
                    )}
                    <input
                      aria-label="自定义画笔颜色"
                      type="color"
                      value={color}
                      onChange={(event) => setColor(event.target.value)}
                    />
                  </div>
                  <label className="atlas-label">
                    笔宽 · {width}
                    <input
                      aria-label="画笔宽度"
                      type="range"
                      min="2"
                      max="70"
                      value={width}
                      onChange={(event) => setWidth(Number(event.target.value))}
                    />
                  </label>
                </>
              ) : (
                <p className="atlas-help">
                  在地图上按住并拖动绘制
                  {tool === 'road'
                    ? '道路。虚线会自动沿路径排列。'
                    : '河流。可在地图标记中记录水域名称。'}
                </p>
              )}
            </div>
          )}
        </aside>
      </div>
      {imageImportOpen && (
        <MapImageImport
          hasMap={true}
          onClose={() => setImageImportOpen(false)}
          onImport={importMapImage}
        />
      )}
      {modal}
    </div>
  );
}
