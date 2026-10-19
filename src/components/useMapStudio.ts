import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { AtlasMap } from '../../shared/model';
import { makeId } from '../../shared/model';
import type {
  EditorMode,
  MapEditorData,
  MapObject,
  MapPoint,
  MapRegion,
  MapSymbolKind,
  TerrainBiome,
  SketchGenerationV2,
  ElevationSettings,
  ElevationStroke,
} from '../../shared/cartography';
import { biomeCatalog, symbolCatalog, legacyBiomeIds } from '../../shared/cartography';
import {
  bakeMapArtwork,
  createEditorData,
  createMapObject,
  composeTerrainRegions,
  pointInRegion,
} from '../lib/cartography';
import { brushPresets, makeSmartGroup } from '../lib/map-brushes';
import { useFrameState } from '../lib/useFrameState';
import { defaultGeographicSettings } from '../../shared/geography';
import { renameSettlementArtwork } from '../lib/settlement-names';

export type StudioTool =
  | 'select'
  | 'pan'
  | 'pin'
  | 'brush'
  | 'road'
  | 'river'
  | 'erase'
  | 'terrain'
  | 'elevation'
  | 'sampler'
  | 'area'
  | 'symbol'
  | 'cluster'
  | 'polygon'
  | 'rectangle'
  | 'ellipse'
  | 'text'
  | 'nodes'
  | 'path';
type Gesture =
  | { kind: 'region'; region: MapRegion }
  | { kind: 'elevation'; stroke: ElevationStroke; maxPoints: number }
  | { kind: 'shape'; start: MapPoint; object: MapObject }
  | {
      kind: 'move';
      start: MapPoint;
      original: MapObject | MapRegion;
      object?: MapObject;
      region?: MapRegion;
      vertex?: number;
    };
const rnd = () => Math.floor(Math.random() * 0xffffffff);
const rounded = (n: number) => Math.round(n * 100) / 100;

export function useMapStudio(
  map: AtlasMap | undefined,
  update: (patch: Partial<AtlasMap>) => void,
  tool: StudioTool,
  setTool: (tool: StudioTool) => void,
) {
  const fallback = useRef(createEditorData());
  const editor = map?.editor || fallback.current;
  const [biome, setBiome] = useState<TerrainBiome>('grass');
  const [radius, setRadius] = useState(brushPresets.grass.width);
  const [density, setDensity] = useState(brushPresets.grass.density);
  const [roughness, setRoughness] = useState(brushPresets.grass.roughness);
  const [cursor, setCursor] = useFrameState<MapPoint | null>(null);
  const [symbol, setSymbol] = useState<MapSymbolKind>('castle');
  const [size, setSize] = useState(36);
  const [color, setColor] = useState('#77936b');
  const [label, setLabel] = useState('未命名区域');
  const [snap, setSnap] = useState(false);
  const [selected, setSelected] = useState<{ type: 'object' | 'region'; id: string } | null>(null);
  const [vertex, setVertex] = useState(0);
  const [vertices, setVertices] = useState<MapPoint[]>([]);
  const [draftRegion, setDraftRegion] = useFrameState<MapRegion | undefined>(undefined);
  const [draftObject, setDraftObject] = useFrameState<MapObject | undefined>(undefined);
  const [notice, setNotice] = useState('');
  const [bakeConfirm, setBakeConfirm] = useState(false);
  const [freshConfirm, setFreshConfirm] = useState(false);
  const [sourcePreview, setSourcePreviewState] = useState(false);
  const [terrainView, setTerrainViewState] = useState<'atlas' | 'elevation'>('atlas');
  const [elevationOperation, setElevationOperation] =
    useState<ElevationStroke['operation']>('raise');
  // Area-based tools share one diameter. Changing a biome must never reset it.
  const elevationWidth = radius;
  const [elevationStrength, setElevationStrength] = useState(0.4);
  const [elevationTarget, setElevationTarget] = useState(500);
  const [draftElevation, setDraftElevation] = useFrameState<ElevationStroke | undefined>(undefined);
  const [generationDraft, setGenerationDraft] = useState<SketchGenerationV2>({
    version: 2,
    detail: 'high',
    linework: 'organic',
    seed: rnd(),
    climate: 'temperate',
    settlements: 5,
    rivers: true,
    routes: true,
  });
  const gesture = useRef<Gesture | null>(null);
  const elevationSettings =
    editor.generation?.version === 2 ? editor.generation.elevation : undefined;
  const selectedObject =
    selected?.type === 'object' ? editor.objects.find((o) => o.id === selected.id) : undefined;
  const selectedRegion =
    selected?.type === 'region' ? editor.regions.find((o) => o.id === selected.id) : undefined;
  function cancel() {
    gesture.current = null;
    setDraftRegion(undefined);
    setDraftObject(undefined);
    setDraftElevation(undefined);
    setVertices([]);
  }
  useEffect(() => {
    cancel();
    setSelected(null);
    setNotice('');
    setBakeConfirm(false);
    setFreshConfirm(false);
    setCursor(null);
    setSourcePreview(
      Boolean(
        editor.generation?.version === 2 &&
        editor.generation.geography?.source === 'sketch' &&
        !editor.generated,
      ),
    );
    setTerrainViewState('atlas');
    setElevationOperation('raise');
    setElevationStrength(0.4);
    setElevationTarget(500);
    setGenerationDraft({
      version: 2,
      detail: 'high',
      linework: 'organic',
      seed: rnd(),
      climate: 'temperate',
      settlements: 5,
      rivers: true,
      routes: true,
    });
  }, [map?.id]);
  useEffect(() => {
    if (editor.generation?.version === 1 && !legacyBiomeIds.some((id) => id === biome)) {
      setBiome('grass');
      setDensity(brushPresets.grass.density);
      setRoughness(brushPresets.grass.roughness);
    }
  }, [editor.generation]);
  useEffect(() => {
    cancel();
  }, [tool]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]')) return;
      if (!map || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        cancel();
        setSelected(null);
        setNotice('');
        e.preventDefault();
      } else if (
        (e.key === '[' || e.key === ']') &&
        ['terrain', 'cluster', 'elevation'].includes(tool)
      ) {
        const delta = e.key === '[' ? -10 : 10;
        setRadius((value) => Math.max(5, Math.min(500, value + delta)));
        e.preventDefault();
      } else if (e.key === 'Delete' && (selectedObject || selectedRegion)) {
        if (!(selectedObject || selectedRegion)!.locked) remove();
        else setNotice('选中内容已锁定，请先解锁。');
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [map, tool, selectedObject, selectedRegion]);
  function commit(patch: Partial<MapEditorData>) {
    try {
      const next = { ...editor, ...patch };
      if (
        next.generation?.version === 1 &&
        next.regions.some((region) => !legacyBiomeIds.some((id) => id === region.biome))
      ) {
        setNotice('请先升级精细生成，再使用新地貌；升级可以撤销。');
        return false;
      }
      if (patch.regions && !(patch.generation ?? editor.generation) && !sourcePreview)
        composeTerrainRegions(patch.regions, map?.width || 1000, map?.height || 640);
      update({ editor: next });
      return true;
    } catch (error) {
      setNotice((error as Error).message);
      return false;
    }
  }
  function generationOptions(patch: Partial<Omit<SketchGenerationV2, 'version'>>) {
    if (editor.generation?.version === 1) {
      const { detail: _detail, linework: _linework, elevation: _elevation, ...common } = patch;
      commit({ generation: { ...editor.generation, ...common } });
    } else if (editor.generation) {
      const generation = { ...editor.generation, ...patch };
      if (generation.version === 2 && generation.geography && patch.climate)
        generation.geography = {
          ...generation.geography,
          meanSeaTemperature: { temperate: 30, cold: 18, dry: 33 }[patch.climate],
          rainfall: { temperate: 1, cold: 0.75, dry: 0.4 }[patch.climate],
        };
      const named =
        (patch.settlementNames || patch.settlementLinks) &&
        editor.generated &&
        generation.version === 2
          ? renameSettlementArtwork(editor.generated.objects, editor.generated.sites, generation)
          : undefined;
      commit({
        generation,
        ...(named && editor.generated
          ? { generated: { ...editor.generated, objects: named.objects, sites: named.sites } }
          : {}),
      });
    } else setGenerationDraft((previous) => ({ ...previous, ...patch }));
  }
  function setSourcePreview(preview: boolean) {
    setSourcePreviewState(preview);
    if (preview) {
      cancel();
      setTerrainViewState('atlas');
      if (tool === 'elevation') setTool('terrain');
    }
  }
  function setTerrainView(view: 'atlas' | 'elevation') {
    cancel();
    setTerrainViewState(view);
    setSourcePreview(false);
    setSelected(null);
    setBakeConfirm(false);
    setFreshConfirm(false);
    if (view === 'elevation') {
      setTool(elevationSettings ? 'elevation' : 'pan');
    } else setTool(editor.mode === 'detail' ? 'pan' : 'terrain');
  }
  function enableElevation(preset?: ElevationSettings['preset']) {
    if (!map) return;
    cancel();
    const recipe = editor.generation || generationDraft;
    const hasLand = editor.regions.some((region) => region.visible && region.biome !== 'water');
    const elevation: ElevationSettings = {
      version: 1,
      preset: hasLand ? 'sketch' : 'continent',
      seed: recipe.seed,
      relief: 1,
      seaLevel: 0,
      strokes: [],
      ...elevationSettings,
      ...(preset ? { preset } : {}),
    };
    if (elevation.preset === 'sketch' && !hasLand) {
      setNotice('先画出陆地色块，或选择大陆、群岛、高地模板直接生成海拔。');
      return;
    }
    const committed = commit({
      generation: {
        ...recipe,
        version: 2,
        detail: recipe.version === 2 ? recipe.detail : 'high',
        linework: 'organic',
        elevation,
      },
      baseVisible: false,
    });
    if (!committed) return;
    setSourcePreview(false);
    setTerrainViewState('elevation');
    setSelected(null);
    setTool('elevation');
    setNotice('海拔设置已加入地图，正在计算地形与水系。原色块和人工内容保留，可撤销。');
  }
  function elevationOptions(patch: Partial<Omit<ElevationSettings, 'version' | 'strokes'>>) {
    if (editor.generation?.version !== 2 || !elevationSettings) return;
    cancel();
    commit({ generation: { ...editor.generation, elevation: { ...elevationSettings, ...patch } } });
  }
  function chooseElevationBrush(operation: ElevationStroke['operation']) {
    if (!elevationSettings) return;
    cancel();
    setElevationOperation(operation);
    setSourcePreview(false);
    setTerrainViewState('elevation');
    setSelected(null);
    setTool('elevation');
  }
  function clearElevationStrokes() {
    if (editor.generation?.version !== 2 || !elevationSettings?.strokes.length) return;
    cancel();
    if (
      commit({
        generation: { ...editor.generation, elevation: { ...elevationSettings, strokes: [] } },
      })
    )
      setNotice('已清除海拔笔划，保留模板和地形色块。可用「撤销」恢复。');
  }
  function upgradeGeneration() {
    if (editor.generation?.version !== 1) return;
    regenerate(editor.generation.seed);
    setNotice('已切换为精细生成，将按原色块与种子重新构图。可撤销回旧版画面。');
  }
  function generate() {
    const recipe = editor.generation || generationDraft;
    if (
      !editor.regions.some((region) => region.visible && region.biome !== 'water') &&
      !(recipe.version === 2 && recipe.elevation && recipe.elevation.preset !== 'sketch')
    ) {
      setNotice('先用草原、森林或山地画出陆地，再生成地图。蓝色用于挖出湖泊和海湾。');
      setTool('terrain');
      return;
    }
    cancel();
    commit({
      generation: {
        ...recipe,
        version: 2,
        detail: recipe.version === 2 ? recipe.detail : 'high',
        linework: 'organic',
        geography:
          recipe.version === 2 && recipe.geography
            ? recipe.geography
            : { ...defaultGeographicSettings(map?.kind ?? 'world'), source: 'sketch' },
      },
      generated: editor.generated && { ...editor.generated, signature: '0000000000000000-0' },
      baseVisible: false,
    });
    setSourcePreview(false);
    setTerrainViewState('atlas');
    setNotice('已启用色块生成。继续绘制会自动更新；换变体与参数修改都可以撤销。');
  }
  function regenerate(seed?: number) {
    if (!editor.generation) return;
    const nextSeed = seed ?? (editor.generation.seed + 2654435761) >>> 0;
    if (!Number.isInteger(nextSeed) || nextSeed < 0 || nextSeed > 0xffffffff) return;
    cancel();
    // Explicit regeneration opts into the current generator. Merely opening a
    // saved map or adjusting its existing options still preserves its recipe.
    commit({
      generation: {
        ...editor.generation,
        version: 2,
        detail: editor.generation.version === 2 ? editor.generation.detail : 'high',
        linework: 'organic',
        geography:
          editor.generation.version === 2 && editor.generation.geography
            ? editor.generation.geography
            : {
                ...defaultGeographicSettings(map?.kind ?? 'world'),
                source: editor.regions.some((r) => r.visible && r.biome !== 'water')
                  ? 'sketch'
                  : 'random',
              },
        seed: nextSeed,
      },
      generated: editor.generated && { ...editor.generated, signature: '0000000000000000-0' },
      baseVisible: false,
    });
    setSourcePreview(false);
    setNotice('已使用新版重新生成。原色块和人工内容保留，可撤销对比原画面。');
  }
  function varyGeneration() {
    regenerate();
  }
  function stopGeneration() {
    cancel();
    if (editor.generation)
      setGenerationDraft({
        ...editor.generation,
        version: 2,
        detail: editor.generation.version === 2 ? editor.generation.detail : 'high',
        linework: 'organic',
      });
    commit({ generation: undefined });
    setSourcePreview(false);
    setTerrainView('atlas');
    setNotice(
      elevationSettings
        ? '已停用海拔与自动生成，海拔配方及其笔划已移除，可撤销。原色块、手动组件、普通笔画和标记保留。'
        : '已停止自动生成，原始色块、手动组件、笔画和标记均保留。需要保留生成画面时，请使用“将生成图转为可编辑组件”。',
    );
  }
  function mode(next: EditorMode) {
    cancel();
    commit({ mode: next });
    setTool(
      terrainView === 'elevation'
        ? elevationSettings
          ? 'elevation'
          : 'pan'
        : next === 'detail'
          ? 'pan'
          : 'terrain',
    );
    setSelected(null);
  }
  function chooseBiome(next: TerrainBiome) {
    if (editor.generation?.version === 1 && !legacyBiomeIds.some((id) => id === next)) {
      setNotice('请先升级精细生成，再使用新地貌；升级可以撤销。');
      return;
    }
    const preset = brushPresets[next];
    setBiome(next);
    setDensity(preset.density);
    setRoughness(preset.roughness);
    setTool('terrain');
    setTerrainViewState('atlas');
    setSelected(null);
  }
  function point(p: MapPoint): MapPoint {
    const snapPoint = snap && editor.mode === 'detail' && tool !== 'elevation';
    const x = snapPoint ? Math.round(p.x / 10) * 10 : p.x;
    const y = snapPoint ? Math.round(p.y / 10) * 10 : p.y;
    return {
      x: rounded(Math.max(0, Math.min(map?.width || 1000, x))),
      y: rounded(Math.max(0, Math.min(map?.height || 640, y))),
    };
  }
  function appendObjects(objects: MapObject[]) {
    if (!objects.length) return;
    if (editor.objects.length + objects.length > 8000) {
      setNotice('组件已达 8000 个，请先删除不需要的组件。');
      return;
    }
    commit({ objects: [...editor.objects, ...objects] });
    setSelected({ type: 'object', id: objects.at(-1)!.id });
  }
  function appendRegion(region: MapRegion) {
    if (editor.regions.length >= 200) {
      setNotice('区域已达 200 个，请先整理已有区域。');
      return;
    }
    commit({ regions: [...editor.regions, region] });
    setSelected({ type: 'region', id: region.id });
  }
  function newRegion(p: MapPoint, geometry: MapRegion['geometry'] = 'brush'): MapRegion {
    return {
      id: makeId('region'),
      name: biomeCatalog.find((b) => b.id === biome)!.label + '区域',
      biome,
      geometry,
      points: [p],
      width: radius,
      seed: rnd(),
      roughness,
      density,
      visible: true,
      locked: false,
    };
  }
  function finish() {
    if (vertices.length < (tool === 'path' ? 2 : 3)) return;
    if (tool === 'area') appendRegion({ ...newRegion(vertices[0], 'polygon'), points: vertices });
    else
      appendObjects([
        createMapObject(tool === 'path' ? 'path' : 'polygon', vertices[0], {
          name: tool === 'path' ? '手绘路径' : '手绘轮廓',
          points: vertices,
          color: tool === 'path' ? 'none' : color,
          stroke: '#526a56',
          strokeWidth: 2,
        }),
      ]);
    setVertices([]);
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>, raw: MapPoint): boolean {
    if (!map || event.ctrlKey || event.metaKey) return false;
    const p = point(raw);
    setNotice('');
    if (tool === 'elevation') {
      if (!elevationSettings || editor.generation?.version !== 2) {
        setNotice('先点击「启用海拔编辑」，再在地图上塑造高低起伏。');
        return true;
      }
      const pointCount = elevationSettings.strokes.reduce(
        (sum, stroke) => sum + stroke.points.length,
        0,
      );
      if (elevationSettings.strokes.length >= 96 || pointCount >= 8192) {
        setNotice('海拔编辑已达容量上限（96 笔或 8192 个采样点），可撤销或清除海拔笔划后重绘。');
        return true;
      }
      const stroke: ElevationStroke = {
        id: makeId('elevation'),
        operation: elevationOperation,
        points: [p],
        width: elevationWidth,
        strength: elevationStrength,
        target: elevationTarget,
      };
      gesture.current = { kind: 'elevation', stroke, maxPoints: Math.min(256, 8192 - pointCount) };
      setDraftElevation(stroke);
      return true;
    }
    if (tool === 'sampler') {
      const region = [...editor.regions].reverse().find((r) => r.visible && pointInRegion(p, r));
      if (!region) {
        setNotice('这里没有已绘制的地形；请点击色刷区域。');
        return true;
      }
      setBiome(region.biome);
      setRadius(Math.max(5, Math.min(500, region.width)));
      setDensity(region.density);
      setRoughness(region.roughness);
      setSelected(null);
      setTool('terrain');
      setNotice(
        `已吸取${biomeCatalog.find((b) => b.id === region.biome)!.label}笔刷，可继续绘制。`,
      );
      return true;
    }
    if (tool === 'terrain') {
      const region = newRegion(p);
      gesture.current = { kind: 'region', region };
      setDraftRegion(region);
      return true;
    }
    if (tool === 'area' || tool === 'polygon' || tool === 'path') {
      if (vertices.length >= 2000) {
        setNotice('单个轮廓最多 2000 个顶点，请完成当前绘制。');
        return true;
      }
      setVertices((old) => [...old, p]);
      return true;
    }
    if (tool === 'cluster') {
      const result = makeSmartGroup(map, p, symbol, radius, size, density, rnd());
      appendObjects(result.objects);
      setNotice(result.description);
      return true;
    }
    if (tool === 'symbol' || tool === 'text') {
      appendObjects([
        createMapObject(tool, p, {
          ...(tool === 'symbol' ? { symbol } : {}),
          name: tool === 'text' ? label : symbolCatalog.find((s) => s.id === symbol)!.label,
          text: tool === 'text' ? label : '',
          size: tool === 'text' ? 24 : size,
          color,
          stroke: tool === 'text' ? 'none' : '#465b49',
          strokeWidth: tool === 'text' ? 0 : 1,
        }),
      ]);
      return true;
    }
    if (tool === 'rectangle' || tool === 'ellipse') {
      const object = createMapObject('polygon', p, {
        name: tool === 'rectangle' ? '矩形区域' : '椭圆区域',
        points: [p, p, p],
        color,
        stroke: '#526a56',
      });
      gesture.current = { kind: 'shape', start: p, object };
      setDraftObject(object);
      return true;
    }
    if (tool === 'select' || tool === 'nodes') {
      const target = event.target as Element;
      const vertexValue = target.closest('[data-map-vertex]')?.getAttribute('data-map-vertex');
      if (vertexValue != null && selectedObject && !selectedObject.locked) {
        const index = Number(vertexValue);
        setVertex(index);
        gesture.current = {
          kind: 'move',
          start: p,
          original: selectedObject,
          object: selectedObject,
          vertex: index,
        };
        return true;
      }
      const objectId = target.closest('[data-map-object]')?.getAttribute('data-map-object');
      const regionId = target.closest('[data-map-region]')?.getAttribute('data-map-region');
      const object = editor.objects.find((o) => o.id === objectId);
      const region = editor.regions.find((r) => r.id === regionId);
      if (object) {
        setSelected({ type: 'object', id: object.id });
        setVertex(0);
        if (!object.locked) gesture.current = { kind: 'move', start: p, original: object, object };
        return true;
      }
      if (region) {
        setSelected({ type: 'region', id: region.id });
        if (!region.locked) gesture.current = { kind: 'move', start: p, original: region, region };
        return true;
      }
      setSelected(null);
    }
    return false;
  }
  function pointerMove(raw: MapPoint): boolean {
    const active = gesture.current;
    if (!active || !map) return false;
    const p = point(raw);
    if (active.kind === 'elevation') {
      const last = active.stroke.points.at(-1)!;
      if (Math.hypot(p.x - last.x, p.y - last.y) >= Math.max(1, active.stroke.width / 18)) {
        if (active.stroke.points.length < active.maxPoints) {
          active.stroke = { ...active.stroke, points: [...active.stroke.points, p] };
          setDraftElevation(active.stroke);
        } else {
          setNotice('这一笔已达到采样上限，请松开鼠标，再开始下一笔。');
        }
      }
    } else if (active.kind === 'region') {
      const last = active.region.points.at(-1)!;
      if (
        Math.hypot(p.x - last.x, p.y - last.y) > Math.max(1, radius / 20) &&
        active.region.points.length < 2000
      ) {
        active.region = { ...active.region, points: [...active.region.points, p] };
        setDraftRegion(active.region);
      }
    } else if (active.kind === 'shape') {
      const a = active.start,
        cx = (a.x + p.x) / 2,
        cy = (a.y + p.y) / 2;
      const points =
        tool === 'ellipse'
          ? Array.from({ length: 32 }, (_, i) => ({
              x: rounded(cx + (Math.cos((i * Math.PI) / 16) * Math.abs(p.x - a.x)) / 2),
              y: rounded(cy + (Math.sin((i * Math.PI) / 16) * Math.abs(p.y - a.y)) / 2),
            }))
          : [a, { x: p.x, y: a.y }, p, { x: a.x, y: p.y }];
      active.object = { ...active.object, points };
      setDraftObject(active.object);
    } else {
      const original = active.original;
      const xs = original.points.map((v) => v.x),
        ys = original.points.map((v) => v.y);
      const dx = Math.max(
        -Math.min(...xs),
        Math.min(map.width - Math.max(...xs), p.x - active.start.x),
      );
      const dy = Math.max(
        -Math.min(...ys),
        Math.min(map.height - Math.max(...ys), p.y - active.start.y),
      );
      const points = original.points.map((v, i) =>
        active.vertex != null
          ? i === active.vertex
            ? p
            : v
          : { x: rounded(v.x + dx), y: rounded(v.y + dy) },
      );
      if (active.object) {
        active.object = { ...active.object, points };
        setDraftObject(active.object);
      } else if (active.region) {
        active.region = { ...active.region, points };
        setDraftRegion(active.region);
      }
    }
    return true;
  }
  function pointerUp(): boolean {
    const active = gesture.current;
    if (!active) return false;
    // Clear the gesture before committing so a duplicate pointer-up cannot save twice.
    gesture.current = null;
    if (active.kind === 'elevation') {
      if (editor.generation?.version === 2 && elevationSettings) {
        commit({
          generation: {
            ...editor.generation,
            elevation: {
              ...elevationSettings,
              strokes: [...elevationSettings.strokes, active.stroke],
            },
          },
        });
      }
    } else if (active.kind === 'region') appendRegion(active.region);
    else if (active.kind === 'shape') {
      if (
        Math.abs(active.object.points[0].x - active.object.points[2].x) +
          Math.abs(active.object.points[0].y - active.object.points[2].y) >
        2
      )
        appendObjects([active.object]);
    } else if (active.object)
      commit({
        objects: editor.objects.map((o) => (o.id === active.object!.id ? active.object! : o)),
      });
    else if (active.region)
      commit({
        regions: editor.regions.map((o) => (o.id === active.region!.id ? active.region! : o)),
      });
    gesture.current = null;
    setDraftRegion(undefined);
    setDraftObject(undefined);
    setDraftElevation(undefined);
    return true;
  }
  function patchObject(patch: Partial<MapObject>) {
    if (selectedObject)
      commit({
        objects: editor.objects.map((o) => (o.id === selectedObject.id ? { ...o, ...patch } : o)),
      });
  }
  function patchRegion(patch: Partial<MapRegion>) {
    if (
      patch.biome &&
      editor.generation?.version === 1 &&
      !legacyBiomeIds.some((id) => id === patch.biome)
    ) {
      setNotice('请先升级精细生成，再使用新地貌；升级可以撤销。');
      return;
    }
    if (selectedRegion)
      commit({
        regions: editor.regions.map((o) => (o.id === selectedRegion.id ? { ...o, ...patch } : o)),
      });
  }
  function remove() {
    if ((selectedObject || selectedRegion)?.locked) {
      setNotice('选中内容已锁定，请先解锁。');
      return;
    }
    if (selectedObject)
      commit({ objects: editor.objects.filter((o) => o.id !== selectedObject.id) });
    if (selectedRegion)
      commit({ regions: editor.regions.filter((o) => o.id !== selectedRegion.id) });
    setSelected(null);
  }
  function duplicate() {
    if (!map) return;
    const imageOffset =
      selectedObject?.kind === 'image'
        ? {
            x: Math.min(12, map.width - Math.max(...selectedObject.points.map((p) => p.x))),
            y: Math.min(12, map.height - Math.max(...selectedObject.points.map((p) => p.y))),
          }
        : { x: 12, y: 12 };
    if (selectedObject)
      appendObjects([
        {
          ...selectedObject,
          id: makeId('object'),
          name: selectedObject.name + ' 副本',
          locked: false,
          points: selectedObject.points.map((p) =>
            point({ x: p.x + imageOffset.x, y: p.y + imageOffset.y }),
          ),
        },
      ]);
    if (selectedRegion)
      appendRegion({
        ...selectedRegion,
        id: makeId('region'),
        name: selectedRegion.name + ' 副本',
        locked: false,
      });
  }
  function order(direction: number) {
    if (!selected) return;
    const key = selected.type === 'object' ? 'objects' : 'regions';
    const values = [...editor[key]];
    const at = values.findIndex((o) => o.id === selected.id);
    if (at < 0) return;
    let to = at + direction;
    while (
      key === 'objects' &&
      to >= 0 &&
      to < values.length &&
      ((values[to] as MapObject).layer || 'detail') !==
        ((values[at] as MapObject).layer || 'detail')
    )
      to += direction;
    if (to < 0 || to >= values.length) return;
    [values[at], values[to]] = [values[to], values[at]];
    commit({ [key]: values });
  }
  function bake() {
    if (!map) return;
    try {
      const objects = bakeMapArtwork(map);
      if (objects.length > 8000)
        throw new Error('转换结果超过 8000 个组件，请减少区域密度后重试。');
      update({
        editor: {
          ...editor,
          mode: 'detail',
          baseVisible: false,
          regions: [],
          objects,
          generation: undefined,
        },
        strokes: [],
      });
      setSelected(null);
      setTool('select');
      setBakeConfirm(false);
      setSourcePreview(false);
      setTerrainViewState('atlas');
      setNotice('生成结果已转为独立组件，可逐点编辑；可撤销本次转换。');
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  function fresh() {
    update({ editor: { ...editor, baseVisible: false } });
    setFreshConfirm(false);
    setTool('terrain');
    setNotice('已关闭随机底图。用地形色刷开始绘制，已有自绘区域保留。');
  }
  const previewMap = useMemo(
    () =>
      map && (draftObject || draftElevation)
        ? {
            ...map,
            editor: {
              ...editor,
              ...(draftElevation && editor.generation?.version === 2 && elevationSettings
                ? {
                    generation: {
                      ...editor.generation,
                      elevation: {
                        ...elevationSettings,
                        strokes: [...elevationSettings.strokes, draftElevation],
                      },
                    },
                  }
                : {}),
              objects: draftObject
                ? editor.objects.map((o) => (o.id === draftObject.id ? draftObject : o))
                : editor.objects,
            },
          }
        : map,
    [map, editor, draftElevation, draftObject, elevationSettings],
  );
  return {
    editor,
    terrainView,
    setTerrainView,
    elevationSettings,
    enableElevation,
    elevationOptions,
    chooseElevationBrush,
    clearElevationStrokes,
    elevationOperation,
    setElevationOperation,
    elevationWidth,
    setElevationWidth: setRadius,
    elevationStrength,
    setElevationStrength,
    elevationTarget,
    setElevationTarget,
    draftElevation,
    sourcePreview,
    setSourcePreview,
    generationSettings: editor.generation || generationDraft,
    generationOptions,
    upgradeGeneration,
    generate,
    regenerate,
    varyGeneration,
    stopGeneration,
    mode,
    biome,
    setBiome,
    chooseBiome,
    radius,
    setRadius,
    cursor,
    setCursor,
    density,
    setDensity,
    roughness,
    setRoughness,
    symbol,
    setSymbol,
    size,
    setSize,
    color,
    setColor,
    label,
    setLabel,
    snap,
    setSnap,
    selected,
    setSelected,
    vertex,
    setVertex,
    vertices,
    draftRegion,
    draftObject,
    selectedObject,
    selectedRegion,
    notice,
    setNotice,
    bakeConfirm,
    setBakeConfirm,
    freshConfirm,
    setFreshConfirm,
    commit,
    finish,
    cancel,
    pointerDown,
    pointerMove,
    pointerUp,
    patchObject,
    patchRegion,
    remove,
    duplicate,
    order,
    bake,
    fresh,
    previewMap,
  };
}
export type MapStudio = ReturnType<typeof useMapStudio>;
