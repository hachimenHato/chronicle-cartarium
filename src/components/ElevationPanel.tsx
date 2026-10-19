import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  LoaderCircle,
  Mountain,
  RotateCcw,
  SlidersHorizontal,
  Waves,
} from 'lucide-react';
import type { ElevationSettings, ElevationStroke } from '../../shared/cartography';
import type { MapStudio, StudioTool } from './useMapStudio';

const presets: { id: ElevationSettings['preset']; label: string; caption: string }[] = [
  { id: 'sketch', label: '跟随色块', caption: '沿用色块轮廓，再雕刻局部起伏' },
  { id: 'continent', label: '大陆', caption: '连续大陆、低地与连绵山脉' },
  { id: 'archipelago', label: '群岛', caption: '破碎海岸与大小岛屿' },
  { id: 'highlands', label: '高地', caption: '广阔高原与深浅山谷' },
];
const brushes = [
  { id: 'raise', label: '抬高', caption: '堆起丘陵与山脊', Icon: ArrowUp },
  { id: 'lower', label: '降低', caption: '开出山谷与海湾', Icon: ArrowDown },
  { id: 'flatten', label: '定高', caption: '渐变到目标海拔', Icon: SlidersHorizontal },
  { id: 'smooth', label: '平滑', caption: '柔化相邻的高低差', Icon: Waves },
] as const;

/** Commit recipe sliders on release/keyboard completion, not on every preview tick. */
function RecipeRange({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);
  useEffect(() => {
    setDraft(value);
    committed.current = value;
  }, [value]);
  const commit = () => {
    if (draft !== committed.current) {
      committed.current = draft;
      onChange(draft);
    }
  };
  return (
    <label className="studio-field">
      <span>
        {label}
        <output>
          {draft}
          {suffix}
        </output>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
  );
}

function ElevationNumber({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="studio-field">
      {label}
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const number = Number(draft);
          if (draft.trim() && Number.isInteger(number) && number >= min && number <= max) {
            if (number !== value) onChange(number);
          } else setDraft(String(value));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function ElevationPanel({
  studio: s,
  tool,
  mapId,
  pending,
  error = '',
}: {
  studio: MapStudio;
  tool: StudioTool;
  mapId: string;
  pending: boolean;
  error?: string;
}) {
  const settings = s.elevationSettings;
  const hasLand = s.editor.regions.some((region) => region.visible && region.biome !== 'water');
  const [preset, setPreset] = useState<ElevationSettings['preset']>(
    settings?.preset || (hasLand ? 'sketch' : 'continent'),
  );
  useEffect(
    () => setPreset(settings?.preset || (hasLand ? 'sketch' : 'continent')),
    [mapId, settings?.preset, hasLand],
  );
  const advanced = s.editor.mode !== 'sketch';
  const pointCount =
    settings?.strokes.reduce((total, stroke) => total + stroke.points.length, 0) || 0;
  const capacityReached = !!settings && (settings.strokes.length >= 96 || pointCount >= 8192);
  return (
    <section className="studio-elevation" aria-label="海拔地形生成与编辑">
      <div className="studio-elevation-heading">
        <Mountain size={19} />
        <strong>海拔与地势</strong>
        <span>{s.terrainView === 'elevation' ? '抬山与挖谷' : '地貌与起伏共同成图'}</span>
      </div>
      <p>地形色块决定地貌，海拔塑造起伏；两者共同生成海岸、山林、水系与道路。</p>
      <div className="studio-preview-switch" aria-label="地图视图">
        <button aria-pressed={s.terrainView === 'atlas'} onClick={() => s.setTerrainView('atlas')}>
          地形
        </button>
        <button
          aria-pressed={s.terrainView === 'elevation'}
          onClick={() => s.setTerrainView('elevation')}
        >
          海拔
        </button>
      </div>
      {s.terrainView === 'elevation' && (
        <div data-elevation-controls="true">
          <p>选择基础地势，再用笔刷抬山、挖谷。切回「地形」绘制地貌与查看完整地图。</p>
          {pending && (
            <div className="studio-generation-progress" role="status">
              <LoaderCircle size={16} aria-hidden="true" />
              <span>正在更新地势、水系与道路…</span>
            </div>
          )}
          {error && (
            <div className="studio-generation-error" role="alert">
              <strong>这次预览没有完成</strong>
              <p>{error}</p>
              <p>原始内容仍保留，可撤销最近修改后重试。</p>
            </div>
          )}
          <label className="studio-field">
            海拔模板
            <select
              aria-label="海拔模板"
              value={preset}
              disabled={pending}
              onChange={(event) => {
                const value = event.target.value as ElevationSettings['preset'];
                setPreset(value);
                if (settings) s.elevationOptions({ preset: value });
              }}
            >
              {presets.map((item) => (
                <option key={item.id} value={item.id} disabled={item.id === 'sketch' && !hasLand}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <p className="studio-elevation-caption">
            {presets.find((item) => item.id === preset)?.caption}。
            {settings ? '切换模板会保留已有海拔笔划和色块。' : '原有色块、手绘与标记继续保留。'}
          </p>
          {!settings ? (
            <>
              <button
                className="btn primary studio-full"
                disabled={pending}
                onClick={() => s.enableElevation(preset)}
              >
                <Mountain size={16} />
                {s.editor.generation?.version === 1
                  ? '升级并启用海拔'
                  : hasLand
                    ? '启用海拔编辑'
                    : '生成海拔地形'}
              </button>
              {s.editor.generation?.version === 1 && (
                <p>将使用新版重新计算地形和水系，可撤销回原画面。</p>
              )}
            </>
          ) : advanced ? (
            <>
              <div className="studio-elevation-tools" aria-label="海拔笔刷">
                {brushes.map(({ id, label, caption, Icon }) => (
                  <button
                    key={id}
                    className={tool === 'elevation' && s.elevationOperation === id ? 'active' : ''}
                    aria-label={`${label}海拔`}
                    aria-pressed={tool === 'elevation' && s.elevationOperation === id}
                    disabled={capacityReached}
                    onClick={() => s.chooseElevationBrush(id as ElevationStroke['operation'])}
                  >
                    <Icon size={17} />
                    <strong>{label}</strong>
                    <small>{caption}</small>
                  </button>
                ))}
              </div>
              <label className="studio-field">
                <span>
                  笔刷直径<output>{s.elevationWidth}</output>
                </span>
                <input
                  type="range"
                  aria-label="海拔笔刷直径"
                  min={5}
                  max={500}
                  step={5}
                  value={s.elevationWidth}
                  onChange={(event) => s.setElevationWidth(Number(event.target.value))}
                />
              </label>
              <label className="studio-field">
                <span>
                  笔刷强度<output>{Math.round(s.elevationStrength * 100)}%</output>
                </span>
                <input
                  type="range"
                  aria-label="海拔笔刷强度"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={s.elevationStrength}
                  onChange={(event) => s.setElevationStrength(Number(event.target.value))}
                />
              </label>
              {s.elevationOperation === 'flatten' && (
                <>
                  <ElevationNumber
                    label="目标海拔（米）"
                    value={s.elevationTarget}
                    min={-2000}
                    max={6000}
                    onChange={s.setElevationTarget}
                  />
                  <p>
                    按初始海平面定高；当前海平面偏移 {settings.seaLevel} 米，目标处相对海拔为{' '}
                    {s.elevationTarget - settings.seaLevel} 米。
                  </p>
                </>
              )}
              <p className="studio-elevation-hint">
                在地图上按住拖动。松开保存一笔，Esc 取消；[ / ] 调整大小。
                {s.elevationOperation === 'raise' || s.elevationOperation === 'lower'
                  ? '边缘柔和过渡，多画几笔可继续增减海拔。'
                  : '可重复轻刷，逐步塑形。'}
              </p>
              <details className="studio-generation-options">
                <summary>整体地势与海平面</summary>
                <RecipeRange
                  label="地势起伏"
                  value={settings.relief}
                  min={0.25}
                  max={2}
                  step={0.05}
                  suffix=" 倍"
                  onChange={(relief) => s.elevationOptions({ relief })}
                />
                <RecipeRange
                  label="海平面偏移"
                  value={settings.seaLevel}
                  min={-1000}
                  max={1000}
                  step={25}
                  suffix=" 米"
                  onChange={(seaLevel) => s.elevationOptions({ seaLevel })}
                />
                <p>抬高海平面会淹没低地；降低海平面会露出浅海。松开滑块后重算海岸、水系与聚落。</p>
                <ElevationNumber
                  label="海拔生成种子"
                  value={settings.seed}
                  min={0}
                  max={4294967295}
                  onChange={(seed) => s.elevationOptions({ seed })}
                />
                <button
                  className="btn studio-full"
                  disabled={pending}
                  onClick={() => s.elevationOptions({ seed: (settings.seed + 2654435761) >>> 0 })}
                >
                  换一种地势
                </button>
                <p>更换基础起伏，保留手绘海拔笔划；可撤销。</p>
              </details>
              <div className="studio-elevation-footer">
                <span>
                  {settings.strokes.length} / 96 笔 · {pointCount} / 8192 点
                </span>
                <button
                  className="text-btn"
                  disabled={!settings.strokes.length}
                  onClick={s.clearElevationStrokes}
                >
                  <RotateCcw size={13} />
                  清除海拔笔划
                </button>
              </div>
              {capacityReached && (
                <p role="status">
                  已达海拔编辑容量。可撤销或清除海拔笔划后重新雕刻，色块与其他内容不受影响。
                </p>
              )}
            </>
          ) : (
            <button
              className="btn studio-full"
              onClick={() => {
                s.mode('sculpt');
                s.chooseElevationBrush('raise');
              }}
            >
              编辑海拔起伏
            </button>
          )}
        </div>
      )}
    </section>
  );
}
