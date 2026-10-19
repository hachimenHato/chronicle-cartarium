import { useEffect, useState } from 'react';
import type { AtlasMap } from '../../shared/model';
import { formatDistance, mapCoverageKm, mapSizePresets, resizeMap } from '../lib/map-scale';

export interface MapDimensions {
  width: number;
  height: number;
  scaleKm: number;
}
export function MapSizeFields({
  value,
  onChange,
}: {
  value: MapDimensions;
  onChange: (v: MapDimensions) => void;
}) {
  return (
    <div className="map-size-fields">
      <div className="map-size-grid">
        <label className="atlas-label">
          画布宽度
          <input
            className="field"
            type="number"
            min="100"
            max="10000"
            step="1"
            required
            value={value.width || ''}
            onChange={(e) => onChange({ ...value, width: Number(e.target.value) })}
          />
        </label>
        <label className="atlas-label">
          画布高度
          <input
            className="field"
            type="number"
            min="100"
            max="10000"
            step="1"
            required
            value={value.height || ''}
            onChange={(e) => onChange({ ...value, height: Number(e.target.value) })}
          />
        </label>
      </div>
      <label className="atlas-label">
        横向地理范围（km）
        <input
          className="field"
          type="number"
          min="0.01"
          max="1000000"
          step="any"
          required
          value={value.scaleKm || ''}
          onChange={(e) => onChange({ ...value, scaleKm: Number(e.target.value) })}
        />
      </label>
      <p className="atlas-subtle">
        纵向约{' '}
        {value.width > 0 ? formatDistance((value.scaleKm * value.height) / value.width) : '—'}
        。画布单位控制绘图空间，地理范围控制生成尺度和比例尺。
      </p>
    </div>
  );
}
export function MapDimensionsPanel({
  map,
  onResize,
}: {
  map: AtlasMap;
  onResize: (m: AtlasMap) => void;
}) {
  const [value, setValue] = useState({
    width: map.width,
    height: map.height,
    scaleKm: mapCoverageKm(map),
  });
  const [error, setError] = useState('');
  useEffect(() => {
    setValue({ width: map.width, height: map.height, scaleKm: mapCoverageKm(map) });
    setError('');
  }, [map.id, map.width, map.height, map.scaleKm, map.kind]);
  return (
    <form
      className="map-dimensions-panel"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          onResize(resizeMap(map, value.width, value.height, value.scaleKm));
          setError('');
        } catch (reason) {
          setError((reason as Error).message);
        }
      }}
    >
      <div className="atlas-section-title">地图大小与范围</div>
      <div className="division-kind-tabs">
        {Object.entries(mapSizePresets).map(([kind, preset]) => (
          <button key={kind} type="button" onClick={() => setValue(preset)}>
            {({ world: '世界', region: '区域', town: '城镇' } as Record<string, string>)[kind]}预设
          </button>
        ))}
      </div>
      <MapSizeFields value={value} onChange={setValue} />
      {map.scaleKm === undefined && (
        <p className="atlas-subtle">
          此旧地图尚未设定地理范围，比例尺和新版生成细节按地图类型估算。
        </p>
      )}
      {map.editor?.generation?.version === 1 && (
        <p className="atlas-subtle">
          此图使用旧版生成。范围会保存；在创作工具重新生成（新版）后，地形生成才会读取范围。
        </p>
      )}
      <p className="atlas-subtle">
        范围越大，山峰越小越密，河流支流与道路越多、线条越细；范围越小则相反。填写的横向范围优先于地图类型预设。
      </p>
      <p className="atlas-subtle">
        应用后已有地形、笔迹、分区和标记按宽高比例适配新画布；改变宽高比例会拉伸形状，生成内容重新计算。可撤销。
      </p>
      {error && <p role="alert">{error}</p>}
      <button className="btn" type="submit">
        应用地图大小
      </button>
    </form>
  );
}
