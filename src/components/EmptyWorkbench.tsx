import { useState } from 'react';
import { BRAND_EYEBROW } from '../../shared/branding';
import { BookOpen, Plus, Settings2, Hexagon, LogOut } from 'lucide-react';
import { Modal } from './Common';
import { Guide } from './Guide';
import { AdminSettings } from './AdminSettings';
import type { ApplicationSettings, ResetResult } from '../../shared/application';
import type { Workspace } from '../../shared/model';
import { useAccess } from './AccessContext';
import { UserManagement } from './UserManagement';
import { AccountSettings } from './AccountSettings';
export function EmptyWorkbench({
  onCreate,
  onLogout,
  revision,
  onReset,
  onSettings,
  canReset,
  error,
  notice,
  data,
  managed,
  onTutorial,
  loginEnabled,
  onAccessChanged,
}: {
  onCreate: (name: string) => void;
  onLogout: () => void;
  revision: number;
  onReset: (e: ResetResult) => void;
  onSettings: (s: ApplicationSettings) => void;
  canReset: boolean;
  error: string;
  notice: string;
  data: Workspace;
  managed: boolean;
  onTutorial: () => void;
  loginEnabled: boolean;
  onAccessChanged: () => Promise<void>;
}) {
  const access = useAccess();
  const [name, setName] = useState('');
  const [panel, setPanel] = useState<'guide' | 'settings'>();
  const [securityRevision, setSecurityRevision] = useState(0);
  return (
    <main className="empty-workbench">
      <Hexagon size={46} strokeWidth={1.1} />
      <div className="eyebrow">{BRAND_EYEBROW} · AN UNWRITTEN WORLD</div>
      <h1>你的第一个世界，从这里开始</h1>
      <p>先起一个名字，接着记录一个地点、一位人物和一场即将发生的冒险。</p>
      {access.owner ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onCreate(name.trim());
          }}
        >
          <label className="field">
            世界名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：月影群岛"
              required
              maxLength={240}
            />
          </label>
          <button className="btn primary">
            <Plus size={16} />
            创建空白世界
          </button>
        </form>
      ) : (
        <p>当前还没有世界，请等待主管理员创建。已获授权的功能会在世界建立后显示。</p>
      )}
      <div className="empty-workbench-actions">
        <button className="btn" onClick={onTutorial}>
          工具教学
        </button>
        <button className="btn" onClick={() => setPanel('guide')}>
          <BookOpen size={16} />
          创作指引
        </button>
        <button className="btn" onClick={() => setPanel('settings')}>
          <Settings2 size={16} />
          后台设置
        </button>
        {loginEnabled && (
          <button className="text-btn" onClick={onLogout}>
            <LogOut size={15} />
            退出登录
          </button>
        )}
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
      {panel && (
        <Modal
          title={panel === 'guide' ? '创作指引' : '后台设置'}
          wide
          onClose={() => setPanel(undefined)}
        >
          {panel === 'guide' ? (
            <Guide />
          ) : (
            <>
              {managed && access.administrator && (
                <UserManagement
                  data={data}
                  loginEnabled={loginEnabled}
                  onModeChanged={() => setSecurityRevision((v) => v + 1)}
                />
              )}
              {managed && !access.owner && <AccountSettings />}
              {managed && access.owner && (
                <AdminSettings
                  key={securityRevision}
                  revision={revision}
                  canReset={canReset}
                  onReset={onReset}
                  onSettings={onSettings}
                  onAccessChanged={onAccessChanged}
                />
              )}
            </>
          )}
        </Modal>
      )}
    </main>
  );
}
