import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Globe2,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import type {
  OnlineUpdateSettings,
  OnlineUpdateSettingsInput,
  OnlineUpdateStatus,
  ProgramUpdateStatus,
} from '../../shared/update';
import { request } from '../lib/api';
import { UPDATE_PACKAGE_EXTENSION } from '../../shared/branding';
import { updateSourceChoice, updateSourceLabel } from '../../shared/update-sources';
import './ProgramUpdatePanel.css';

const activePhases = ['preparing', 'backup', 'switching', 'checking'];
const editableSettings = (settings: OnlineUpdateSettings): OnlineUpdateSettingsInput => ({
  ...settings,
  source: updateSourceChoice(settings),
});
const size = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(0, bytes / 1024).toFixed(0)} KB`;

export function ProgramUpdatePanel({ canUpdate }: { canUpdate: boolean }) {
  const [status, setStatus] = useState<ProgramUpdateStatus>();
  const [online, setOnline] = useState<OnlineUpdateStatus>();
  const [draft, setDraft] = useState<OnlineUpdateSettingsInput>();
  const [action, setAction] = useState<string>();
  const [error, setError] = useState('');
  const [safeNotice, setSafeNotice] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(false);
  const lifecycle = useRef(0);
  const canUpdateNow = useRef(canUpdate);
  const programNow = useRef<ProgramUpdateStatus | undefined>(undefined);
  const actionNow = useRef<string | undefined>(undefined);
  const polling = useRef(false);
  const mutation = useRef(0);
  const intentGeneration = useRef(0);
  const intent = useRef<{ id: string; generation: number } | undefined>(undefined);
  canUpdateNow.current = canUpdate;

  const clearIntent = useCallback((message = '') => {
    intent.current = undefined;
    intentGeneration.current += 1;
    if (alive.current) setSafeNotice(message);
  }, []);
  const beginAction = useCallback((name: string) => {
    if (actionNow.current) return false;
    actionNow.current = name;
    mutation.current += 1;
    setAction(name);
    setError('');
    return true;
  }, []);
  const endAction = useCallback((mount: number) => {
    if (alive.current && lifecycle.current === mount) {
      actionNow.current = undefined;
      setAction(undefined);
    }
  }, []);

  const apply = useCallback(
    async (packageId: string) => {
      // Consume intent before requesting installation; later progress polls cannot repeat it.
      clearIntent();
      if (
        !alive.current ||
        !canUpdateNow.current ||
        document.visibilityState !== 'visible' ||
        programNow.current?.phase !== 'prepared' ||
        programNow.current.packageId !== packageId
      ) {
        if (alive.current)
          setSafeNotice('更新包已保留。请保存所有修改，回到此页面后点击「备份并更新」。');
        return;
      }
      if (!beginAction('apply')) return;
      const mount = lifecycle.current;
      try {
        const next = await request<ProgramUpdateStatus>('/api/admin/updates/apply', {
          method: 'POST',
          body: JSON.stringify({ packageId }),
        });
        if (alive.current && lifecycle.current === mount) {
          programNow.current = next;
          setStatus(next);
        }
      } catch (e) {
        if (alive.current && lifecycle.current === mount) setError((e as Error).message);
      } finally {
        endAction(mount);
      }
    },
    [beginAction, clearIntent, endAction],
  );

  const refresh = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    const mount = lifecycle.current;
    const operation = mutation.current;
    try {
      // Both endpoints read local state. Only the explicit check action contacts the source.
      const [next, nextOnline] = await Promise.all([
        request<ProgramUpdateStatus>('/api/admin/updates'),
        request<OnlineUpdateStatus>('/api/admin/updates/online'),
      ]);
      if (!alive.current || lifecycle.current !== mount || mutation.current !== operation) return;
      programNow.current = next;
      setStatus(next);
      setOnline(nextOnline);
      setDraft((current) => current ?? editableSettings(nextOnline.settings));
      const task = nextOnline.task;
      if (task?.phase === 'error' || task?.phase === 'cancelled') clearIntent();
      const armed = intent.current;
      if (
        armed &&
        task?.id === armed.id &&
        armed.generation === intentGeneration.current &&
        task.phase === 'prepared' &&
        next.phase === 'prepared' &&
        task.packageId &&
        task.packageId === next.packageId &&
        next.mode === 'managed' &&
        nextOnline.supported &&
        !actionNow.current
      ) {
        await apply(task.packageId);
      }
    } catch (e) {
      if (alive.current && lifecycle.current === mount)
        clearIntent('更新状态连接中断。更新包会保留；连接恢复后请手动确认继续。');
      throw e;
    } finally {
      polling.current = false;
    }
  }, [apply, clearIntent]);

  useEffect(() => {
    alive.current = true;
    lifecycle.current += 1;
    void refresh().catch((e: Error) => {
      if (alive.current) setError(e.message);
    });
    const timer = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 2000);
    const visibility = () => {
      if (document.visibilityState !== 'visible')
        clearIntent('下载可以继续；返回后请确认所有修改已保存，再点击「备份并更新」。');
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      lifecycle.current += 1;
      intent.current = undefined;
      intentGeneration.current += 1;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [clearIntent, refresh]);
  useEffect(() => {
    if (!canUpdate)
      clearIntent(
        '检测到尚未保存的修改或其他数据操作。下载可以继续，保存完成后请手动点击「备份并更新」。',
      );
  }, [canUpdate, clearIntent]);

  async function check() {
    if (!beginAction('check')) return;
    const mount = lifecycle.current;
    try {
      const next = await request<OnlineUpdateStatus>('/api/admin/updates/online/check', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (alive.current && lifecycle.current === mount) setOnline(next);
    } catch (e) {
      clearIntent();
      if (alive.current && lifecycle.current === mount) setError((e as Error).message);
    } finally {
      endAction(mount);
    }
  }
  async function download(version: string) {
    clearIntent();
    if (!canUpdateNow.current || document.visibilityState !== 'visible' || !beginAction('download'))
      return;
    const generation = intentGeneration.current;
    const mount = lifecycle.current;
    try {
      const next = await request<OnlineUpdateStatus>('/api/admin/updates/online/download', {
        method: 'POST',
        body: JSON.stringify({ version }),
      });
      if (alive.current && lifecycle.current === mount) {
        setOnline(next);
        if (
          next.task &&
          generation === intentGeneration.current &&
          canUpdateNow.current &&
          document.visibilityState === 'visible' &&
          !['error', 'cancelled'].includes(next.task.phase)
        )
          intent.current = { id: next.task.id, generation };
      }
    } catch (e) {
      clearIntent();
      if (alive.current && lifecycle.current === mount) setError((e as Error).message);
    } finally {
      endAction(mount);
    }
  }
  async function cancel() {
    clearIntent();
    if (!online?.task || !beginAction('cancel')) return;
    const mount = lifecycle.current;
    try {
      const next = await request<OnlineUpdateStatus>('/api/admin/updates/online/cancel', {
        method: 'POST',
        body: JSON.stringify({ id: online.task.id }),
      });
      if (alive.current && lifecycle.current === mount) setOnline(next);
    } catch (e) {
      if (alive.current && lifecycle.current === mount) setError((e as Error).message);
    } finally {
      endAction(mount);
    }
  }
  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    clearIntent();
    if (!draft || !beginAction('settings')) return;
    const mount = lifecycle.current;
    try {
      const next = await request<OnlineUpdateStatus>('/api/admin/updates/online/settings', {
        method: 'PUT',
        body: JSON.stringify({
          channel: draft.channel,
          source: draft.source,
          ...(draft.source === 'mirror' ? { mirrorBaseUrl: draft.mirrorBaseUrl?.trim() } : {}),
        }),
      });
      if (alive.current && lifecycle.current === mount) {
        setOnline(next);
        setDraft(editableSettings(next.settings));
        setSafeNotice('更新来源已保存。请点击「检查更新」获取此来源的版本。');
      }
    } catch (e) {
      if (alive.current && lifecycle.current === mount) setError((e as Error).message);
    } finally {
      endAction(mount);
    }
  }
  async function importPackage(file: File) {
    clearIntent();
    if (!beginAction('import')) return;
    const mount = lifecycle.current;
    try {
      const body = new FormData();
      body.append('file', file);
      const next = await request<ProgramUpdateStatus>('/api/admin/updates/package', {
        method: 'POST',
        body,
      });
      if (alive.current && lifecycle.current === mount) {
        programNow.current = next;
        setStatus(next);
      }
    } catch (e) {
      if (alive.current && lifecycle.current === mount) setError((e as Error).message);
    } finally {
      endAction(mount);
      if (input.current) input.current.value = '';
    }
  }

  const active = !!status && activePhases.includes(status.phase);
  const task = online?.task;
  const transferring = task?.phase === 'downloading' || task?.phase === 'verifying';
  const blocked = !!action || active;
  const settingsChanged =
    !!draft &&
    !!online &&
    (draft.source !== updateSourceChoice(online.settings) ||
      draft.channel !== online.settings.channel ||
      (draft.source === 'mirror' &&
        (draft.mirrorBaseUrl?.trim() ?? '') !== (online.settings.mirrorBaseUrl ?? '')));
  const release = online?.release;
  const available = !!release && !online?.upToDate;
  const progress = task?.total ? Math.min(100, Math.max(0, (task.received / task.total) * 100)) : 0;
  const editSettings = (next: OnlineUpdateSettingsInput) => {
    clearIntent('更新来源正在修改，当前下载不会自动安装。');
    setDraft(next);
  };

  return (
    <div className="program-update-panel" data-program-update-panel>
      <div className="program-update-heading">
        <h4>
          <PackageCheck size={18} /> 程序更新
        </h4>
        {online && <span className="program-update-version">当前 {online.currentVersion}</span>}
      </div>
      <p>从官方发行获取更新。安装前会暂停写入、完整备份并验证恢复，再切换程序版本。</p>
      <div className="program-online-card">
        <div className="program-online-source">
          <Globe2 size={17} />
          <div>
            <strong>{online ? updateSourceLabel(online.settings) : '正在读取更新状态…'}</strong>
            {online && (
              <small>
                {online.settings.channel === 'preview' ? '预览版' : '稳定版'} · {online.platform} /{' '}
                {online.architecture}
              </small>
            )}
          </div>
          <button
            className="btn"
            disabled={!online || blocked || transferring || !!online.checking || settingsChanged}
            onClick={() => void check()}
          >
            {action === 'check' || online?.checking ? (
              <LoaderCircle size={15} className="spin" />
            ) : (
              <RefreshCw size={15} />
            )}
            {action === 'check' || online?.checking ? '正在检查…' : '检查更新'}
          </button>
        </div>
        {online?.checkedAt && (
          <p className="program-update-small">
            上次检查：{new Date(online.checkedAt).toLocaleString('zh-CN')}
          </p>
        )}
        {online?.upToDate && online.checkedAt && (
          <p className="program-update-success">
            <CheckCircle2 size={16} /> 当前已是所选渠道的最新版本。
          </p>
        )}
        {available && (
          <div className="program-release">
            <strong>发现新版本 {release.version}</strong>
            <span>{release.name}</span>
            {release.asset ? (
              <small>下载大小 {size(release.asset.bytes)} · 安装前验证发行签名与文件完整性</small>
            ) : (
              <p className="program-update-small">
                此版本没有适用于当前系统的签名更新包，暂不能在这里自动安装。请查看发行说明。
              </p>
            )}
            {/^https:\/\//.test(release.releaseUrl) && (
              <a href={release.releaseUrl} target="_blank" rel="noopener noreferrer">
                查看发行说明 ↗
              </a>
            )}
            {release.notes && (
              <details className="program-release-notes">
                <summary>本版更新内容</summary>
                <pre>{release.notes}</pre>
              </details>
            )}
            {status?.mode === 'managed' &&
              online?.supported &&
              release.asset &&
              !transferring &&
              status.phase !== 'prepared' &&
              !active && (
                <button
                  className="btn primary"
                  disabled={blocked || !canUpdate || settingsChanged}
                  onClick={() => void download(release.version)}
                >
                  <Download size={16} /> 下载并安全更新
                </button>
              )}
          </div>
        )}
        {transferring && task && (
          <div className="program-download" aria-live="polite">
            <div className="program-download-heading">
              <strong>
                {task.phase === 'verifying' ? '正在验证更新包' : `正在下载 ${task.version}`}
              </strong>
              <span>{task.total ? `${Math.round(progress)}%` : '准备中'}</span>
            </div>
            <progress
              aria-label="更新下载进度"
              value={task.total ? progress : undefined}
              max={100}
            />
            <div className="program-download-footer">
              <small>
                {size(task.received)}
                {task.total > 0 && ` / ${size(task.total)}`} · {updateSourceLabel(task.source)}
              </small>
              <button
                className="btn"
                disabled={blocked || task.phase === 'verifying'}
                onClick={() => void cancel()}
              >
                <X size={14} /> {task.phase === 'verifying' ? '校验中，暂不能取消' : '取消下载'}
              </button>
            </div>
            <p className="program-update-small">
              请留在此页面。下载和校验完成后，仅在所有修改已保存时自动开始备份与更新。
            </p>
            {task.phase === 'verifying' && (
              <p className="program-update-small">
                正在校验文件，尚未开始安装。此步骤完成前暂不能取消。
              </p>
            )}
          </div>
        )}
        {task && !transferring && task.phase !== 'prepared' && (
          <p
            className={task.phase === 'error' ? 'inline-error' : 'program-update-small'}
            role={task.phase === 'error' ? 'alert' : 'status'}
          >
            {task.message}
          </p>
        )}
        {online?.notice && (
          <p className="program-update-notice" role="status">
            {online.notice}
          </p>
        )}
        {online?.checkError && (
          <p className="inline-error" role="alert">
            {online.checkError}
          </p>
        )}
        {online && !online.supported && online.supportMessage && (
          <p className="program-update-small">{online.supportMessage}</p>
        )}
      </div>
      {status?.mode === 'managed' && (
        <>
          {status.phase === 'prepared' && status.packageId && (
            <div className="program-prepared">
              <ShieldCheck size={20} />
              <div>
                <strong>更新包 {status.version} 已验证并准备就绪</strong>
                <small>确认修改已保存后继续；安装过程中请等待完成提示。</small>
              </div>
              <button
                className="btn primary"
                disabled={blocked || !canUpdate}
                onClick={() => void apply(status.packageId!)}
              >
                <RefreshCw size={15} /> 备份并更新至 {status.version}
              </button>
            </div>
          )}
          <details className="program-offline">
            <summary>
              <Upload size={15} /> 离线导入更新包
            </summary>
            <p>
              网络不便时，可从官方发行页下载 {UPDATE_PACKAGE_EXTENSION}{' '}
              文件，再导入此处。导入不会直接安装。
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
            <button
              className="btn"
              disabled={blocked || transferring}
              onClick={() => {
                clearIntent();
                input.current?.click();
              }}
            >
              <Upload size={15} /> 选择更新包
            </button>
          </details>
          {!canUpdate && (
            <p className="program-update-notice">
              请先保存当前编辑器内容，并等待所有更改保存完成。
            </p>
          )}
        </>
      )}
      {status?.mode === 'docker' && (
        <p className="program-update-notice">
          此工作台运行在 Docker
          中，网页不能替换容器镜像。请由服务器维护者使用宿主机更新入口，自动备份、验证并核对原数据卷；具体操作见随程序提供的更新指引。
        </p>
      )}
      {status?.mode === 'manual' && (
        <p className="program-update-notice">
          当前服务未由更新启动器管理。使用安装根目录的 start.cmd 或 start.sh
          启动后，即可启用受保护的更新入口；服务器服务也可调用同一启动器。
        </p>
      )}
      <p className="program-update-small">
        此入口更新创作工作台。Windows 桌面程序可从窗口“帮助 → 检查桌面程序更新…”自动更新。
      </p>
      {draft && (
        <details className="program-update-advanced">
          <summary>
            <Settings2 size={15} /> 更新来源与渠道
          </summary>
          <form onSubmit={(event) => void saveSettings(event)}>
            <fieldset disabled={blocked || transferring}>
              <legend>下载来源</legend>
              <div className="program-source-options">
                <label>
                  <input
                    type="radio"
                    name="update-source"
                    checked={draft.source === 'github'}
                    onChange={() => editSettings({ ...draft, source: 'github' })}
                  />
                  <span>
                    <strong>{updateSourceLabel('github')}</strong>
                    <small>直接下载项目发布的更新包</small>
                  </span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="update-source"
                    checked={draft.source === 'china'}
                    onChange={() => editSettings({ ...draft, source: 'china' })}
                  />
                  <span>
                    <strong>{updateSourceLabel('china')}</strong>
                    <small>项目维护的国内下载入口，无需填写地址</small>
                  </span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="update-source"
                    checked={draft.source === 'mirror'}
                    onChange={() => editSettings({ ...draft, source: 'mirror' })}
                  />
                  <span>
                    <strong>{updateSourceLabel('mirror')}</strong>
                    <small>填写自己的 HTTPS 镜像地址</small>
                  </span>
                </label>
              </div>
              <p className="program-source-help">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>
                  所有来源均会验证官方签名与文件完整性。国内源与自建镜像连接失败时，会尝试 GitHub。
                </span>
              </p>
              {draft.source === 'mirror' && (
                <label className="field">
                  镜像入口地址
                  <input
                    type="url"
                    required
                    pattern="https://.+"
                    placeholder="https://updates.example.com/chronicle-cartarium"
                    value={draft.mirrorBaseUrl ?? ''}
                    onChange={(event) =>
                      editSettings({ ...draft, mirrorBaseUrl: event.target.value })
                    }
                  />
                  <small>
                    仅支持
                    HTTPS。请填写自己部署或由服务器维护者提供的镜像入口；使用内置国内源无需配置此地址。
                  </small>
                </label>
              )}
              <label className="field">
                版本渠道
                <select
                  value={draft.channel}
                  onChange={(event) =>
                    editSettings({
                      ...draft,
                      channel: event.target.value as OnlineUpdateSettings['channel'],
                    })
                  }
                >
                  <option value="stable">稳定版</option>
                  <option value="preview">预览版（包含测试版本）</option>
                </select>
              </label>
              <button className="btn" type="submit" disabled={!settingsChanged}>
                {action === 'settings' && <LoaderCircle size={15} className="spin" />}保存更新设置
              </button>
            </fieldset>
          </form>
          {settingsChanged && (
            <p className="program-update-small">来源或渠道尚未保存，保存后再检查和下载更新。</p>
          )}
        </details>
      )}
      {safeNotice && (
        <p className="program-update-notice" role="status">
          {safeNotice}
        </p>
      )}
      {status && (
        <p className="admin-notice" role="status">
          {active && <LoaderCircle size={15} className="spin" />} {status.message}
        </p>
      )}
      {status?.phase === 'complete' && (
        <p className="program-update-notice">
          更新已完成。请先保留当前尚未保存的编辑内容，再刷新页面使用新版。
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
