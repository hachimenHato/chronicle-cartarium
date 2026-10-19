import { useEffect, useRef, useState } from 'react';
import { Brush, Dice5, ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';
import {
  colorBlockPalette,
  importColorBlockImage,
  type ColorBlockImportResult,
  type ColorBlockResolution,
} from '../lib/color-block-import';
import './MapCreationSource.css';
import type { SketchShapeMode } from '../../shared/geography';
import { SketchModeControl } from './SketchModeControl';
import { GlobeExtentPicker } from './GlobeExtentPicker';
import { globalWorldExtent, type WorldExtent } from '../../shared/world-extent';
import type { AtlasMap } from '../../shared/model';

export interface MapCreationSourceValue {
  source: 'random' | 'sketch';
  seed: string;
  preset: 'continent' | 'archipelago' | 'highlands';
  sketchMode: SketchShapeMode;
  extent?: WorldExtent;
  image?: ColorBlockImportResult;
  imageName?: string;
  busy?: boolean;
}
export function freshMapCreationSource(): MapCreationSourceValue {
  return {
    source: 'random',
    seed: String(Math.floor(Math.random() * 4294967296)),
    preset: 'continent',
    sketchMode: 'balanced',
    extent: { ...globalWorldExtent },
  };
}

export function MapCreationSource({
  value,
  onChange,
  kind,
  width,
  height,
  scaleKm,
}: {
  value: MapCreationSourceValue;
  onChange: (value: MapCreationSourceValue) => void;
  kind?: AtlasMap['kind'];
  width?: number;
  height?: number;
  scaleKm?: number;
}) {
  const [resolution, setResolution] = useState<ColorBlockResolution>(40);
  const [error, setError] = useState('');
  const fileRef = useRef<File | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const serial = useRef(0);
  const current = useRef(value);
  current.current = value;
  useEffect(
    () => () => {
      serial.current++;
    },
    [],
  );
  async function readImage(file: File, detail: ColorBlockResolution) {
    const request = ++serial.current;
    setError('');
    onChange({ ...current.current, busy: true, image: undefined, imageName: file.name });
    try {
      const image = await importColorBlockImage(file, detail);
      if (request === serial.current)
        onChange({ ...current.current, image, imageName: file.name, busy: false });
    } catch (reason) {
      if (request === serial.current) {
        setError((reason as Error).message);
        onChange({ ...current.current, busy: false, image: undefined, imageName: undefined });
      }
    }
  }
  const clearImage = () => {
    serial.current++;
    fileRef.current = undefined;
    if (inputRef.current) inputRef.current.value = '';
    onChange({ ...value, image: undefined, imageName: undefined, busy: false });
    setError('');
  };
  return (
    <section className="map-creation-source" aria-label="地图生成来源">
      <fieldset className="map-source-options">
        <legend>创建方式</legend>
        {(
          [
            ['random', '完全随机', '从种子创建海陆、山川、气候与疆域', Dice5],
            ['sketch', '按照色块生成', '先画地形，或导入色块图片再细化', Brush],
          ] as const
        ).map(([source, label, description, Icon]) => (
          <label
            key={source}
            className={`map-source-option ${value.source === source ? 'active' : ''}`}
          >
            <input
              type="radio"
              aria-label={label}
              name="map-creation-source"
              value={source}
              checked={value.source === source}
              onChange={() => onChange({ ...value, source })}
            />
            <Icon size={20} aria-hidden="true" />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="atlas-label map-creation-seed">
        创建种子码
        <span>
          <input
            className="field"
            aria-label="创建种子码"
            inputMode="numeric"
            type="number"
            required
            min="0"
            max="4294967295"
            step="1"
            value={value.seed}
            onChange={(event) => onChange({ ...value, seed: event.target.value })}
          />
          <button
            className="icon-btn"
            type="button"
            title="随机种子码"
            onClick={() => onChange({ ...value, seed: freshMapCreationSource().seed })}
          >
            <Dice5 size={18} />
          </button>
        </span>
      </label>
      <p className="map-source-help">
        相同种子、地图大小与生成选项会得到相同结果。地图创建后仍可编辑。
      </p>
      <GlobeExtentPicker
        climate={{
          seed: Number(value.seed) || 0,
          preset: value.preset,
          source: value.source,
          kind,
          width,
          height,
          scaleKm,
        }}
        value={value.extent}
        onChange={(extent) => onChange({ ...value, extent })}
        disabled={value.busy}
      />
      {value.source === 'random' ? (
        <>
          <label className="atlas-label">
            陆地格局
            <select
              className="field"
              value={value.preset}
              onChange={(event) =>
                onChange({
                  ...value,
                  preset: event.target.value as MapCreationSourceValue['preset'],
                })
              }
            >
              <option value="continent">大陆与近海群岛</option>
              <option value="archipelago">破碎群岛</option>
              <option value="highlands">高地与山地</option>
            </select>
          </label>
          <p className="map-source-help">
            一起生成地形、海拔、板块、温度、降水与小区域，国家与文化边界共享区域边缘。
          </p>
        </>
      ) : (
        <>
          <SketchModeControl
            value={value.sketchMode}
            onChange={(sketchMode) => onChange({ ...value, sketchMode })}
          />
          <div className="map-color-import">
            <label className="atlas-label">
              <span>
                <ImagePlus size={16} />
                导入色块图片（可选）
              </span>
              <input
                ref={inputRef}
                aria-label="导入色块图片"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={value.busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  fileRef.current = file;
                  void readImage(file, resolution);
                }}
              />
            </label>
            <label className="atlas-label">
              色块解析精度
              <select
                className="field"
                value={resolution}
                disabled={value.busy}
                onChange={(event) => {
                  const detail = Number(event.target.value) as ColorBlockResolution;
                  setResolution(detail);
                  if (fileRef.current) void readImage(fileRef.current, detail);
                }}
              >
                <option value="24">简洁 · 24 格长边</option>
                <option value="40">标准 · 40 格长边</option>
                <option value="64">精细 · 64 格长边</option>
              </select>
            </label>
            <p className="map-source-help">
              PNG、JPG、WebP，最大 8
              MB。自动识别与下方色表相近的颜色，合并为可编辑区域；透明处视作水域。图片仅在本机解析。
            </p>
            {value.busy && (
              <p role="status" className="map-color-progress">
                <LoaderCircle size={16} className="spin" />
                正在识别色块…
              </p>
            )}
            {error && (
              <p role="alert" className="map-color-error">
                {error}
              </p>
            )}
            {value.image && (
              <div className="map-color-result" aria-label="色块识别预览">
                <svg
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label="解析后的地形色块"
                  style={{ aspectRatio: `${value.image.gridWidth}/${value.image.gridHeight}` }}
                >
                  {value.image.blocks.map((block, index) => (
                    <polygon
                      key={index}
                      points={block.points.map((point) => `${point.x},${point.y}`).join(' ')}
                      fill={colorBlockPalette.find((biome) => biome.id === block.biome)!.color}
                    />
                  ))}
                </svg>
                <span>
                  {value.imageName} · {value.image.blocks.length} 个可编辑色块 ·{' '}
                  {value.image.gridWidth} × {value.image.gridHeight} 格
                </span>
                {value.image.reduced && <small>已适当合并复杂细节，保持绘画流畅。</small>}
                <button type="button" className="btn small" onClick={clearImage}>
                  <Trash2 size={14} />
                  移除图片色块
                </button>
              </div>
            )}
          </div>
          <p className="map-source-help">
            不导入图片也可以创建空白色块画布。画几片陆地、森林与山地后，点击「生成预览」；生成前保持流畅的草稿模式。
          </p>
          <details className="map-color-palette" open>
            <summary>地形色表 · 14 种地形</summary>
            <p>使用这些颜色绘制图片可获得最准确的识别。十进制为 RGB 三通道及 24 位色值。</p>
            <div>
              {colorBlockPalette.map((biome) => (
                <div className="map-color-entry" key={biome.id}>
                  <span
                    className="map-color-chip"
                    style={{ background: biome.color }}
                    aria-hidden="true"
                  />
                  <span>
                    <strong>{biome.label}</strong>
                    <code>{biome.color.toUpperCase()}</code>
                    <small>
                      RGB {biome.rgb.join(', ')} · 十进制 {biome.decimal}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
