import { useEffect, useState } from 'react';
import { ElevationPanel } from './ElevationPanel';
import { MountainStyleGallery } from './MountainStyleGallery';
import { MOUNTAIN_STYLES } from '../lib/mountain-styles';
import {
  LockKeyhole,
  Unlock,
  Eye,
  EyeOff,
  Copy,
  Trash2,
  ChevronUp,
  ChevronDown,
  WandSparkles,
  PencilRuler,
  Sprout,
  LoaderCircle,
  Check,
} from 'lucide-react';
import type { AtlasMap } from '../../shared/model';
import type {
  EditorMode,
  MapObject,
  MapPoint,
  SketchGenerationSettings,
  SketchGenerationDetail,
  GeneratedSettlement,
} from '../../shared/cartography';
import {
  biomeCatalog,
  symbolCatalog,
  legacyBiomeIds,
  generationDetailCatalog,
  symbolCategories,
  type SymbolCategory,
} from '../../shared/cartography';
import { MapGlyph, MapObjectArtwork } from './MapArtwork';
import { linePath } from '../lib/terrain';
import type { MapStudio, StudioTool } from './useMapStudio';
import { brushPresets } from '../lib/map-brushes';
import './MapStudio.css';
import { SketchModeControl } from './SketchModeControl';
import { defaultGeographicSettings } from '../../shared/geography';

export const studioModes = [
  { id: 'sketch', name: '快速生成', caption: '画下颜色，让地形成形', Icon: Sprout },
  { id: 'sculpt', name: '智能塑形', caption: '调整区域，组合地貌与聚落', Icon: WandSparkles },
  { id: 'detail', name: '精细编辑', caption: '掌控每个组件与轮廓顶点', Icon: PencilRuler },
] as const;
export function StudioModeBar({ studio, onChange }: { studio: MapStudio; onChange?: () => void }) {
  return (
    <div className="studio-modes" aria-label="地图编辑级别">
      {studioModes.map(({ id, name, caption, Icon }, i) => (
        <button
          key={id}
          aria-pressed={studio.editor.mode === id}
          className={studio.editor.mode === id ? 'active' : ''}
          onClick={() => {
            studio.mode(id);
            onChange?.();
          }}
        >
          <span className="studio-level">0{i + 1}</span>
          <Icon size={20} />
          <span>
            <strong>{name}</strong>
            <small>{caption}</small>
          </span>
        </button>
      ))}
    </div>
  );
}
function NumberField({
  label,
  value,
  min = 0,
  max = 10000,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(Math.round(value * 100) / 100)), [value]);
  return (
    <label className="studio-field">
      {label}
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (draft.trim() && Number.isFinite(n) && n >= min && n <= max) onChange(n);
          else setDraft(String(value));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}
const toolLabels: Partial<Record<StudioTool, string>> = {
  terrain: '地形色刷',
  sampler: '地形取样',
  area: '圈定区域',
  symbol: '单个组件',
  cluster: '智能群组',
  nodes: '顶点编辑',
  path: '折线路径',
  polygon: '多边形',
  rectangle: '矩形',
  ellipse: '椭圆',
  text: '文字标签',
  select: '选择 / 移动',
  brush: '自由画笔',
  river: '河流',
  road: '道路',
  erase: '擦除笔画',
};
function ToolButton({
  id,
  tool,
  setTool,
}: {
  id: StudioTool;
  tool: StudioTool;
  setTool: (t: StudioTool) => void;
}) {
  return (
    <button
      className={id === tool ? 'active' : ''}
      aria-pressed={id === tool}
      onClick={() => setTool(id)}
    >
      {toolLabels[id]}
    </button>
  );
}

export function MapStudioPanel({
  map,
  studio: s,
  tool,
  setTool,
  terrainPending = false,
  terrainError = '',
  settlements = [],
  onFocusSettlement,
}: {
  map: AtlasMap;
  studio: MapStudio;
  tool: StudioTool;
  setTool: (t: StudioTool) => void;
  terrainPending?: boolean;
  terrainError?: string;
  settlements?: GeneratedSettlement[];
  onFocusSettlement?: (site: GeneratedSettlement) => void;
}) {
  const [filter, setFilter] = useState('');
  const [symbolFilter, setSymbolFilter] = useState('');
  const [symbolCategory, setSymbolCategory] = useState<SymbolCategory | 'all'>('all');
  const [imageRatioLocked, setImageRatioLocked] = useState(true);
  const [mountainGallery, setMountainGallery] = useState(false);
  const mode = s.editor.mode;
  const legacyGeneration = s.editor.generation?.version === 1;
  const randomSource =
    s.generationSettings.version === 2 && s.generationSettings.geography?.source === 'random';
  const visibleRegions = s.editor.regions.filter((region) => region.visible);
  const hasLand = visibleRegions.some((region) => region.biome !== 'water');
  const hasLandscape = visibleRegions.some(
    (region) => region.biome !== 'grass' && region.biome !== 'water',
  );
  const organicLinework =
    s.editor.generation?.version === 2 && s.editor.generation.linework === 'organic';
  const biomeAvailable = (biome: string) =>
    !legacyGeneration || legacyBiomeIds.some((id) => id === biome);
  const object = s.selectedObject,
    region = s.selectedRegion,
    item = object || region;
  const isPolygon = tool === 'area' || tool === 'polygon' || tool === 'path';
  const symbols = symbolCatalog.filter(
    (sym) =>
      (symbolCategory === 'all' || sym.category === symbolCategory) &&
      sym.label.includes(symbolFilter.trim()),
  );
  const listed = [
    ...s.editor.objects.map((o) => ({ ...o, category: 'object' as const })),
    ...s.editor.regions.map((o) => ({ ...o, category: 'region' as const })),
  ]
    .reverse()
    .filter((o) => o.name.includes(filter));
  function translate(axis: 'x' | 'y', value: number) {
    if (!object) return;
    const change = value - object.points[0][axis];
    const points = object.points.map((p) => ({ ...p, [axis]: p[axis] + change }));
    if (points.every((p) => p.x >= 0 && p.x <= map.width && p.y >= 0 && p.y <= map.height))
      s.patchObject({ points });
    else s.setNotice('移动后有顶点超出画布，请输入更靠内的坐标。');
  }
  function changePoint(axis: 'x' | 'y', value: number) {
    if (object)
      s.patchObject({
        points: object.points.map((p, i) => (i === s.vertex ? { ...p, [axis]: value } : p)),
      });
  }
  function resizeImage(axis: 'x' | 'y', value: number) {
    if (!object || object.kind !== 'image') return;
    const a = object.points[0],
      b = object.points[1],
      width = b.x - a.x,
      height = b.y - a.y;
    const w = axis === 'x' ? value : imageRatioLocked ? (value * width) / height : width;
    const h = axis === 'y' ? value : imageRatioLocked ? (value * height) / width : height;
    if (a.x + w > map.width || a.y + h > map.height) {
      s.setNotice('图片超出画布，请先缩小或移动图片。');
      return;
    }
    s.patchObject({ points: [a, { x: a.x + w, y: a.y + h }] });
  }
  const prioritizeSelection = tool === 'select' || tool === 'nodes';
  const selectionPanel = item && (
    <section className="studio-selected">
      <div className="studio-section-heading">
        {object ? '组件属性' : '局部地形'}
        <button className="text-btn" onClick={() => s.setSelected(null)}>
          取消选择
        </button>
      </div>
      <label className="studio-field">
        名称
        <input
          value={item.name}
          maxLength={120}
          disabled={item.locked}
          onChange={(e) =>
            object
              ? s.patchObject({ name: e.target.value })
              : s.patchRegion({ name: e.target.value })
          }
        />
      </label>
      <div className="studio-item-actions">
        <button
          title="锁定/解锁"
          aria-label="锁定选中组件"
          aria-pressed={item.locked}
          onClick={() =>
            object
              ? s.patchObject({ locked: !item.locked })
              : s.patchRegion({ locked: !item.locked })
          }
        >
          {item.locked ? <LockKeyhole size={15} /> : <Unlock size={15} />}
        </button>
        <button
          title="隐藏/显示"
          aria-label="隐藏选中组件"
          onClick={() =>
            object
              ? s.patchObject({ visible: !item.visible })
              : s.patchRegion({ visible: !item.visible })
          }
        >
          {item.visible ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        <button aria-label="复制选中组件" onClick={s.duplicate}>
          <Copy size={15} />
        </button>
        <button aria-label="上移一层" disabled={item.locked} onClick={() => s.order(1)}>
          <ChevronUp size={15} />
        </button>
        <button aria-label="下移一层" disabled={item.locked} onClick={() => s.order(-1)}>
          <ChevronDown size={15} />
        </button>
        <button aria-label="删除选中组件" disabled={item.locked} onClick={s.remove}>
          <Trash2 size={15} />
        </button>
      </div>
      {region && s.editor.generation && (
        <p className="studio-footnote">
          锁定保护这片原始色块；修改其他区域或生成参数，仍会重新计算整体地形。
        </p>
      )}
      <fieldset disabled={item.locked}>
        {region && (
          <>
            <label className="studio-field">
              地貌类型
              <select
                value={region.biome}
                onChange={(e) => s.patchRegion({ biome: e.target.value as typeof region.biome })}
              >
                {biomeCatalog.map((b) => (
                  <option key={b.id} value={b.id} disabled={!biomeAvailable(b.id)}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
            {mode !== 'sketch' && (
              <>
                <label className="studio-field">
                  区域密度
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step=".05"
                    value={region.density}
                    onChange={(e) => s.patchRegion({ density: Number(e.target.value) })}
                  />
                </label>
                <label className="studio-field">
                  区域起伏
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step=".05"
                    value={region.roughness}
                    onChange={(e) => s.patchRegion({ roughness: Number(e.target.value) })}
                  />
                </label>
              </>
            )}
            <button
              className="btn studio-full"
              onClick={() => s.patchRegion({ seed: Math.floor(Math.random() * 0xffffffff) })}
            >
              {s.editor.generation ? '改变这片色块的起伏' : '仅重生成这片区域'}
            </button>
          </>
        )}
        {object && (
          <>
            <label className="studio-field">
              所在图层
              <select
                value={object.layer || 'detail'}
                onChange={(e) => s.patchObject({ layer: e.target.value as MapObject['layer'] })}
              >
                <option value="detail">细节层 · 位于地形色块上方</option>
                <option value="base">底图层 · 位于地形色块下方</option>
              </select>
            </label>
            <div className="studio-two-cols">
              <NumberField
                label="位置 X"
                value={object.points[0].x}
                max={map.width}
                onChange={(v) => translate('x', v)}
              />
              <NumberField
                label="位置 Y"
                value={object.points[0].y}
                max={map.height}
                onChange={(v) => translate('y', v)}
              />
            </div>
            {(object.kind === 'symbol' || object.kind === 'text' || object.kind === 'image') && (
              <div className="studio-two-cols">
                {object.kind !== 'image' && (
                  <NumberField
                    label="尺寸"
                    value={object.size}
                    min={1}
                    max={500}
                    onChange={(size) => s.patchObject({ size })}
                  />
                )}
                <NumberField
                  label="旋转角度"
                  value={object.rotation}
                  min={-360}
                  max={360}
                  onChange={(rotation) => s.patchObject({ rotation })}
                />
              </div>
            )}
            {object.kind === 'image' && (
              <>
                <div className="studio-two-cols">
                  <NumberField
                    label="图片宽度"
                    value={object.points[1].x - object.points[0].x}
                    min={1}
                    max={map.width - object.points[0].x}
                    onChange={(n) => resizeImage('x', n)}
                  />
                  <NumberField
                    label="图片高度"
                    value={object.points[1].y - object.points[0].y}
                    min={1}
                    max={map.height - object.points[0].y}
                    onChange={(n) => resizeImage('y', n)}
                  />
                </div>
                <label className="studio-check">
                  <input
                    type="checkbox"
                    checked={imageRatioLocked}
                    onChange={(e) => setImageRatioLocked(e.target.checked)}
                  />
                  保持图片长宽比例
                </label>
                <p className="studio-footnote">
                  上传图片作为单个图层保存。调整透明度可用于描图；保存 JSON 不包含图片原文件。
                </p>
              </>
            )}
            {object.kind === 'text' && (
              <label className="studio-field">
                文字
                <input
                  maxLength={500}
                  value={object.text}
                  onChange={(e) => s.patchObject({ text: e.target.value })}
                />
              </label>
            )}
            {object.kind !== 'image' && (
              <>
                <div className="studio-color-row">
                  <label>
                    填色
                    <input
                      type="color"
                      aria-label="组件填色"
                      value={object.color === 'none' ? '#ffffff' : object.color.slice(0, 7)}
                      onChange={(e) => s.patchObject({ color: e.target.value })}
                    />
                  </label>
                  <label>
                    描边
                    <input
                      aria-label="组件描边"
                      type="color"
                      value={object.stroke === 'none' ? '#526a56' : object.stroke.slice(0, 7)}
                      onChange={(e) => s.patchObject({ stroke: e.target.value })}
                    />
                  </label>
                </div>
                <label className="studio-check">
                  <input
                    type="checkbox"
                    checked={object.color === 'none'}
                    onChange={(e) => s.patchObject({ color: e.target.checked ? 'none' : s.color })}
                  />
                  透明填充
                </label>
              </>
            )}
            <div className="studio-two-cols">
              {object.kind !== 'image' && (
                <NumberField
                  label="描边宽度"
                  value={object.strokeWidth}
                  max={40}
                  step={0.5}
                  onChange={(strokeWidth) => s.patchObject({ strokeWidth })}
                />
              )}
              <NumberField
                label="不透明度"
                value={object.opacity}
                max={1}
                step={0.05}
                onChange={(opacity) => s.patchObject({ opacity })}
              />
            </div>
            <NumberField
              label="边缘柔和度"
              value={object.blur || 0}
              max={40}
              step={0.5}
              onChange={(blur) => s.patchObject({ blur })}
            />
            {mode === 'detail' && (object.kind === 'polygon' || object.kind === 'path') && (
              <>
                <button className="btn studio-full" onClick={() => setTool('nodes')}>
                  编辑轮廓顶点（{object.points.length}）
                </button>
                {tool === 'nodes' && (
                  <>
                    <label className="studio-field">
                      当前顶点
                      <select
                        aria-label="选择顶点"
                        value={Math.min(s.vertex, object.points.length - 1)}
                        onChange={(e) => s.setVertex(Number(e.target.value))}
                      >
                        {object.points.map((_, i) => (
                          <option key={i} value={i}>
                            顶点 {i + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="studio-two-cols">
                      <NumberField
                        label="顶点 X"
                        value={object.points[Math.min(s.vertex, object.points.length - 1)].x}
                        max={map.width}
                        onChange={(v) => changePoint('x', v)}
                      />
                      <NumberField
                        label="顶点 Y"
                        value={object.points[Math.min(s.vertex, object.points.length - 1)].y}
                        max={map.height}
                        onChange={(v) => changePoint('y', v)}
                      />
                    </div>
                    <div className="studio-tool-grid">
                      <button
                        disabled={object.points.length >= 2000}
                        onClick={() => {
                          const i = Math.min(s.vertex, object.points.length - 1),
                            a = object.points[i],
                            b = object.points[(i + 1) % object.points.length];
                          const points = [...object.points];
                          points.splice(i + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
                          s.patchObject({ points });
                          s.setVertex(i + 1);
                        }}
                      >
                        插入顶点
                      </button>
                      <button
                        disabled={object.points.length <= (object.kind === 'polygon' ? 3 : 2)}
                        onClick={() => {
                          s.patchObject({
                            points: object.points.filter((_, i) => i !== s.vertex),
                          });
                          s.setVertex(0);
                        }}
                      >
                        删除顶点
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}
      </fieldset>
    </section>
  );
  return (
    <div className="studio-panel">
      <div className="studio-intro">
        <span>LEVEL {mode === 'sketch' ? '01' : mode === 'sculpt' ? '02' : '03'}</span>
        <h3>{studioModes.find((m) => m.id === mode)?.name}</h3>
        <p>
          {s.terrainView === 'elevation'
            ? '从模板或现有色块生成地势，再用海拔笔刷塑造山脊与谷地。切回地形可继续调整地貌，完整地图会结合两者更新。'
            : mode === 'sketch'
              ? '先涂草原定陆地，再添山地、森林和水域。生成器沿这些意图整理海岸、河流与聚落；留白视为海洋。'
              : mode === 'sculpt'
                ? '用预设笔刷塑造地形，取样后继续绘制。点选区域即可调整，群组工具会组合地标与周边环境。'
                : '自由创建形状、线条和组件。将生成图转为组件后，海岸、建筑、山林都能逐个选择和修改。'}
        </p>
      </div>
      <ElevationPanel
        studio={s}
        tool={tool}
        mapId={map.id}
        pending={terrainPending}
        error={terrainError}
      />
      {s.notice && (
        <div className="studio-notice" role="status">
          {s.notice}
          <button aria-label="关闭地图提示" onClick={() => s.setNotice('')}>
            ×
          </button>
        </div>
      )}
      {s.terrainView === 'atlas' && (
        <div data-terrain-controls="true">
          <button
            className="btn studio-full mountain-gallery-open"
            onClick={() => setMountainGallery(true)}
          >
            山峰样式图鉴 · {MOUNTAIN_STYLES.length} 种
          </button>
          {mountainGallery && <MountainStyleGallery onClose={() => setMountainGallery(false)} />}
          {(mode !== 'detail' || s.editor.generation) && (
            <section
              className="studio-generation"
              aria-label={randomSource ? '随机地图生成' : '色块地图生成'}
            >
              <div className="studio-generation-heading">
                <WandSparkles size={17} />
                <strong>{randomSource ? '随机地形 → 完整地图' : '色块 → 完整地图'}</strong>
                <span aria-live="polite">
                  {s.editor.generation
                    ? terrainPending
                      ? '正在更新…'
                      : terrainError
                        ? '需要调整'
                        : s.sourcePreview
                          ? '查看色块'
                          : '预览已更新'
                    : '先画，再生成'}
                </span>
              </div>
              {randomSource && (
                <p role="note" aria-label="地图生成来源">
                  当前使用随机地形，可继续用地形与海拔笔刷修改。A／B／C
                  色块模式在新建地图选择「按照色块生成」后提供。
                </p>
              )}
              {s.generationSettings.version === 2 &&
                (!s.generationSettings.geography ||
                  s.generationSettings.geography.source === 'sketch') && (
                  <SketchModeControl
                    value={s.generationSettings.geography?.sketchMode ?? 'balanced'}
                    onChange={(sketchMode) =>
                      s.generationOptions({
                        geography: {
                          ...((s.generationSettings.version === 2
                            ? s.generationSettings.geography
                            : undefined) ?? defaultGeographicSettings(map.kind)),
                          source: 'sketch',
                          sketchMode,
                        },
                      })
                    }
                  />
                )}
              {!s.editor.generation ? (
                <>
                  <div className="studio-preview-switch" aria-label="地图预览模式">
                    <button aria-pressed={s.sourcePreview} onClick={() => s.setSourcePreview(true)}>
                      色块草稿
                    </button>
                    <button
                      aria-pressed={!s.sourcePreview}
                      onClick={() => s.setSourcePreview(false)}
                    >
                      地形效果
                    </button>
                  </div>
                  <ol className="studio-generation-steps" aria-label="色块生成步骤">
                    <li>
                      <button
                        className={s.biome === 'grass' && tool === 'terrain' ? 'active' : ''}
                        onClick={() => {
                          s.setSourcePreview(true);
                          s.chooseBiome('grass');
                        }}
                        aria-label="第一步：画陆地"
                      >
                        <span className="studio-step-number">
                          {hasLand ? <Check size={13} /> : '1'}
                        </span>
                        <span>
                          <strong>画陆地</strong>
                          <small>绿色定轮廓，留白是海</small>
                        </span>
                      </button>
                    </li>
                    <li>
                      <button
                        className={s.biome === 'mountain' && tool === 'terrain' ? 'active' : ''}
                        onClick={() => {
                          s.setSourcePreview(true);
                          s.chooseBiome('mountain');
                        }}
                        aria-label="第二步：添山林"
                      >
                        <span className="studio-step-number">
                          {hasLandscape ? <Check size={13} /> : '2'}
                        </span>
                        <span>
                          <strong>
                            添山林 <em>可选</em>
                          </strong>
                          <small>山地引导水系，森林指定植被</small>
                        </span>
                      </button>
                    </li>
                  </ol>
                  <button
                    className="btn primary studio-full"
                    onClick={s.generate}
                    disabled={!hasLand}
                  >
                    <WandSparkles size={15} />
                    从色块生成地图
                  </button>
                  <p className="studio-empty-sketch">
                    {hasLand
                      ? `已有 ${visibleRegions.length} 片色块，现在就能生成。蓝色可挖出湖泊与海湾。`
                      : '点「画陆地」，然后在画布上拖动。无需把每处细节画完整。'}
                  </p>
                </>
              ) : (
                <>
                  <div className="studio-preview-switch" aria-label="地图预览模式">
                    <button aria-pressed={s.sourcePreview} onClick={() => s.setSourcePreview(true)}>
                      色块草稿
                    </button>
                    <button
                      aria-pressed={!s.sourcePreview}
                      onClick={() => s.setSourcePreview(false)}
                    >
                      生成预览
                    </button>
                  </div>
                  <p>
                    {s.sourcePreview
                      ? '直接修改原始色块，完成后点「生成预览」查看结果。切换视图不会改变地图。'
                      : randomSource
                        ? '以随机地势为基础，地形与海拔修改共同影响地图。已保存的地图不会因程序更新而重新生成。'
                        : s.elevationSettings
                          ? `结合 ${visibleRegions.length} 片色块与海拔生成。继续涂画或编辑海拔都会更新同一张地图。`
                          : `按 ${visibleRegions.length} 片色块生成。继续涂画会更新地图；改地形可先切到「色块草稿」。`}
                  </p>
                  {terrainPending && !s.sourcePreview && (
                    <div className="studio-generation-progress" role="status">
                      <LoaderCircle size={16} aria-hidden="true" />
                      <span>
                        正在整理地形、水系与道路…<small>可继续画色块，完成后会显示最新结果。</small>
                      </span>
                    </div>
                  )}
                  {terrainError && (
                    <div className="studio-generation-error" role="alert">
                      <strong>这次预览没有完成</strong>
                      <p>{terrainError}</p>
                      <p>原始色块仍保留，可撤销最近修改，或降低细节等级后重试。</p>
                    </div>
                  )}
                  <button
                    className="btn studio-full"
                    onClick={s.varyGeneration}
                    disabled={terrainPending}
                    title="使用新版生成器，保留色块位置，重新安排地形细节、水系与聚落"
                  >
                    {organicLinework ? '换一个生成变体' : '重新生成（新版）'}
                  </button>
                  <p className="studio-generation-reassurance">
                    {organicLinework
                      ? '保留色块位置；变体、选项和升级均可用画布上方「撤销」恢复。'
                      : '重新生成会启用新版曲线并更换种子，保留色块与人工内容；可撤销。'}
                  </p>
                  {legacyGeneration && (
                    <div className="studio-legacy-generation">
                      <p>
                        当前保留旧版生成。升级后可使用更细的地形和 14
                        类地貌，画面会重新生成；可撤销恢复。
                      </p>
                      <button className="btn primary studio-full" onClick={s.upgradeGeneration}>
                        升级精细生成
                      </button>
                    </div>
                  )}
                  {s.editor.generation.version === 2 && !organicLinework && (
                    <div className="studio-legacy-generation">
                      <p>这张图保留了原来的河道与路网线形。柔化后会重新计算曲线，可撤销对比。</p>
                      <button
                        className="btn primary studio-full"
                        disabled={terrainPending}
                        onClick={() => {
                          s.generationOptions({ linework: 'organic' });
                          s.setSourcePreview(false);
                          s.setNotice('已启用柔和曲线。可撤销对比原画面。');
                        }}
                      >
                        柔化河流与道路
                      </button>
                    </div>
                  )}
                </>
              )}
              <details className="studio-generation-options">
                <summary>气候与生成选项</summary>
                {s.generationSettings.version === 2 && (
                  <>
                    <label className="studio-field">
                      地形细节
                      <select
                        aria-label="生成细节等级"
                        value={s.generationSettings.detail}
                        onChange={(e) =>
                          s.generationOptions({ detail: e.target.value as SketchGenerationDetail })
                        }
                      >
                        {generationDetailCatalog.map((detail) => (
                          <option key={detail.id} value={detail.id}>
                            {detail.label} · 长边{' '}
                            {map.scaleKm === undefined
                              ? detail.samples
                              : Math.round(
                                  Math.min(
                                    512,
                                    detail.samples *
                                      Math.max(
                                        1,
                                        Math.sqrt(Math.max(map.width, map.height) / 1000),
                                      ),
                                  ),
                                )}{' '}
                            格
                          </option>
                        ))}
                      </select>
                    </label>
                    <p>
                      更高采样精度保留更细的海岸与地形，生成耗时也会增加。导出仍为可缩放的 SVG
                      矢量图。
                    </p>
                  </>
                )}
                <label className="studio-field">
                  生成气候
                  <select
                    value={s.generationSettings.climate}
                    onChange={(e) =>
                      s.generationOptions({
                        climate: e.target.value as SketchGenerationSettings['climate'],
                      })
                    }
                  >
                    <option value="temperate">温和 · 林地与草原</option>
                    <option value="dry">干燥 · 稀疏植被</option>
                    <option value="cold">
                      寒冷 · {legacyGeneration ? '林地与积雪' : '针叶林与苔原'}
                    </option>
                  </select>
                </label>
                {s.generationSettings.version === 1 && (
                  <label className="studio-field">
                    聚落数量上限 · {s.generationSettings.settlements}
                    <input
                      aria-label="自动聚落数量"
                      type="range"
                      min="0"
                      max="12"
                      step="1"
                      value={s.generationSettings.settlements}
                      onChange={(e) => s.generationOptions({ settlements: Number(e.target.value) })}
                    />
                  </label>
                )}
                <label className="studio-check">
                  <input
                    type="checkbox"
                    checked={s.generationSettings.rivers}
                    onChange={(e) => s.generationOptions({ rivers: e.target.checked })}
                  />
                  自动生成河流
                </label>
                <label className="studio-check">
                  <input
                    type="checkbox"
                    checked={s.generationSettings.routes}
                    onChange={(e) => s.generationOptions({ routes: e.target.checked })}
                  />
                  连接聚落道路
                </label>
                <NumberField
                  label="地图生成种子"
                  min={0}
                  max={4294967295}
                  value={s.generationSettings.seed}
                  onChange={(seed) => s.generationOptions({ seed: Math.round(seed) })}
                />
                <p>河流和聚落依据地形选址，空间不足时会少于设置数量。</p>
                {s.editor.generation && (
                  <>
                    <button className="btn studio-full" onClick={s.stopGeneration}>
                      {s.elevationSettings ? '移除海拔配方并停止' : '停止自动生成'}
                    </button>
                    {s.elevationSettings && (
                      <p>此操作同时移除海拔笔划，可立即撤销；要保留当前画面，请先转为组件。</p>
                    )}
                  </>
                )}
              </details>
            </section>
          )}
          {prioritizeSelection && selectionPanel}
          {mode !== 'detail' ? (
            <>
              <div className="studio-section-heading">
                地形色板<span>{mode === 'sketch' ? '4 色表达地形意图' : '14 类自然地貌'}</span>
              </div>
              <div className="studio-biomes">
                {biomeCatalog
                  .filter(
                    (b) =>
                      mode !== 'sketch' || ['grass', 'water', 'forest', 'mountain'].includes(b.id),
                  )
                  .map((b) => (
                    <button
                      key={b.id}
                      className={s.biome === b.id && tool === 'terrain' ? 'active' : ''}
                      aria-pressed={s.biome === b.id && tool === 'terrain'}
                      disabled={!biomeAvailable(b.id)}
                      title={biomeAvailable(b.id) ? brushPresets[b.id].hint : '升级精细生成后可用'}
                      onClick={() => {
                        s.chooseBiome(b.id);
                        setTool('terrain');
                      }}
                    >
                      <i style={{ background: b.color }} />
                      <span>{b.label}</span>
                    </button>
                  ))}
              </div>
              {mode === 'sketch' && (
                <button
                  className="btn studio-full studio-more-biomes"
                  onClick={() => s.mode('sculpt')}
                >
                  更多地貌与智能笔刷
                </button>
              )}
              {mode === 'sculpt' && legacyGeneration && (
                <p className="studio-compatibility-note">新增地貌需先点击上方「升级精细生成」。</p>
              )}
              <p className="studio-brush-hint">{brushPresets[s.biome].hint}</p>
              <label className="studio-field">
                地形笔刷 · {s.radius}
                <input
                  aria-label="地形笔刷大小"
                  type="range"
                  min="5"
                  max="500"
                  step="5"
                  value={s.radius}
                  onChange={(e) => s.setRadius(Number(e.target.value))}
                />
              </label>
              {mode === 'sculpt' && (
                <>
                  <div className="studio-tool-grid">
                    <ToolButton id="terrain" {...{ tool, setTool }} />
                    <ToolButton id="area" {...{ tool, setTool }} />
                    <ToolButton id="select" {...{ tool, setTool }} />
                    <ToolButton id="sampler" {...{ tool, setTool }} />
                  </div>
                  <label className="studio-field">
                    组件密度 · {Math.round(s.density * 100)}%
                    <input
                      aria-label="生成密度"
                      type="range"
                      min="0"
                      max="1"
                      step=".05"
                      value={s.density}
                      onChange={(e) => s.setDensity(Number(e.target.value))}
                    />
                  </label>
                  <label className="studio-field">
                    边缘起伏 · {Math.round(s.roughness * 100)}%
                    <input
                      aria-label="边缘起伏"
                      type="range"
                      min="0"
                      max="1"
                      step=".05"
                      value={s.roughness}
                      onChange={(e) => s.setRoughness(Number(e.target.value))}
                    />
                  </label>
                </>
              )}
              <button
                className="btn studio-full"
                onClick={() => s.setFreshConfirm(!s.freshConfirm)}
              >
                从纯色底图开始绘制
              </button>
              {s.freshConfirm && (
                <div className="studio-confirm">
                  <p>关闭原随机底图，保留自绘区域、组件和标记。可以撤销。</p>
                  <button className="btn primary" onClick={s.fresh}>
                    开始色刷绘制
                  </button>
                  <button className="btn" onClick={() => s.setFreshConfirm(false)}>
                    取消
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="studio-tool-grid">
                {(
                  [
                    'select',
                    'nodes',
                    'path',
                    'polygon',
                    'rectangle',
                    'ellipse',
                    'text',
                    'brush',
                    'road',
                    'river',
                  ] as StudioTool[]
                ).map((id) => (
                  <ToolButton key={id} {...{ id, tool, setTool }} />
                ))}
              </div>
              <label className="studio-check">
                <input
                  type="checkbox"
                  checked={s.snap}
                  onChange={(e) => s.setSnap(e.target.checked)}
                />
                吸附至 10 单位网格
              </label>
              {(s.editor.baseVisible ||
                s.editor.generation ||
                s.editor.regions.length > 0 ||
                map.strokes.length > 0) && (
                <>
                  <button
                    className="btn studio-full"
                    onClick={() => s.setBakeConfirm(!s.bakeConfirm)}
                  >
                    <PencilRuler size={15} />
                    将生成图转为可编辑组件
                  </button>
                  {s.bakeConfirm && (
                    <div className="studio-confirm">
                      <p>
                        把当前地形与笔画转换为独立形状和符号，停止它们的自动生成。标记不变，转换可以撤销。
                        {s.elevationSettings &&
                          '转换会固定地形视图的完整地图并移除海拔配方，之后不能再用海拔笔刷修改这些图形；如需保存海拔视图，请先导出 SVG。'}
                      </p>
                      <button className="btn primary" onClick={s.bake}>
                        转换并精修
                      </button>
                      <button className="btn" onClick={() => s.setBakeConfirm(false)}>
                        取消
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {isPolygon && (
            <div className="studio-confirm">
              <p>依次点击画布添加顶点，当前 {s.vertices.length} 点。</p>
              <button
                className="btn primary"
                disabled={s.vertices.length < (tool === 'path' ? 2 : 3)}
                onClick={s.finish}
              >
                完成{tool === 'path' ? '路径' : '轮廓'}
              </button>
              <button className="btn" onClick={s.cancel}>
                取消绘制
              </button>
            </div>
          )}
          {mode !== 'sketch' && (
            <>
              <details className="studio-library">
                <summary>
                  组件库 <span>{symbolCatalog.length} 种矢量组件</span>
                </summary>
                <label className="studio-field">
                  搜索组件
                  <input
                    aria-label="搜索地图组件"
                    value={symbolFilter}
                    placeholder="旅店、法师塔、矿井…"
                    onChange={(e) => setSymbolFilter(e.target.value)}
                  />
                </label>
                <div className="studio-symbol-categories" aria-label="组件分类">
                  <button
                    aria-pressed={symbolCategory === 'all'}
                    className={symbolCategory === 'all' ? 'active' : ''}
                    onClick={() => setSymbolCategory('all')}
                  >
                    全部
                  </button>
                  {Object.entries(symbolCategories).map(([id, label]) => (
                    <button
                      key={id}
                      aria-pressed={symbolCategory === id}
                      className={symbolCategory === id ? 'active' : ''}
                      onClick={() => setSymbolCategory(id as SymbolCategory)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="studio-symbols">
                  {symbols.map((sym) => (
                    <button
                      key={sym.id}
                      title={sym.label}
                      aria-label={`放置${sym.label}`}
                      aria-pressed={
                        s.symbol === sym.id && (tool === 'symbol' || tool === 'cluster')
                      }
                      className={
                        s.symbol === sym.id && (tool === 'symbol' || tool === 'cluster')
                          ? 'active'
                          : ''
                      }
                      onClick={() => {
                        s.setSymbol(sym.id);
                        s.setColor(sym.color);
                        setTool('symbol');
                      }}
                    >
                      <svg
                        viewBox="-24 -24 48 48"
                        fill={sym.color}
                        stroke="#4e6654"
                        strokeWidth="1.2"
                      >
                        <MapGlyph kind={sym.id} />
                      </svg>
                      <small>{sym.label}</small>
                    </button>
                  ))}
                </div>
                {!symbols.length && (
                  <p className="studio-footnote">没有找到组件，试试其他关键词或分类。</p>
                )}
                {mode === 'sculpt' && (
                  <div className="studio-tool-grid">
                    <ToolButton id="symbol" {...{ tool, setTool }} />
                    <ToolButton id="cluster" {...{ tool, setTool }} />
                  </div>
                )}
                <NumberField
                  label="新组件尺寸"
                  value={s.size}
                  min={8}
                  max={240}
                  onChange={s.setSize}
                />
              </details>
              <div className="studio-color-row">
                <label>
                  绘制颜色
                  <input
                    aria-label="新形状与组件颜色"
                    type="color"
                    value={s.color}
                    onChange={(e) => s.setColor(e.target.value)}
                  />
                </label>
              </div>
              {tool === 'text' && (
                <label className="studio-field">
                  标签文字
                  <input
                    maxLength={240}
                    value={s.label}
                    onChange={(e) => s.setLabel(e.target.value)}
                  />
                  <small>填写后点击画布放置</small>
                </label>
              )}
            </>
          )}
          {!prioritizeSelection && selectionPanel}
          {mode !== 'sketch' && (
            <details className="studio-library">
              <summary>
                图层与对象 <span>{listed.length} 项</span>
              </summary>
              <input
                aria-label="筛选地图对象"
                placeholder="按名称筛选…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <div className="studio-object-list">
                {listed.slice(0, 70).map((o) => (
                  <button
                    key={o.id}
                    className={s.selected?.id === o.id ? 'active' : ''}
                    onClick={() => {
                      s.setSelected({ type: o.category, id: o.id });
                      s.setVertex(0);
                      setTool('select');
                    }}
                  >
                    <span>
                      {o.category === 'region' ? '地形' : '组件'} · {o.name || '未命名'}
                    </span>
                    {o.locked && <LockKeyhole size={12} />} {!o.visible && <EyeOff size={12} />}
                  </button>
                ))}
              </div>
              {listed.length > 70 && <small>显示前 70 项，请输入名称筛选。</small>}
            </details>
          )}
        </div>
      )}
      <p className="studio-footnote">切换视图或级别会保留内容。绘制、移动与属性修改均可撤销。</p>
    </div>
  );
}

export function StudioOverlay({
  studio: s,
  tool,
  zoom,
}: {
  studio: MapStudio;
  tool: StudioTool;
  zoom: number;
}) {
  const selected = s.draftObject?.id === s.selectedObject?.id ? s.draftObject : s.selectedObject;
  const points = selected?.points || [];
  return (
    <g data-editor-overlay="true">
      {s.draftObject && !s.editor.objects.some((o) => o.id === s.draftObject!.id) && (
        <MapObjectArtwork object={s.draftObject} />
      )}
      {s.vertices.length > 0 && (
        <>
          <path
            d={linePath(s.vertices, tool !== 'path')}
            fill={tool === 'path' ? 'none' : '#6b986133'}
            stroke="#376c51"
            strokeWidth={1.5 / zoom}
            strokeDasharray="4 4"
            pointerEvents="none"
          />
          {s.vertices.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={3 / zoom}
              fill="#fff"
              stroke="#376c51"
              pointerEvents="none"
            />
          ))}
        </>
      )}
      {selected && selected.visible && (
        <>
          <rect
            x={Math.min(...points.map((p) => p.x)) - 8}
            y={Math.min(...points.map((p) => p.y)) - 8}
            width={Math.max(
              16,
              Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)) + 16,
            )}
            height={Math.max(
              16,
              Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)) + 16,
            )}
            fill="none"
            stroke="#a7853f"
            strokeWidth={1 / zoom}
            strokeDasharray="5 4"
            pointerEvents="none"
          />
          {tool === 'nodes' &&
            !selected.locked &&
            points.map((p, i) => (
              <circle
                key={i}
                data-map-vertex={i}
                cx={p.x}
                cy={p.y}
                r={(s.vertex === i ? 5 : 3.5) / zoom}
                fill={s.vertex === i ? '#a7853f' : '#fffef7'}
                stroke="#526e54"
                strokeWidth={1 / zoom}
                className="studio-vertex"
              />
            ))}
        </>
      )}
    </g>
  );
}
