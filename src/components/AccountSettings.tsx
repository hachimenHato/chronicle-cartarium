import { useState } from 'react';
import { request } from '../lib/api';
export function AccountSettings() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <section className="settings-group">
      <h3>我的账户 · 修改密码</h3>
      <form
        className="form-stack"
        onSubmit={async (event) => {
          event.preventDefault();
          setError('');
          setNotice('');
          if (password !== repeat) {
            setError('两次新密码不一致。');
            return;
          }
          setBusy(true);
          try {
            await request('/api/account/password', {
              method: 'POST',
              body: JSON.stringify({ currentPassword, password }),
            });
            setCurrentPassword('');
            setPassword('');
            setRepeat('');
            setNotice('密码已修改，此账户的其他登录会话已失效。');
          } catch (issue) {
            setError((issue as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          当前密码
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            required
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </label>
        <label className="field">
          新密码
          <input
            type="password"
            autoComplete="new-password"
            minLength={10}
            maxLength={72}
            value={password}
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="field">
          再次输入新密码
          <input
            type="password"
            autoComplete="new-password"
            value={repeat}
            required
            onChange={(e) => setRepeat(e.target.value)}
          />
        </label>
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
        <button className="btn" disabled={busy}>
          {busy ? '正在修改…' : '修改我的密码'}
        </button>
      </form>
    </section>
  );
}
