import { useMemo, useState } from 'react';
import { Download, FileDown } from 'lucide-react';
import type { Workspace } from '../../shared/model';
import { Modal } from './Common';
import { downloadFile, request } from '../lib/api';
import { getEntityTypeLabel } from '../../shared/entity-types';
import { exportMarkdown, type ExportOptions } from '../lib/export';
export default function ExportDialog({
  data,
  worldId,
  onClose,
}: {
  data: Workspace;
  worldId: string;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<ExportOptions>({
    worldId,
    entityIds: data.entities.filter((e) => e.worldId === worldId).map((e) => e.id),
    includeMaps: true,
    includeRelations: true,
    includePlots: true,
    includeSessions: true,
    includeSecrets: true,
  });
  const entities = data.entities.filter((e) => e.worldId === worldId);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const world = data.worlds.find((w) => w.id === worldId);
  const markdown = useMemo(() => exportMarkdown(data, options), [data, options]);
  const update = (patch: Partial<ExportOptions>) => setOptions((v) => ({ ...v, ...patch }));
  return (
    <Modal title="导出你的世界" onClose={onClose} wide>
      <div className="export-layout">
        <div>
          <div className="export-format">
            <FileDown size={25} />
            <div>
              <strong>Markdown 文档</strong>
              <small>用于归档、分享或继续创作</small>
            </div>
            <span className="badge">.md</span>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={options.includeSecrets}
              onChange={(e) => update({ includeSecrets: e.target.checked })}
            />
            <span>
              <strong>包含 GM 秘密</strong>
              <small>关闭后排除私密条目、地图、关系、剧情与日志。仅导出账户获准查看的内容。</small>
            </span>
          </label>
          <div className="section-top">
            <h4>导出内容</h4>
            <button
              className="text-btn"
              onClick={() =>
                update({
                  entityIds:
                    options.entityIds.length === entities.length ? [] : entities.map((e) => e.id),
                })
              }
            >
              {options.entityIds.length === entities.length ? '取消全选' : '全选'}
            </button>
          </div>
          <div className="export-entities">
            {entities.map((e) => (
              <label className="check-row compact" key={e.id}>
                <input
                  type="checkbox"
                  checked={options.entityIds.includes(e.id)}
                  disabled={!options.includeSecrets && e.visibility === 'gm'}
                  onChange={(ev) =>
                    update({
                      entityIds: ev.target.checked
                        ? [...options.entityIds, e.id]
                        : options.entityIds.filter((id) => id !== e.id),
                    })
                  }
                />
                <span>
                  {e.name}
                  <small>
                    {getEntityTypeLabel(world, e.type)}
                    {e.visibility === 'gm' ? ' · GM' : ''}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <div className="export-options">
            {(
              [
                ['includeMaps', '地图与注记'],
                ['includeRelations', '人物关系'],
                ['includePlots', '剧情路线与变量'],
                ['includeSessions', '团务日志'],
              ] as const
            ).map(([key, label]) => (
              <label className="check-row compact" key={key}>
                <input
                  type="checkbox"
                  checked={options[key]}
                  disabled={
                    !options.includeSecrets && (key === 'includePlots' || key === 'includeSessions')
                  }
                  onChange={(e) => update({ [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="export-preview">
          <div className="section-top">
            <h4>文档预览</h4>
            <span className="muted">{markdown.length.toLocaleString()} 字符</span>
          </div>
          <pre>{markdown}</pre>
        </div>
      </div>
      <div className="modal-actions export-footer">
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <span className="muted">地图导出为种子、层级与标记清单；立绘保留资源链接。</span>
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const result = await request<{ markdown: string }>('/api/export', {
                method: 'POST',
                body: JSON.stringify(options),
              });
              downloadFile(
                `${data.worlds.find((w) => w.id === worldId)?.name || '世界'}-设定集.md`,
                result.markdown,
              );
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download size={16} /> {busy ? '正在导出…' : '下载 Markdown'}
        </button>
      </div>
    </Modal>
  );
}
