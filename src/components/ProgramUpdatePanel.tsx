import { useCallback, useEffect, useRef, useState } from 'react';
import { PackageCheck, RefreshCw, Upload } from 'lucide-react';
import type { ProgramUpdateStatus } from '../../shared/update';
import { request } from '../lib/api';
import { UPDATE_PACKAGE_EXTENSION } from '../../shared/branding';
export function ProgramUpdatePanel({ canUpdate }: { canUpdate: boolean }) {
  const [status, setStatus] = useState<ProgramUpdateStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    const next = await request<ProgramUpdateStatus>('/api/admin/updates');
    if (alive.current) setStatus(next);
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh().catch((e) => {
      if (alive.current) setError(e.message);
    });
    const timer = setInterval(() => void refresh().catch(() => undefined), 2000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [refresh]);
  async function importPackage(file: File) {
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const next = await request<ProgramUpdateStatus>('/api/admin/updates/package', {
        method: 'POST',
        body,
      });
      if (alive.current) setStatus(next);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  async function apply() {
    setBusy(true);
    setError('');
    try {
      const next = await request<ProgramUpdateStatus>('/api/admin/updates/apply', {
        method: 'POST',
        body: JSON.stringify({ packageId: status!.packageId }),
      });
      if (alive.current) setStatus(next);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const active = status && ['preparing', 'backup', 'switching', 'checking'].includes(status.phase);
  return (
    <div className="program-update-panel" data-program-update-panel>
      <h4>
        <PackageCheck size={17} /> 程序更新
      </h4>
      {status?.mode === 'managed' && (
        <>
          <p>
            选择官方更新包后，点击一次即可完成准备、完整备份、恢复验证和更新。失败时保留原资料，并恢复可运行版本。
          </p>
          <input
            ref={input}
            type="file"
            accept={`${UPDATE_PACKAGE_EXTENSION},.wlupdate`}
            aria-label="官方程序更新包"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importPackage(file);
            }}
          />
          <div className="button-row">
            <button
              className="btn"
              disabled={busy || !!active}
              onClick={() => input.current?.click()}
            >
              <Upload size={15} /> 选择更新包
            </button>
            {status.phase === 'prepared' && (
              <button
                className="btn primary"
                disabled={busy || !canUpdate}
                onClick={() => void apply()}
              >
                <RefreshCw size={15} /> 备份并更新至 {status.version}
              </button>
            )}
          </div>
          {!canUpdate && <p className="muted">请先保存当前编辑器内容，并等待所有更改保存完成。</p>}
        </>
      )}
      {status?.mode === 'docker' && (
        <p>
          此工作台运行在容器中，由服务器维护者使用宿主机更新入口。入口会自动备份、验证和切换镜像，并核对仍使用原数据卷；具体操作见随程序提供的更新指引。
        </p>
      )}
      {status?.mode === 'manual' && (
        <p>
          当前服务未由更新启动器管理。使用安装根目录的 start.cmd 或 start.sh
          启动后，即可启用受保护的更新入口；服务器服务也可调用同一启动器。
        </p>
      )}
      {status && (
        <p className="admin-notice" role="status">
          {status.message}
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
