import { memo, useMemo } from 'react';
import { Info } from 'lucide-react';
import type { GeneratedGeography } from '../../shared/geography';
import type { GeographicLayer } from '../../shared/map-layers';
import { climateColorScales } from '../lib/thematic-colors';
import './ClimateLayerGuide.css';

/** Explains the saved layer; current form settings must never be passed off as stored results. */
export const ClimateLayerGuide = memo(function ClimateLayerGuide({
  geography,
  layer,
}: {
  geography?: GeneratedGeography;
  layer: GeographicLayer;
}) {
  const climate = layer === 'temperature' || layer === 'precipitation' ? layer : undefined;
  const stats = useMemo(() => {
    if (!geography || !climate) return undefined;
    const values = geography.cells
      .filter((c) => c.land && Number.isFinite(c[climate]))
      .map((c) => c[climate]);
    if (!values.length) return undefined;
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    };
  }, [geography, climate]);
  if (!climate || !geography) return null;
  const temperature = climate === 'temperature';
  const format = (n: number) => (temperature ? n.toFixed(1) : String(Math.round(n)));
  const unit = temperature ? '℃' : 'mm／年';
  return (
    <section
      className="climate-layer-guide"
      aria-label={temperature ? '气温图层说明' : '降水图层说明'}
      data-climate-guide={climate}
    >
      <div className="climate-guide-heading">
        <Info size={16} aria-hidden="true" />
        <strong>{temperature ? '陆地年均气温' : '陆地年降水量'}</strong>
        <span>读取已保存地图</span>
      </div>
      {stats ? (
        <p className="climate-guide-values">
          <span>
            范围{' '}
            <b>
              {format(stats.min)}～{format(stats.max)}
            </b>{' '}
            {unit}
          </span>
          <span>
            单元采样均值 <b>{format(stats.mean)}</b> {unit}
          </span>
        </p>
      ) : (
        <p className="climate-guide-values">当前地图没有陆地气候采样。</p>
      )}
      <div className="climate-guide-stops" aria-label="固定数值色阶">
        {climateColorScales[climate].map((stop) => (
          <span key={stop.value}>
            <i style={{ background: stop.color }} aria-hidden="true" />
            <small>
              {stop.label}
              {temperature ? '' : ' mm'}
            </small>
          </span>
        ))}
      </div>
      <details>
        <summary>计算依据与使用说明</summary>
        <p>
          {temperature
            ? '从赤道海平面年均温出发，绝对纬度越高、海拔越高，年均温通常越低；海拔每升高 1000 米，年均温约降低 6.5℃。浅色为温和气候，砖红色才表示较炎热。'
            : '纬度雨带、海洋蒸发水汽、风向和地形共同作用：迎风坡通常多雨，背风坡及大陆深处较干。黄褐表示少雨，绿蓝表示湿润，不会为了增加颜色而自动拉伸本图数值。'}
        </p>
        <p>
          这是创作用的年均近似，不包含完整季风、洋流和季节天气模拟。色阶在各张地图之间固定可比；旧地图保留原计算结果，修改气候参数后需明确重新生成才会重算。
        </p>
      </details>
    </section>
  );
});
