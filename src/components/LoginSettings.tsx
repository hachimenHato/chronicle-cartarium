import { useState } from 'react';
import { request } from '../lib/api';

export function LoginSettings({
  enabled,
  multiUser,
  username,
  canApply,
  onApplied,
}: {
  enabled: boolean;
  multiUser: boolean;
  username?: string;
  canApply: boolean;
  onApplied: () => Promise<void>;
}) {
  const [next, setNext] = useState(enabled);
  const [name, setName] = useState(username ?? 'gm');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [current, setCurrent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="settings-group" data-login-settings>
      <h3>登录与访问保护</h3>
      <p className="muted">
        关闭登录后，能访问此地址的人均拥有主管理员权限。多用户模式开启时不能关闭登录；账号和创作资料不会被删除。
      </p>
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setError('');
          if (next && password !== repeat) {
            setError('两次输入的密码不一致。');
            return;
          }
          setBusy(true);
          try {
            await request('/api/admin/login', {
              method: 'PUT',
              body: JSON.stringify({
                enabled: next,
                ...(next ? { username: name, password } : {}),
                ...(enabled ? { currentPassword: current } : {}),
              }),
            });
            setPassword('');
            setRepeat('');
            setCurrent('');
            await onApplied();
          } catch (issue) {
            setError((issue as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="check-row">
          <input
            type="checkbox"
            checked={next}
            disabled={multiUser || busy}
            onChange={(event) => setNext(event.target.checked)}
          />
          开启登录界面
        </label>
        {multiUser && <p className="muted">请先在多用户管理中关闭多用户模式。</p>}
        {next !== enabled && (
          <>
            {enabled && (
              <label className="field">
                主管理员当前密码
                <input
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                  required
                />
              </label>
            )}
            {next && (
              <>
                <label className="field">
                  主管理员登录名
                  <input
                    autoComplete="username"
                    minLength={2}
                    maxLength={40}
                    pattern="[\p{L}\p{N}_.\-]+"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <div className="form-grid">
                  <label className="field">
                    设置登录密码
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={10}
                      maxLength={72}
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <small>至少 10 个字符，UTF-8 最多 72 字节。</small>
                  </label>
                  <label className="field">
                    确认登录密码
                    <input
                      type="password"
                      autoComplete="new-password"
                      required
                      value={repeat}
                      onChange={(event) => setRepeat(event.target.value)}
                    />
                  </label>
                </div>
              </>
            )}
          </>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        {!canApply && <p className="muted">请先保存编辑内容并等待写入完成。</p>}
        <button className="btn primary" disabled={busy || !canApply || next === enabled}>
          {busy ? '正在应用…' : '应用登录设置'}
        </button>
      </form>
    </section>
  );
}
