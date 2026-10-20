import { useEffect, useState } from 'react';
import {
  themes,
  RESET_CONFIRMATION,
  type ApplicationSettings,
  type ResetResult,
} from '../../shared/application';
import { request } from '../lib/api';
import { BackupSettings } from './BackupSettings';
import { LoginSettings } from './LoginSettings';
export function applyTheme(theme: string) {
  document.documentElement.dataset.theme = theme;
}
export function resetNotice(result: ResetResult) {
  return `创作内容已初始化，原数据与图片已自动备份到 data/backups/${result.backup}。${result.cleanupWarning ? '部分旧图片未能清理，请检查服务器文件权限。' : ''}`;
}
interface AdminInfo {
  settings: ApplicationSettings;
  username?: string;
  loginEnabled: boolean;
  multiUser: boolean;
  storage: string;
  version: string;
  node: string;
  platform: string;
}
export function AdminSettings({
  revision,
  canReset,
  onReset,
  onSettings,
  onAccessChanged,
}: {
  revision: number;
  canReset: boolean;
  onReset: (value: ResetResult) => void;
  onSettings: (value: ApplicationSettings) => void;
  onAccessChanged: () => Promise<void>;
}) {
  const [info, setInfo] = useState<AdminInfo>();
  const [settings, setSettings] = useState<ApplicationSettings>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [fill, setFill] = useState(false);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  useEffect(() => {
    let alive = true;
    request<AdminInfo>('/api/admin')
      .then((v) => {
        if (alive) {
          setInfo(v);
          setSettings(v.settings);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!info || !settings)
    return (
      <div>
        {error ? <p className="muted">{error}</p> : <p className="muted">正在读取后台设置…</p>}
      </div>
    );
  return (
    <div className="admin-settings">
      <BackupSettings revision={revision} canBackup={canReset} loginEnabled={info.loginEnabled} />
      <LoginSettings
        key={String(info.loginEnabled)}
        enabled={info.loginEnabled}
        multiUser={info.multiUser}
        username={info.username}
        canApply={canReset}
        onApplied={async () => {
          setInfo(await request<AdminInfo>('/api/admin'));
          await onAccessChanged();
        }}
      />
      <div className="settings-group">
        <h3>后台 · 工作台与主题</h3>
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              const next = await request<ApplicationSettings>('/api/admin/settings', {
                method: 'PUT',
                body: JSON.stringify(settings),
              });
              onSettings(next);
              setNotice('设置已保存。访问方式的变化在重启服务后生效。');
            });
          }}
        >
          <label className="field">
            工作台名称
            <input
              value={settings.title}
              onChange={(e) => setSettings({ ...settings, title: e.target.value })}
              required
              maxLength={80}
            />
          </label>
          <div className="form-grid">
            <label className="field">
              更换主题
              <select
                value={settings.theme}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    theme: e.target.value as ApplicationSettings['theme'],
                  })
                }
              >
                {Object.entries(themes).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              访问方式
              <select
                value={settings.access}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    access: e.target.value as ApplicationSettings['access'],
                  })
                }
              >
                <option value="local">仅本机</option>
                <option value="server">服务器 / 局域网</option>
              </select>
            </label>
          </div>
          <button className="btn primary" disabled={busy}>
            保存工作台设置
          </button>
        </form>
      </div>
      <div className="settings-group">
        <h3>账号与运行状态</h3>
        <p className="muted">
          GM：{info.loginEnabled ? info.username : '免登录工作台'} ·{' '}
          {info.storage === 'sqlite' ? '本地数据库 SQLite' : 'MySQL'}
          <br />
          {info.version} · Node {info.node} ·{' '}
          {info.platform === 'win32' ? 'Windows' : info.platform}
        </p>
        {info.loginEnabled && (
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (password !== repeat) {
                setError('两次输入的新密码不一致。');
                return;
              }
              void perform(async () => {
                await request('/api/admin/password', {
                  method: 'POST',
                  body: JSON.stringify({ currentPassword: current, password }),
                });
                setCurrent('');
                setPassword('');
                setRepeat('');
                setNotice('密码已更换，其他登录会话已失效。');
              });
            }}
          >
            <label className="field">
              当前密码
              <input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            <div className="form-grid">
              <label className="field">
                新密码
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={10}
                  maxLength={72}
                  autoComplete="new-password"
                  required
                />
              </label>
              <label className="field">
                再次输入新密码
                <input
                  type="password"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
            </div>
            <button className="btn" disabled={busy}>
              更换登录密码
            </button>
          </form>
        )}
      </div>
      <div className="settings-group reset-settings">
        <h3>初始化创作内容</h3>
        <p>
          删除全部世界、条目、地图、关系、剧情、变量、团务与上传图片，恢复为空白创作工作台。账号、安装配置和自动备份保留。
        </p>
        <p className="muted">
          操作前会自动备份工作区和上传图片到
          data/backups；其他数据库不受影响。请先保存编辑器内容，并等待所有更改写入完成。
        </p>
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              const result = await request<ResetResult>('/api/admin/reset', {
                method: 'POST',
                body: JSON.stringify({ confirmation, fillExample: fill, revision }),
              });
              setConfirmation('');
              setFill(false);
              onReset(result);
              setNotice(resetNotice(result));
            });
          }}
        >
          <label className="check-row">
            <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} />
            填充范例内容
          </label>
          <p className="muted">
            勾选后填入“月汐诸国”的整套日式奇幻剑与魔法范例；不勾选则不填入任何创作内容。
          </p>
          <label className="field">
            请输入“{RESET_CONFIRMATION}”确认
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button
            className="btn danger"
            disabled={busy || !canReset || confirmation !== RESET_CONFIRMATION}
          >
            {busy ? '正在处理…' : '确认初始化'}
          </button>
        </form>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="admin-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
