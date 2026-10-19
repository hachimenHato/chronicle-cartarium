import { useState } from 'react';
import { ImagePlus, LoaderCircle } from 'lucide-react';
import { Modal } from './Common';
import type { AtlasMap } from '../../shared/model';
import { mapSizePresets } from '../lib/map-scale';

export interface MapImageImportOptions {
  mode: 'new' | 'overlay';
  name: string;
  kind: AtlasMap['kind'];
  scaleKm: number;
}
export function MapImageImport({
  hasMap,
  onClose,
  onImport,
}: {
  hasMap: boolean;
  onClose: () => void;
  onImport: (file: File, options: MapImageImportOptions) => Promise<void>;
}) {
  const [file, setFile] = useState<File>();
  const [options, setOptions] = useState<MapImageImportOptions>({
    mode: 'new',
    name: '',
    kind: 'region',
    scaleKm: 400,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Modal
      title="导入地图图片"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="map-image-import"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file || busy) return;
          setBusy(true);
          setError('');
          try {
            await onImport(file, options);
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>支持 PNG、JPG、WebP，最大 8 MB。图片会原样导入，不会自动识别成可编辑地形。</p>
        <label className="atlas-label">
          地图图片
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required
            disabled={busy}
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              setFile(chosen);
              if (chosen)
                setOptions({ ...options, name: chosen.name.replace(/\.[^.]+$/, '').slice(0, 100) });
            }}
          />
        </label>
        <label className="atlas-label">
          导入方式
          <select
            value={options.mode}
            disabled={busy}
            onChange={(e) => setOptions({ ...options, mode: e.target.value as 'new' | 'overlay' })}
          >
            <option value="new">创建独立图片地图</option>
            <option value="overlay" disabled={!hasMap}>
              叠加到当前地图
            </option>
          </select>
        </label>
        <label className="atlas-label">
          图片地图名称
          <input
            className="field"
            value={options.name}
            required
            maxLength={100}
            disabled={busy}
            onChange={(e) => setOptions({ ...options, name: e.target.value })}
          />
        </label>
        {options.mode === 'new' && (
          <>
            <label className="atlas-label">
              地图尺度
              <select
                value={options.kind}
                disabled={busy}
                onChange={(e) => {
                  const kind = e.target.value as AtlasMap['kind'];
                  setOptions({ ...options, kind, scaleKm: mapSizePresets[kind].scaleKm });
                }}
              >
                <option value="world">世界地图</option>
                <option value="region">区域地图</option>
                <option value="town">城镇地图</option>
              </select>
            </label>
            <label className="atlas-label">
              横向地理范围（km）
              <input
                className="field"
                type="number"
                min="0.01"
                max="1000000"
                step="any"
                required
                value={options.scaleKm}
                disabled={busy}
                onChange={(e) => setOptions({ ...options, scaleKm: Number(e.target.value) })}
              />
            </label>
          </>
        )}
        <p className="atlas-subtle">
          默认锁定图片，避免误拖。在精细编辑的对象列表选中图片后可解锁，调整位置、宽高、旋转和透明度。SVG
          导出会嵌入图片；迁移备份还需包含 uploads 目录。
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="btn" type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="btn primary" type="submit" disabled={busy || !file}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <ImagePlus size={16} />}{' '}
            {busy ? '正在导入图片…' : '导入图片'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
