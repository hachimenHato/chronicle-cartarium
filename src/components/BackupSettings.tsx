import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, CheckCircle2, Download, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { BackupStatus, FullBackupSummary } from '../../shared/backup';
import { request } from '../lib/api';
import { ProgramUpdatePanel } from './ProgramUpdatePanel';
import { APPLICATION_VERSION } from '../../shared/application';
import { PRIVATE_BACKUP_EXTENSION } from '../../shared/branding';

export function BackupSettings({
  revision,
  canBackup,
  loginEnabled = true,
}: {
  revision: number;
  canBackup: boolean;
  loginEnabled?: boolean;
}) {
  const [status, setStatus] = useState<BackupStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [downloadId, setDownloadId] = useState<string>();
  const [password, setPassword] = useState('');
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    const value = await request<BackupStatus>('/api/admin/full-backups');
    if (alive.current) setStatus(value);
  }, []);
  useEffect(() => {
    alive.current = true;
    void refresh().catch((e) => {
      if (alive.current) setError(e.message);
    });
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void refresh().catch(() => undefined), 800);
    return () => clearInterval(timer);
  }, [busy, refresh]);
  async function create() {
    setBusy(true);
    setError('');
    try {
      await request<FullBackupSummary>('/api/admin/full-backups', {
        method: 'POST',
        body: JSON.stringify({ revision }),
      });
      await refresh();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function download(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/full-backups/${downloadId}/download`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Chronicle-Cartarium-Client': APPLICATION_VERSION,
          'X-Worldloom-Client': APPLICATION_VERSION,
        },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.message || '备份下载失败，请重试。');
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `${downloadId}${PRIVATE_BACKUP_EXTENSION}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      if (alive.current) {
        setPassword('');
        setDownloadId(undefined);
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const working = busy || status?.busy;
  return (
    <div className="settings-group backup-settings" data-full-backup-panel>
      <h3>
        <ShieldCheck size={18} /> 更新前的数据保护
      </h3>
      <p>
        一键备份全部创作、图片、账号和权限，并自动在独立副本中验证恢复。备份期间短暂暂停保存，完成后自动恢复编辑。
      </p>
      <button
        className="btn primary"
        disabled={working || !canBackup}
        onClick={() => void create()}
      >
        {working ? <LoaderCircle size={16} className="spin" /> : <Archive size={16} />}
        {working ? '正在备份与验证…' : '创建并验证完整备份'}
      </button>
      {!canBackup && <p className="muted">请先保存编辑器内容，并等待所有更改保存完成。</p>}
      {status && (
        <p className="admin-notice" role="status">
          {working
            ? status.progress.message
            : status.progress.phase === 'complete'
              ? '完整备份与恢复验证成功，原内容保留。'
              : status.progress.message}
        </p>
      )}
      {status?.backups.slice(0, 5).map((item) => (
        <div className="backup-row" key={item.id}>
          <CheckCircle2 size={16} />
          <div>
            <strong>{new Date(item.createdAt).toLocaleString('zh-CN')}</strong>
            <small>
              {item.files} 个文件 · {(item.bytes / 1024 / 1024).toFixed(1)} MB ·{' '}
              {item.applicationVersion} · 恢复验证通过
            </small>
          </div>
          <button
            className="btn"
            disabled={working}
            onClick={() => {
              setDownloadId(item.id);
              setPassword('');
            }}
          >
            <Download size={14} /> 下载
          </button>
        </div>
      ))}
      {downloadId && (
        <form className="form-stack backup-download" onSubmit={(event) => void download(event)}>
          <p>
            此私有备份含账号配置和密码哈希，下载后请妥善保管。文件未加密，请存放到私有或加密磁盘。
          </p>
          {loginEnabled ? (
            <label className="field">
              主管理员当前密码
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
          ) : (
            <p className="muted">当前为免登录模式，无需密码。请确认仅将此备份保存在私有位置。</p>
          )}
          <div className="button-row">
            <button className="btn primary" disabled={working || (loginEnabled && !password)}>
              确认下载私有备份
            </button>
            <button
              type="button"
              className="btn"
              disabled={working}
              onClick={() => {
                setDownloadId(undefined);
                setPassword('');
              }}
            >
              取消
            </button>
          </div>
        </form>
      )}
      <p className="muted">
        备份保存在当前数据目录的 backups
        中，不会自动清理。下载私有备份后，请另存一份到其他磁盘或设备。
      </p>
      <ProgramUpdatePanel canUpdate={canBackup && !working} />
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
