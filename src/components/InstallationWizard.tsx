import { useState } from 'react';
import { Database, HardDrive, ArrowRight, Check, Hexagon, ShieldCheck } from 'lucide-react';
import { themes, type InstallationStatus, type Theme } from '../../shared/application';
import { request } from '../lib/api';
import {
  BRAND_TITLE,
  BRAND_EYEBROW,
  DATABASE_PREFIX,
  DATABASE_NAME_PATTERN,
} from '../../shared/branding';

export function InstallationWizard({
  status,
  onComplete,
}: {
  status: InstallationStatus;
  onComplete: () => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [storage, setStorage] = useState<'sqlite' | 'mysql'>(status.configuredStorage || 'sqlite');
  const [access, setAccess] = useState<'local' | 'server'>('local');
  const [theme, setTheme] = useState<Theme>('parchment');
  const [title, setTitle] = useState(BRAND_TITLE);
  const [username, setUsername] = useState('gm');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [fill, setFill] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [db, setDb] = useState({
    host: '127.0.0.1',
    port: 3306,
    username: '',
    password: '',
    database: `${DATABASE_PREFIX}${Date.now().toString(36)}`,
  });
  return (
    <main className="installation-shell">
      <aside className="installation-story">
        <Hexagon size={42} strokeWidth={1} />
        <div className="eyebrow">{BRAND_EYEBROW} · FIRST CHAPTER</div>
        <h1>
          为你的世界
          <br />
          安置一张书桌
        </h1>
        <p>从一座村落到整片大陆，把人物、地图与尚未发生的故事连接起来。</p>
        <ol>
          {['选择数据保存方式', '安排工作台与访问方式', '创建你的 GM 账号'].map((label, i) => (
            <li key={label} className={step === i ? 'active' : step > i ? 'done' : ''}>
              <span>{step > i ? <Check size={14} /> : i + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        <small>首次安装只需完成一次。Windows 与 Linux 使用相同的数据格式。</small>
      </aside>
      <form
        className="installation-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          if (step < 2) {
            setStep(step + 1);
            return;
          }
          if (password !== repeat) {
            setError('两次输入的密码不一致。');
            return;
          }
          setBusy(true);
          try {
            await request('/api/install', {
              method: 'POST',
              headers: status.setupTokenRequired
                ? {
                    'X-Chronicle-Cartarium-Setup-Token': setupToken,
                    'X-Worldloom-Setup-Token': setupToken,
                  }
                : undefined,
              body: JSON.stringify({
                storage,
                access,
                theme,
                title,
                username,
                password,
                fillExample: fill,
                ...(storage === 'mysql' && !status.configuredStorage ? { mysql: db } : {}),
              }),
            });
            await onComplete();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="eyebrow">安装指引 · {step + 1} / 3</div>
        {step === 0 ? (
          <>
            <h2>数据保存在哪里？</h2>
            <p className="muted">请选择一种。两种方式都能保存地图、人物与剧情，并提供版本检查。</p>
            <div className="install-storage-choices">
              <label className={`install-choice ${storage === 'sqlite' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="storage"
                  value="sqlite"
                  checked={storage === 'sqlite'}
                  onChange={() => setStorage('sqlite')}
                />
                <HardDrive size={28} />
                <strong>本地数据库</strong>
                <span>
                  无需配置数据库服务，数据保存在安装目录的 data 文件夹中。适合个人电脑与单 GM 使用。
                </span>
                <small>SQLite · 点开即用</small>
              </label>
              <label className={`install-choice ${storage === 'mysql' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="storage"
                  value="mysql"
                  checked={storage === 'mysql'}
                  onChange={() => setStorage('mysql')}
                />
                <Database size={28} />
                <strong>MySQL 数据库</strong>
                <span>
                  连接你自己的 MySQL 服务，适合服务器部署和统一备份。新安装会创建全新的项目专用库。
                </span>
                <small>MySQL 8 · 需要连接信息</small>
              </label>
            </div>
            {storage === 'mysql' &&
              (status.configuredStorage ? (
                <p className="installation-note">
                  已检测到这个项目配置的独立 MySQL 库。安装会保留已有内容，不修改其他数据库。
                </p>
              ) : (
                <div className="form-grid">
                  <label className="field">
                    数据库主机
                    <input
                      value={db.host}
                      onChange={(e) => setDb({ ...db, host: e.target.value })}
                      required
                    />
                  </label>
                  <label className="field">
                    端口
                    <input
                      type="number"
                      min="1"
                      max="65535"
                      value={db.port}
                      onChange={(e) => setDb({ ...db, port: +e.target.value })}
                      required
                    />
                  </label>
                  <label className="field">
                    数据库用户名
                    <input
                      value={db.username}
                      onChange={(e) => setDb({ ...db, username: e.target.value })}
                      required
                      autoComplete="off"
                    />
                  </label>
                  <label className="field">
                    数据库密码
                    <input
                      type="password"
                      value={db.password}
                      onChange={(e) => setDb({ ...db, password: e.target.value })}
                      autoComplete="new-password"
                    />
                  </label>
                  <label className="field wide">
                    新建数据库名称
                    <input
                      value={db.database}
                      onChange={(e) => setDb({ ...db, database: e.target.value })}
                      pattern={DATABASE_NAME_PATTERN}
                      required
                    />
                    <small>
                      使用 chronicle_cartarium_ 开头的新库名；旧前缀仅作兼容。账号需有新建库权限。
                    </small>
                  </label>
                </div>
              ))}
          </>
        ) : step === 1 ? (
          <>
            <h2>安排你的工作台</h2>
            <label className="field">
              工作台名称
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={80}
              />
            </label>
            <fieldset>
              <legend>访问方式</legend>
              <label className="check-row">
                <input
                  type="radio"
                  name="access"
                  checked={access === 'local'}
                  onChange={() => setAccess('local')}
                />
                仅本机使用
              </label>
              <label className="check-row">
                <input
                  type="radio"
                  name="access"
                  checked={access === 'server'}
                  onChange={() => setAccess('server')}
                />
                服务器 / 局域网访问
              </label>
            </fieldset>
            <p className="muted">
              本机模式仅监听本地地址；服务器模式安装后开放网络访问。公网部署还需配置域名、HTTPS
              反向代理与安全 Cookie，详见部署指引。
            </p>
            <label className="field">
              界面主题
              <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
                {Object.entries(themes).map(([id, name]) => (
                  <option value={id} key={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <div className={`theme-sample ${theme}`}>
              <span>月汐诸国</span>
              <small>人物 · 地图 · 尚未发生的冒险</small>
            </div>
          </>
        ) : (
          <>
            <ShieldCheck size={30} />
            <h2>创建你的 GM 账号</h2>
            {status.setupTokenRequired && (
              <label className="field">
                安装授权码
                <input
                  type="password"
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                  required
                  autoComplete="off"
                />
                <small>使用服务器部署时设置的 SETUP_TOKEN。</small>
              </label>
            )}
            <p className="muted">此版本是单 GM 工作台。登录后可以管理全部创作内容。</p>
            <label className="field">
              用户名
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                minLength={2}
                maxLength={40}
                pattern="[\p{L}\p{N}_.\-]+"
                autoComplete="username"
                required
              />
            </label>
            <div className="form-grid">
              <label className="field">
                登录密码
                <input
                  type="password"
                  aria-label="登录密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={10}
                  maxLength={72}
                  autoComplete="new-password"
                  required
                />
                <small>至少 10 个字符</small>
              </label>
              <label className="field">
                再次输入密码
                <input
                  type="password"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} />
              填充范例内容
            </label>
            <p className="muted">
              勾选会创建完整的“月汐诸国”日式剑与魔法范例；不勾选则从空白开始。升级已有项目时优先保留已有内容。
            </p>
            <div className="installation-note">
              已选择：{storage === 'sqlite' ? '本地数据库' : 'MySQL 数据库'} ·{' '}
              {access === 'local' ? '本机访问' : '网络访问'} · {themes[theme]}
            </div>
          </>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="installation-actions">
          {step > 0 && (
            <button type="button" className="btn" disabled={busy} onClick={() => setStep(step - 1)}>
              上一步
            </button>
          )}
          <button className="btn primary" disabled={busy}>
            {busy ? '正在配置工作台…' : step < 2 ? '下一步' : '完成安装并进入'}
            <ArrowRight size={16} />
          </button>
        </div>
      </form>
    </main>
  );
}
