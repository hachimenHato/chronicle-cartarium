import { useEffect, useId, useState } from 'react';
import { biomeCatalog } from '../../shared/cartography';
import type { WorldExtent } from '../../shared/world-extent';
import { createClimatePreview, type ClimatePreviewOptions } from '../lib/world-climate-preview';
import { terrainLayerColors, climateValueColor } from '../lib/thematic-colors';

type Preview = ReturnType<typeof createClimatePreview>;
export function GlobeClimatePreview({
  extent,
  options,
}: {
  extent: WorldExtent;
  options: ClimatePreviewOptions;
}) {
  const [preview, setPreview] = useState<Preview>();
  const [pending, setPending] = useState(true),
    [error, setError] = useState(false);
  const [layer, setLayer] = useState<'biome' | 'temperature' | 'precipitation'>('biome');
  const blurId = `climate-${useId().replaceAll(':', '')}`;
  const key = JSON.stringify({ ...options, elevation: undefined, extent });
  useEffect(() => {
    setPending(true);
    setError(false);
    const timer = window.setTimeout(() => {
      try {
        setPreview(createClimatePreview(extent, options));
      } catch {
        setError(true);
      }
      setPending(false);
    }, 180);
    return () => window.clearTimeout(timer);
    // Scalars are represented in key; elevation uses immutable snapshot identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, options.elevation]);
  return (
    <section className="globe-climate" aria-label="选区气候与生态预览" aria-busy={pending}>
      <div className="globe-climate-heading">
        <strong>选区环境预览</strong>
        <small role="status">{pending ? '正在计算…' : error ? '暂时无法计算' : '年均近似'}</small>
      </div>
      <div className="globe-preview-tabs" role="group" aria-label="预览内容">
        {(
          [
            ['biome', '生态'],
            ['temperature', '气温'],
            ['precipitation', '降水'],
          ] as const
        ).map(([id, label]) => (
          <button type="button" key={id} aria-pressed={layer === id} onClick={() => setLayer(id)}>
            {label}
          </button>
        ))}
      </div>
      {error && <p role="alert">请检查地图尺寸与气候参数后重试。</p>}
      {preview && !error && (
        <div className="globe-preview-body">
          <svg
            role="img"
            aria-label={`选区${layer === 'biome' ? '生态' : layer === 'temperature' ? '气温' : '降水'}预览图`}
            viewBox={`0 0 ${preview.columns} ${preview.rows}`}
            preserveAspectRatio="xMidYMid meet"
            data-climate-preview={layer}
            style={{ aspectRatio: `${preview.columns} / ${preview.rows}` }}
          >
            <defs>
              <filter id={blurId} x="0" y="0" width="100%" height="100%">
                <feGaussianBlur stdDeviation=".32" />
              </filter>
            </defs>
            <g filter={`url(#${blurId})`}>
              {preview.cells.map((c, i) => (
                <rect
                  key={i}
                  x={i % preview.columns}
                  y={Math.floor(i / preview.columns)}
                  width="1.02"
                  height="1.02"
                  fill={
                    layer === 'biome'
                      ? terrainLayerColors[c.biome]
                      : layer === 'temperature'
                        ? climateValueColor(c.temperature, 'temperature')
                        : climateValueColor(c.precipitation, 'precipitation')
                  }
                />
              ))}
            </g>
          </svg>
          <div className={`globe-preview-key ${layer}`}>
            <span>
              {layer === 'biome'
                ? '蓝色为水域'
                : layer === 'temperature'
                  ? '寒冷 −25℃'
                  : '干燥 0 mm'}
            </span>
            <span>
              {layer === 'biome'
                ? '陆地按生态着色'
                : layer === 'temperature'
                  ? '炎热 40+℃'
                  : '极湿 6500+ mm'}
            </span>
          </div>
          <dl>
            <div>
              <dt>陆地年均气温</dt>
              <dd data-preview-temperature={preview.temperature.mean.toFixed(2)}>
                {preview.temperature.mean.toFixed(1)} ℃{' '}
                <small>
                  （{preview.temperature.min.toFixed(0)}～{preview.temperature.max.toFixed(0)} ℃）
                </small>
              </dd>
            </div>
            <div>
              <dt>陆地年降水</dt>
              <dd data-preview-rainfall={preview.precipitation.mean.toFixed(2)}>
                {Math.round(preview.precipitation.mean)} mm{' '}
                <small>
                  （{Math.round(preview.precipitation.min)}～{Math.round(preview.precipitation.max)}{' '}
                  mm）
                </small>
              </dd>
            </div>
          </dl>
          <div className="globe-biomes">
            {preview.biomes.map((b) => (
              <span key={b.biome}>
                <i style={{ background: terrainLayerColors[b.biome] }} />
                {biomeCatalog.find((c) => c.id === b.biome)?.label} {Math.round(b.share * 100)}%
              </span>
            ))}
          </div>
          {!preview.biomes.length && <p>当前预览范围没有陆地，以上数值为水面气候。</p>}
        </div>
      )}
      <p>
        {options.elevation
          ? '依据当前地图地形粗采样，使用本次选区与气候参数重算。'
          : '依据当前种子与地图尺度估算潜在地形；色块、海拔编辑及最终精细地形会改变局部结果。'}
        纬度、海拔、海岸距离、风向及山地雨影共同参与。应用范围后会影响实际生成；这不是气象预测。
      </p>
    </section>
  );
}
