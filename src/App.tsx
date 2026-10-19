import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Compass,
  Download,
  Feather,
  FileText,
  FolderOpen,
  Globe2,
  Hexagon,
  LayoutDashboard,
  Activity as ActivityIcon,
  Map,
  Menu,
  MoreHorizontal,
  Network,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Users,
  X,
  GitBranch,
  CalendarDays,
  ShieldCheck,
  LogOut,
  Upload,
  AlertCircle,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import {
  makeId,
  type Entity,
  type EntityType,
  type Workspace,
  type WorkspaceEnvelope,
  type World,
} from '../shared/model';
import { getWorkspace, request, downloadFile, saveWorkspace } from './lib/api';
import { useWorkspace } from './lib/useWorkspace';
import { useClientUpdate } from './lib/useClientUpdate';
import { saveEntityInWorkspace } from './lib/workspace-mutations';
import { clearMapEntityLinks } from '../shared/workspace-mutations';
import Atlas, { TerrainArtwork } from './components/Atlas';
import EntityEditor from './components/EntityEditor';
import { RelationshipGraph, PlotBoard } from './components/Graphs';
import ExportDialog from './components/ExportDialog';
import Sessions from './components/Sessions';
import { Empty, EntityLink, Modal, VisibilityBadge } from './components/Common';
import { EntityTooltipProvider } from './components/EntityTooltip';
import { InstallationWizard } from './components/InstallationWizard';
import { AdminSettings, applyTheme, resetNotice } from './components/AdminSettings';
import { Guide } from './components/Guide';
import { Dashboard } from './components/Dashboard';
import { EmptyWorkbench } from './components/EmptyWorkbench';
import { TemplateSettings } from './components/TemplateSettings';
import { applyEntityTemplate, newEntity } from '../shared/entity-templates';
import { applyEntityTypes, getEntityTypes, getEntityTypeLabel } from '../shared/entity-types';
import { AccessProvider, useAccess } from './components/AccessContext';
import { ownerAccount } from '../shared/access';
import { TypeSettings } from './components/TypeSettings';
import { UserManagement } from './components/UserManagement';
import { ToolTour } from './components/ToolTour';
import { AccountSettings } from './components/AccountSettings';
import type { UserAccount } from '../shared/access';
import type { ApplicationSettings, InstallationStatus } from '../shared/application';
import {
  BRAND_TITLE,
  BRAND_ZH,
  BRAND_EYEBROW,
  BRAND_INITIALS,
  CREATIVE_BACKUP_FORMAT,
  isCreativeBackupFormat,
  shortApplicationTitle,
} from '../shared/branding';

type View =
  | 'dashboard'
  | 'guide'
  | 'overview'
  | 'atlas'
  | 'lore'
  | 'characters'
  | 'relations'
  | 'plots'
  | 'journal';
const navItems = [
  { id: 'dashboard', label: '创作仪表盘', icon: ActivityIcon },
  { id: 'overview', label: '世界总览', icon: LayoutDashboard },
  { id: 'atlas', label: '地图工坊', icon: Map },
  { id: 'lore', label: '世界知识库', icon: BookOpen },
  { id: 'characters', label: '角色档案', icon: Users },
  { id: 'relations', label: '人物关系', icon: Network },
  { id: 'plots', label: '剧情编织', icon: GitBranch },
  { id: 'journal', label: '团务日志', icon: CalendarDays },
  { id: 'guide', label: '创作指引', icon: Compass },
] as const;
const typeIcons: Partial<Record<EntityType, typeof Globe2>> = {
  character: Users,
  location: Map,
  faction: ShieldCheck,
  history: CalendarDays,
  magic: Sparkles,
};

export default function App() {
  const [initial, setInitial] = useState<WorkspaceEnvelope | null>(null);
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [installation, setInstallation] = useState<InstallationStatus>();
  const [appSettings, setAppSettings] = useState<ApplicationSettings>({
    title: BRAND_TITLE,
    theme: 'parchment',
    access: 'local',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const status = await request<InstallationStatus>('/api/status');
      setInstallation(status);
      if (status.settings) {
        setAppSettings(status.settings);
        applyTheme(status.settings.theme);
      }
      if (status.setupRequired) {
        setLocked(false);
        return;
      }
      if (status.loginRequired && !status.authenticated) {
        setLocked(true);
        return;
      }
      setInitial(await getWorkspace());
      setLocked(false);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (initial)
    return (
      <AccessProvider actor={installation?.actor ?? { ...ownerAccount(), tourCompleted: true }}>
        <Studio
          initial={initial}
          appSettings={appSettings}
          managed={installation?.setupRequired !== undefined}
          onActor={(actor) =>
            setInstallation((previous) => (previous ? { ...previous, actor } : previous))
          }
          onSettings={(settings) => {
            setAppSettings(settings);
            applyTheme(settings.theme);
          }}
          onLogout={() => {
            setInitial(null);
            setLocked(true);
          }}
        />
      </AccessProvider>
    );
  if (installation?.setupRequired)
    return <InstallationWizard status={installation} onComplete={load} />;
  return (
    <div className="startup">
      <div className="startup-mark">
        <Hexagon size={44} strokeWidth={1.2} />
        <span>{BRAND_ZH}</span>
      </div>
      {locked ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await request('/api/login', {
                method: 'POST',
                body: JSON.stringify({ password, username }),
              });
              setPassword('');
              await load();
            } catch (err) {
              setError((err as Error).message);
              setBusy(false);
            }
          }}
        >
          <div className="eyebrow">{BRAND_EYEBROW} · CREATOR STUDIO</div>
          <h1>回到你的世界</h1>
          <p>故事、人物与尚未发生的冒险，都在这里。</p>
          <label className="field">
            用户名
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </label>
          <label className="field">
            登录密码
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button className="btn primary full-width" disabled={busy}>
            {busy ? '正在进入…' : '进入创作工作台'}
            <ArrowRight size={16} />
          </button>
        </form>
      ) : (
        <div className="loading-state">
          <LoaderCircle className="spin" size={26} />
          <p>正在打开世界档案…</p>
        </div>
      )}
      {error && (
        <div className="inline-error">
          <p>{error}</p>
          {!locked && (
            <button className="btn" onClick={() => void load()}>
              重新连接
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Studio({
  initial,
  onLogout,
  appSettings,
  onSettings,
  managed,
  onActor,
}: {
  initial: WorkspaceEnvelope;
  onLogout: () => void;
  appSettings: ApplicationSettings;
  onSettings: (settings: ApplicationSettings) => void;
  managed: boolean;
  onActor: (actor: UserAccount) => void;
}) {
  const access = useAccess();
  const { data, setData, status, error, retry, replaceSaved, revision, reloadWhenSaved } =
    useWorkspace(initial);
  const updateAvailable = useClientUpdate();
  const [worldId, setWorldId] = useState(initial.data.worlds[0]?.id || '');
  const [view, setView] = useState<View>('dashboard');
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [selectedMap, setSelectedMap] = useState<string | undefined>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [newOpen, setNewOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [worldForm, setWorldForm] = useState<World | null>(null);
  const [templateType, setTemplateType] = useState<EntityType>();
  const [typeSettings, setTypeSettings] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const autoTourSeen = useRef(new Set<string>());
  const [mobile, setMobile] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return (
        (localStorage.getItem('chronicle-cartarium.sidebarCollapsed') ??
          localStorage.getItem('worldloom.sidebarCollapsed')) === 'true'
      );
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('chronicle-cartarium.sidebarCollapsed', String(sidebarCollapsed));
    } catch {
      /* Display preferences work even when local storage is unavailable. */
    }
  }, [sidebarCollapsed]);
  const [notice, setNotice] = useState('');
  const [restore, setRestore] = useState<Workspace | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const world = data.worlds.find((w) => w.id === worldId) || data.worlds[0];
  const activeId = world?.id || worldId;
  const entities = data.entities.filter((e) => e.worldId === activeId);
  const maps = data.maps.filter((m) => m.worldId === activeId);
  const plots = data.plots.filter((p) => p.worldId === activeId);
  const relations = data.relations.filter((r) => r.worldId === activeId);
  const sessions = data.sessions.filter((s) => s.worldId === activeId);
  const variables = data.variables.filter((v) => v.worldId === activeId);
  useEffect(() => {
    const key = `${access.actor.id}:${world ? 'full' : 'empty'}`;
    if (managed && !access.actor.tourCompleted && !autoTourSeen.current.has(key)) {
      autoTourSeen.current.add(key);
      setTourOpen(true);
    }
  }, [access.actor.id, access.actor.tourCompleted, Boolean(world), managed]);
  const finishTour = () => {
    setTourOpen(false);
    setMobile(false);
    if (world && managed)
      void request<UserAccount>('/api/account/tour', {
        method: 'POST',
        body: JSON.stringify({ completed: true }),
      })
        .then(onActor)
        .catch((issue: Error) => setNotice('教学结束状态未能保存：' + issue.message));
  };
  const confirmLeave = () => {
    if (editorDirty && !window.confirm('编辑器还有未保存的修改。放弃这些修改并离开？'))
      return false;
    return true;
  };
  const navigate = (next: View, skipGuard = false) => {
    if (next === view && !selectedEntity) {
      setMobile(false);
      return;
    }
    if (!skipGuard && !confirmLeave()) return;
    setView(next);
    setSelectedEntity(null);
    setQuery('');
    setTypeFilter('all');
    setMobile(false);
  };
  const openEntity = (id: string) => {
    if (selectedEntity?.id === id) {
      setSearchOpen(false);
      return;
    }
    if (!confirmLeave()) return;
    const entity = data.entities.find((e) => e.id === id);
    if (entity) {
      setSelectedEntity(entity);
      setView(entity.type === 'character' ? 'characters' : 'lore');
      setSearchOpen(false);
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  const changeScoped = <K extends 'maps' | 'relations' | 'plots' | 'sessions' | 'variables'>(
    key: K,
    next: Workspace[K],
  ) =>
    setData((prev) => ({
      ...prev,
      [key]: [...prev[key].filter((x) => x.worldId !== activeId), ...next],
    }));
  const changeVariables = (next: Workspace['variables']) =>
    setData((prev) => {
      if (!access.owner)
        return {
          ...prev,
          variables: [...prev.variables.filter((v) => v.worldId !== activeId), ...next],
        };
      const previous = prev.variables.filter((v) => v.worldId === activeId);
      const rename = new globalThis.Map(
        previous.map((v) => [v.name, next.find((n) => n.id === v.id)?.name]),
      );
      const remap = <T extends { variable: string }>(rules: T[]) =>
        rules
          .filter((r) => !rename.has(r.variable) || rename.get(r.variable))
          .map((r) => ({ ...r, variable: rename.get(r.variable) || r.variable }));
      return {
        ...prev,
        variables: [...prev.variables.filter((v) => v.worldId !== activeId), ...next],
        plots: prev.plots.map((p) =>
          p.worldId === activeId
            ? {
                ...p,
                nodes: p.nodes.map((n) => ({
                  ...n,
                  conditions: remap(n.conditions),
                  effects: remap(n.effects),
                })),
              }
            : p,
        ),
      };
    });
  const saveEntity = (entity: Entity) => {
    setData((prev) =>
      access.owner
        ? saveEntityInWorkspace(prev, entity)
        : {
            ...prev,
            entities: prev.entities.some((e) => e.id === entity.id)
              ? prev.entities.map((e) => (e.id === entity.id ? entity : e))
              : [...prev.entities, entity],
          },
    );
    setEditorDirty(false);
    setSelectedEntity(entity);
    setNotice('条目已更新');
  };
  const deleteEntity = (id: string) => {
    if (!access.owner) {
      setData((prev) => ({ ...prev, entities: prev.entities.filter((e) => e.id !== id) }));
      setSelectedEntity(null);
      setNotice('删除请求正在保存，关联引用由服务端同步清理。');
      return;
    }
    setData((prev) => ({
      ...prev,
      entities: prev.entities.filter((e) => e.id !== id),
      relations: prev.relations.filter((r) => r.sourceId !== id && r.targetId !== id),
      maps: prev.maps.map((m) => clearMapEntityLinks(m, new Set([id]))),
      plots: prev.plots.map((p) => ({
        ...p,
        nodes: p.nodes.map((n) => ({ ...n, entityIds: n.entityIds.filter((i) => i !== id) })),
      })),
    }));
    setSelectedEntity(null);
    setNotice('条目已删除，关联引用已清理');
  };
  const createEntity = (type: EntityType) => {
    if (!access.create(type === 'character' ? 'characters' : 'lore')) {
      setNotice('当前账户没有创建此类条目的权限。');
      return;
    }
    if (!confirmLeave()) return;
    setSelectedEntity({ ...newEntity(activeId, type, world), createdBy: access.actor.id });
    setView(type === 'character' ? 'characters' : 'lore');
    setNewOpen(false);
  };
  const startWorld = () => {
    if (!access.owner) {
      setNotice('创建世界仅限主管理员。');
      return;
    }
    if (!confirmLeave()) return;
    setWorldForm({
      id: makeId('world'),
      name: '',
      subtitle: '',
      description: '',
      system: '通用规则',
      createdAt: new Date().toISOString(),
    });
    setSettings(false);
  };
  const backup = () => {
    if (!access.owner) {
      setNotice('完整备份仅限主管理员。');
      return;
    }
    downloadFile(
      `${BRAND_ZH}-创作档案-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ format: CREATIVE_BACKUP_FORMAT, version: 1, data }, null, 2),
      'application/json',
    );
    setNotice('备份已下载；上传的立绘请同时备份服务器 uploads 目录');
  };
  const readBackup = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('备份文件不能超过 20 MB');
      const parsed = JSON.parse(await file.text());
      if (
        !isCreativeBackupFormat(parsed.format) ||
        parsed.version !== 1 ||
        !parsed.data ||
        !Array.isArray(parsed.data.worlds)
      )
        throw new Error(`${BRAND_ZH} v1 创作档案格式无效`);
      setRestore(parsed.data);
    } catch (e) {
      setNotice((e as Error).message);
    }
    if (importRef.current) importRef.current.value = '';
  };
  const searchResults = entities.filter((e) =>
    `${e.name} ${e.summary} ${e.content} ${e.tags.join(' ')}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  if (!world)
    return (
      <>
        <EmptyWorkbench
          data={data}
          managed={managed}
          onTutorial={() => setTourOpen(true)}
          revision={revision.current}
          canReset={status === 'saved' && !editorDirty}
          error={error}
          notice={notice}
          onCreate={(name) => {
            const w: World = {
              id: makeId('world'),
              name,
              subtitle: '',
              description: '',
              system: '自定义规则',
              createdAt: new Date().toISOString(),
            };
            setData((prev) => ({ ...prev, worlds: [...prev.worlds, w] }));
            setWorldId(w.id);
            setView('overview');
          }}
          onSettings={onSettings}
          onReset={(result) => {
            const envelope = result.envelope;
            replaceSaved(envelope);
            setWorldId(envelope.data.worlds[0]?.id || '');
            setSelectedEntity(null);
            setSelectedMap(undefined);
            setView('dashboard');
            setNotice(resetNotice(result));
          }}
          onLogout={() => {
            void request('/api/logout', { method: 'POST' })
              .then(onLogout)
              .catch((e) => setNotice(e.message));
          }}
        />
        {tourOpen && (
          <ToolTour key="empty" hasWorld={false} onNavigate={() => {}} onFinish={finishTour} />
        )}
      </>
    );
  return (
    <EntityTooltipProvider key={world.id} world={world} entities={entities} onOpen={openEntity}>
      <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <aside className={`sidebar ${mobile ? 'open' : ''}`}>
          <div className="brand">
            <div className="brand-mark">
              <Hexagon size={29} strokeWidth={1.3} />
              <span>{BRAND_INITIALS}</span>
            </div>
            <strong>
              {shortApplicationTitle(appSettings.title)}
              <span>{BRAND_EYEBROW}</span>
            </strong>
            <button
              className="icon-btn mobile-close"
              aria-label="关闭菜单"
              onClick={() => setMobile(false)}
            >
              <X size={18} />
            </button>
          </div>
          <button
            className="sidebar-collapse icon-btn"
            aria-label={sidebarCollapsed ? '展开左侧导航' : '收起左侧导航'}
            title={sidebarCollapsed ? '展开左侧导航' : '收起为图标导航'}
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <div className="world-switch" title={world.name}>
            <div className="world-initial">
              <Globe2 size={21} />
            </div>
            <div>
              <small>当前世界</small>
              <select
                aria-label="切换世界"
                value={activeId}
                onChange={(e) => {
                  if (!confirmLeave()) return;
                  setWorldId(e.target.value);
                  setSelectedMap(undefined);
                  navigate('overview', true);
                }}
              >
                {data.worlds.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} · {w.subtitle || '新的篇章'}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            className="sidebar-search"
            aria-label="搜索世界档案"
            title="搜索世界档案"
            onClick={() => {
              setQuery('');
              setSearchOpen(true);
            }}
          >
            <Search size={15} />
            <span>寻找世界中的一切</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="nav-group-label">创作空间</div>
          <nav>
            {navItems.map(({ id, label, icon: Icon }) => (
              <button
                className={`nav-item ${view === id ? 'active' : ''}`}
                key={id}
                aria-label={label}
                title={label}
                onClick={() => navigate(id)}
              >
                <Icon size={18} strokeWidth={1.6} />
                <span>{label}</span>
                {['lore', 'characters'].includes(id) && (
                  <small>
                    {
                      entities.filter((e) =>
                        id === 'characters' ? e.type === 'character' : e.type !== 'character',
                      ).length
                    }
                  </small>
                )}
                {id === 'overview' && view === id && <i />}
              </button>
            ))}
          </nav>
          <div className="sidebar-divider" />
          <div className="nav-group-label">
            最近的灵感 <Feather size={13} />
          </div>
          <div className="recent-links">
            {[...entities]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .slice(0, 3)
              .map((e) => (
                <button key={e.id} onClick={() => openEntity(e.id)}>
                  <FileText size={13} />
                  <span>{e.name}</span>
                </button>
              ))}
          </div>
          <div className="sidebar-bottom">
            <button
              className="sidebar-bottom-item"
              aria-label="工具教学"
              title="工具教学"
              onClick={() => {
                if (confirmLeave()) {
                  setSelectedEntity(null);
                  setTourOpen(true);
                }
              }}
            >
              <Compass size={17} />
              <span>工具教学</span>
            </button>
            <div className="sidebar-tip">
              <Sparkles size={17} />
              <span>
                悬停1秒看摘要，再停留2.7秒锁定
                <br />
                不离开当前页面，即可查看摘要
              </span>
            </div>
            <button
              className="sidebar-bottom-item"
              disabled={!access.exportAllowed}
              aria-label="导出世界档案"
              title="导出世界档案"
              onClick={() => setExportOpen(true)}
            >
              <ArrowDownToLine size={17} /> <span>导出世界档案</span>
            </button>
            <button
              className="sidebar-bottom-item"
              aria-label="工作台设置"
              title="工作台设置"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={17} /> <span>工作台设置</span>
            </button>
            <div className="gm-profile">
              <div className="gm-avatar">{access.actor.username.slice(0, 2).toUpperCase()}</div>
              <div>
                <strong>{access.actor.username}</strong>
                <small>
                  {access.owner ? '主管理员' : access.administrator ? '次级管理员' : '普通用户'}
                </small>
              </div>
              <ShieldCheck size={16} />
            </div>
          </div>
        </aside>
        {mobile && (
          <button
            className="sidebar-overlay"
            aria-label="关闭侧栏"
            onClick={() => setMobile(false)}
          />
        )}
        <main className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-btn mobile-menu"
                onClick={() => setMobile(true)}
                aria-label="打开菜单"
              >
                <Menu size={19} />
              </button>
              <Globe2 size={15} />
              <span>{world.name}</span>
              <ChevronRight size={13} />
              <strong>
                {selectedEntity
                  ? selectedEntity.name || '新建条目'
                  : navItems.find((n) => n.id === view)?.label}
              </strong>
            </div>
            <div className="top-actions">
              <span className={`save-status ${status}`}>
                <span />
                {status === 'saved'
                  ? editorDirty
                    ? '编辑器有未保存内容'
                    : '所有更改已保存'
                  : status === 'saving'
                    ? '正在保存…'
                    : status === 'pending'
                      ? '等待保存…'
                      : status === 'conflict'
                        ? '发现版本冲突'
                        : '保存失败'}
              </span>
              <button
                className="icon-btn"
                aria-label="全局搜索"
                onClick={() => {
                  setQuery('');
                  setSearchOpen(true);
                }}
              >
                <Search size={18} />
              </button>
              <div className="top-divider" />
              <button
                className="btn primary"
                disabled={!access.create('characters') && !access.create('lore')}
                onClick={() => setNewOpen(true)}
              >
                <Plus size={16} /> 新建设定
              </button>
            </div>
          </header>
          {updateAvailable && (
            <div className="client-update-banner" role="status">
              <Sparkles size={17} aria-hidden="true" />
              <span>
                <strong>工作台有新版可用</strong>
                <small>
                  {status === 'saved' && !editorDirty
                    ? '刷新即可加载新的地图工具，已保存内容会保留。'
                    : '请先保存当前修改；保存完成后再刷新，避免丢失内容。'}
                </small>
              </span>
              <button
                className="btn"
                disabled={status !== 'saved' || editorDirty}
                onClick={() => {
                  if (!reloadWhenSaved(editorDirty))
                    setNotice('还有未保存的修改，请等待保存完成后再刷新。');
                }}
              >
                刷新使用新版
              </button>
            </div>
          )}
          {(status === 'error' || status === 'conflict') && (
            <div className="save-error" role="alert">
              <AlertCircle size={16} />
              <span>
                {status === 'conflict'
                  ? '其他窗口已更新工作区。请先下载备份，再重新载入以避免覆盖。'
                  : error}
              </span>
              <button onClick={backup}>备份当前内容</button>
              {status === 'conflict' ? (
                <button
                  onClick={async () => {
                    replaceSaved(await getWorkspace());
                    setSelectedEntity(null);
                  }}
                >
                  重新载入
                </button>
              ) : (
                <button onClick={() => void retry()}>重试保存</button>
              )}
            </div>
          )}
          {initial.mode === 'demo' && (
            <div className="demo-banner">
              当前使用本机演示存储。配置 MySQL 后可切换为数据库持久保存。
            </div>
          )}
          <div className={`main-content ${view === 'atlas' ? 'atlas-content' : ''}`}>
            {selectedEntity ? (
              <EntityEditor
                key={selectedEntity.id}
                entity={
                  entities.find((entity) => entity.id === selectedEntity.id) || selectedEntity
                }
                entities={entities}
                world={world}
                onTemplateSettings={(type) => setTemplateType(type)}
                onSave={saveEntity}
                onDelete={deleteEntity}
                onBack={() => {
                  if (confirmLeave()) setSelectedEntity(null);
                }}
                onOpen={openEntity}
                onDirty={setEditorDirty}
              />
            ) : view === 'dashboard' ? (
              <Dashboard
                onType={(type) => {
                  if (confirmLeave()) {
                    navigate(type === 'character' ? 'characters' : 'lore', true);
                    setTypeFilter(type);
                  }
                }}
                data={data}
                worldId={activeId}
                status={status}
                onNavigate={(next) => navigate(next as View)}
              />
            ) : view === 'guide' ? (
              <Guide
                onNavigate={(next) => navigate(next as View)}
                onTutorial={() => setTourOpen(true)}
              />
            ) : view === 'overview' ? (
              <Overview
                world={world}
                entities={entities}
                maps={maps}
                plots={plots}
                sessions={sessions}
                onNavigate={navigate}
                onOpen={openEntity}
                onMap={(id) => {
                  setSelectedMap(id);
                  navigate('atlas');
                }}
                onSettings={() => setWorldForm({ ...world })}
                onCreate={() => setNewOpen(true)}
              />
            ) : view === 'atlas' ? (
              <Atlas
                maps={maps}
                entities={entities}
                worldId={activeId}
                world={world}
                selectedMapId={selectedMap}
                onChange={(next) => changeScoped('maps', next)}
                onOpenEntity={openEntity}
                onCommitGenerated={(map, created) =>
                  setData((prev) => ({
                    ...prev,
                    maps: prev.maps.map((m) => (m.id === map.id ? map : m)),
                    entities: [
                      ...prev.entities,
                      ...created.filter((e) => !prev.entities.some((old) => old.id === e.id)),
                    ],
                  }))
                }
                onCreateDivision={(entity, map) =>
                  setData((prev) => ({
                    ...prev,
                    entities: [...prev.entities, entity],
                    maps: prev.maps.map((m) => (m.id === map.id ? map : m)),
                  }))
                }
              />
            ) : view === 'lore' || view === 'characters' ? (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">
                      {view === 'characters' ? 'CHARACTER ARCHIVE' : 'THE WORLD ENCYCLOPEDIA'}
                    </div>
                    <h1>{view === 'characters' ? '角色档案' : '世界知识库'}</h1>
                    <p>
                      {view === 'characters'
                        ? '让每一个名字，都成为鲜活的灵魂。'
                        : '从宇宙的法则，到一间街角的酒馆。'}
                    </p>
                  </div>
                  <div className="button-row">
                    <button
                      className="btn"
                      disabled={!access.administrator}
                      onClick={() => setTypeSettings(true)}
                    >
                      <Settings2 size={16} /> 设定类型
                    </button>
                    <button
                      className="btn"
                      disabled={!access.administrator}
                      onClick={() =>
                        setTemplateType(
                          view === 'characters'
                            ? 'character'
                            : typeFilter === 'all'
                              ? (getEntityTypes(world).find((t) => t.id !== 'character')?.id ??
                                'character')
                              : (typeFilter as EntityType),
                        )
                      }
                    >
                      <Settings2 size={16} />
                      模板设置
                    </button>
                    <button
                      className="btn primary"
                      disabled={!access.create(view === 'characters' ? 'characters' : 'lore')}
                      onClick={() =>
                        view === 'characters' ? createEntity('character') : setNewOpen(true)
                      }
                    >
                      <Plus size={16} /> {view === 'characters' ? '创建角色' : '新建设定'}
                    </button>
                  </div>
                </div>
                <div className="library-toolbar">
                  <div className="search-field">
                    <Search size={16} />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="搜索名称、正文或标签…"
                    />
                  </div>
                  {view === 'lore' && (
                    <select
                      aria-label="按类型筛选"
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value)}
                    >
                      <option value="all">所有设定类型</option>
                      {getEntityTypes(world)
                        .map((t) => [t.id, t.name])
                        .filter(([k]) => k !== 'character')
                        .map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                    </select>
                  )}
                  <span className="muted">
                    {
                      entities.filter((e) =>
                        view === 'characters' ? e.type === 'character' : e.type !== 'character',
                      ).length
                    }{' '}
                    个条目
                  </span>
                </div>
                <div className={`entity-grid ${view === 'characters' ? 'character-grid' : ''}`}>
                  {searchResults
                    .filter(
                      (e) =>
                        (view === 'characters' ? e.type === 'character' : e.type !== 'character') &&
                        (typeFilter === 'all' || e.type === typeFilter),
                    )
                    .map((e, i) => (
                      <EntityCard
                        entity={e}
                        world={world}
                        key={e.id}
                        index={i}
                        onOpen={openEntity}
                      />
                    ))}
                </div>
                {!searchResults.some(
                  (e) =>
                    (view === 'characters' ? e.type === 'character' : e.type !== 'character') &&
                    (typeFilter === 'all' || e.type === typeFilter),
                ) && (
                  <Empty
                    title="这里还没有设定"
                    description="换一个搜索条件，或创建新的世界片段。"
                    action={
                      <button
                        className="btn"
                        onClick={() =>
                          view === 'characters' ? createEntity('character') : setNewOpen(true)
                        }
                      >
                        创建条目
                      </button>
                    }
                  />
                )}
              </>
            ) : view === 'relations' ? (
              <RelationshipGraph
                world={world}
                onPositions={(positions) =>
                  setData((prev) => ({
                    ...prev,
                    entities: prev.entities.map((e) =>
                      positions[e.id] &&
                      access.update(e.type === 'character' ? 'characters' : 'lore', e)
                        ? { ...e, graphPosition: positions[e.id] }
                        : e,
                    ),
                  }))
                }
                key={activeId}
                entities={entities}
                relations={relations}
                worldId={activeId}
                onChange={(next) => changeScoped('relations', next)}
                onOpen={openEntity}
              />
            ) : view === 'plots' ? (
              <PlotBoard
                key={activeId}
                plots={plots}
                variables={variables}
                entities={entities}
                worldId={activeId}
                onChange={(next) => changeScoped('plots', next)}
                onVariables={changeVariables}
                onOpen={openEntity}
              />
            ) : (
              <Sessions
                key={activeId}
                sessions={sessions}
                entities={entities}
                worldId={activeId}
                onChange={(next) => changeScoped('sessions', next)}
                onOpen={openEntity}
                onDirty={setEditorDirty}
              />
            )}
          </div>
          <footer className="workspace-footer">
            <span>{BRAND_EYEBROW} · 为尚未发生的故事</span>
            <span>
              {initial.mode === 'mysql'
                ? 'MySQL 已连接'
                : initial.mode === 'sqlite'
                  ? '本地数据库已连接'
                  : '演示模式'}
              <i /> {world.system}
            </span>
          </footer>
        </main>
        {notice && (
          <div className="toast" role="status">
            <CheckCheck size={17} />
            {notice}
            <button className="icon-btn" aria-label="关闭提示" onClick={() => setNotice('')}>
              <X size={14} />
            </button>
          </div>
        )}
        {searchOpen && (
          <Modal title="搜索世界档案" onClose={() => setSearchOpen(false)}>
            <div className="form-stack">
              <div className="search-field large">
                <Search size={18} />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="输入人物、地点、标签或正文片段…"
                />
              </div>
              <div className="search-results">
                {searchResults.map((e) => (
                  <button key={e.id} onClick={() => openEntity(e.id)}>
                    <div className="result-icon">
                      <FileText size={18} />
                    </div>
                    <div>
                      <strong>{e.name}</strong>
                      <small>{e.summary}</small>
                    </div>
                    <span className="badge">{getEntityTypeLabel(world, e.type)}</span>
                  </button>
                ))}
                {!searchResults.length && (
                  <Empty title="没有找到相关设定" description="试试更简短的关键词。" />
                )}
              </div>
            </div>
          </Modal>
        )}
        {newOpen && (
          <Modal title="新的世界片段" onClose={() => setNewOpen(false)} wide>
            <div className="type-picker">
              {getEntityTypes(world)
                .filter((t) => access.create(t.id === 'character' ? 'characters' : 'lore'))
                .map(({ id: type, name: label, description }) => {
                  const Icon = typeIcons[type as EntityType] || BookOpen;
                  return (
                    <button key={type} onClick={() => createEntity(type as EntityType)}>
                      <Icon size={22} strokeWidth={1.4} />
                      <strong>{label}</strong>
                      <span>
                        {description || '使用结构化模板'}
                        <ArrowRight size={13} />
                      </span>
                    </button>
                  );
                })}
            </div>
          </Modal>
        )}
        {exportOpen && (
          <ExportDialog data={data} worldId={activeId} onClose={() => setExportOpen(false)} />
        )}
        {settings && (
          <Modal title="工作台与后台设置" onClose={() => setSettings(false)}>
            <div className="form-stack">
              {access.owner && (
                <div className="settings-group">
                  <h3>世界管理</h3>
                  <button
                    className="btn"
                    onClick={() => {
                      setWorldForm({ ...world });
                      setSettings(false);
                    }}
                  >
                    <Settings2 size={16} /> 编辑当前世界
                  </button>
                  <button className="btn" onClick={startWorld}>
                    <Plus size={16} /> 创建空白世界
                  </button>
                </div>
              )}
              {access.owner && (
                <div className="settings-group">
                  <h3>创作内容的 JSON 导出与导入</h3>
                  <p className="muted">
                    JSON包含所有世界、地图和设定，不含账号、权限和原图。升级或迁机请使用下方“完整备份”，它会自动验证恢复。
                  </p>
                  <button className="btn" onClick={backup}>
                    <Download size={16} /> 导出创作 JSON
                  </button>
                  <button
                    className="btn"
                    disabled={status !== 'saved' || editorDirty}
                    onClick={() => importRef.current?.click()}
                  >
                    <Upload size={16} /> 从 JSON 备份恢复
                  </button>
                  <input
                    hidden
                    ref={importRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => void readBackup(e.target.files?.[0])}
                  />
                </div>
              )}
              <div className="settings-group">
                <h3>当前连接</h3>
                <p className="muted">
                  {initial.mode === 'mysql'
                    ? '数据保存于 MySQL 数据库，使用版本检查保护并发修改。'
                    : initial.mode === 'sqlite'
                      ? '数据保存在安装目录中的 SQLite 本地数据库，使用事务和版本检查保护修改。'
                      : '演示数据保存在服务器本机文件中。'}
                </p>
                <p className="muted">
                  当前账户：{access.actor.username} ·{' '}
                  {access.owner ? '主管理员' : access.administrator ? '次级管理员' : '普通用户'}
                  。普通用户只看到获准查看的内容，私密内容由服务端筛选。
                </p>
                <button
                  className="text-btn"
                  disabled={status !== 'saved' || editorDirty}
                  title={
                    status !== 'saved' || editorDirty
                      ? '请先保存编辑器内容并等待写入完成'
                      : undefined
                  }
                  onClick={async () => {
                    try {
                      await request('/api/logout', { method: 'POST' });
                      onLogout();
                    } catch (e) {
                      setNotice((e as Error).message);
                    }
                  }}
                >
                  <LogOut size={15} /> 退出工作台
                </button>
              </div>
              {managed && !access.owner && <AccountSettings />}
              {managed && access.administrator && <UserManagement data={data} />}
              {managed && access.owner && (
                <AdminSettings
                  revision={revision.current}
                  canReset={status === 'saved' && !editorDirty}
                  onSettings={onSettings}
                  onReset={(result) => {
                    const envelope = result.envelope;
                    replaceSaved(envelope);
                    setWorldId(envelope.data.worlds[0]?.id || '');
                    setSelectedEntity(null);
                    setSelectedMap(undefined);
                    setView('dashboard');
                    setSettings(false);
                    setNotice(resetNotice(result));
                  }}
                />
              )}
            </div>
          </Modal>
        )}
        {templateType && (
          <TemplateSettings
            world={world}
            initialType={templateType}
            onDirty={setEditorDirty}
            onClose={() => setTemplateType(undefined)}
            onApply={(type, fields) => {
              setData((previous) => applyEntityTemplate(previous, activeId, type, fields));
              setTemplateType(undefined);
              setEditorDirty(false);
              setNotice('模板已应用到当前工作区，正在保存。请等待所有更改已保存。');
            }}
          />
        )}
        {typeSettings && (
          <TypeSettings
            world={world}
            onDirty={setEditorDirty}
            onClose={() => setTypeSettings(false)}
            onApply={(types) => {
              setData((previous) => applyEntityTypes(previous, activeId, types));
              setTypeSettings(false);
              setEditorDirty(false);
              setTypeFilter('all');
              setNotice('类型列表已应用，正在保存。');
            }}
          />
        )}
        {tourOpen && (
          <ToolTour
            key="full"
            hasWorld
            onHighlight={(selector) =>
              setMobile(window.innerWidth <= 1100 && /sidebar|world-switch/.test(selector))
            }
            onNavigate={(next) => navigate(next as View, true)}
            onFinish={finishTour}
          />
        )}
        {worldForm && (
          <Modal
            title={data.worlds.some((w) => w.id === worldForm.id) ? '编辑世界' : '创建一个新的世界'}
            onClose={() => setWorldForm(null)}
          >
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                const w = { ...worldForm, name: worldForm.name.trim() };
                setData((prev) => ({
                  ...prev,
                  worlds: prev.worlds.some((item) => item.id === w.id)
                    ? prev.worlds.map((item) => (item.id === w.id ? w : item))
                    : [...prev.worlds, w],
                }));
                setWorldId(w.id);
                setWorldForm(null);
                setSelectedMap(undefined);
                navigate('overview');
              }}
            >
              <label className="field">
                世界名称
                <input
                  value={worldForm.name}
                  required
                  onChange={(e) => setWorldForm({ ...worldForm, name: e.target.value })}
                  placeholder="你的世界叫什么名字？"
                />
              </label>
              <label className="field">
                时代 / 副标题
                <input
                  value={worldForm.subtitle}
                  onChange={(e) => setWorldForm({ ...worldForm, subtitle: e.target.value })}
                  placeholder="例如：余烬纪元"
                />
              </label>
              <label className="field">
                世界简介
                <textarea
                  rows={4}
                  value={worldForm.description}
                  onChange={(e) => setWorldForm({ ...worldForm, description: e.target.value })}
                />
              </label>
              <label className="field">
                规则体系
                <input
                  value={worldForm.system}
                  onChange={(e) => setWorldForm({ ...worldForm, system: e.target.value })}
                />
              </label>
              <button className="btn primary" disabled={!worldForm.name.trim()}>
                保存世界
              </button>
            </form>
          </Modal>
        )}
        {restore && (
          <Modal title="恢复完整备份" onClose={() => setRestore(null)}>
            <div className="form-stack">
              <p>
                这份备份包含 {restore.worlds.length}{' '}
                个世界。恢复后将替换当前工作区的全部内容。建议先下载当前备份。
              </p>
              <button className="btn" onClick={backup}>
                先下载当前备份
              </button>
              <button
                className="btn primary"
                disabled={restoring}
                onClick={async () => {
                  setRestoring(true);
                  try {
                    const result = await request<WorkspaceEnvelope>('/api/backup', {
                      method: 'PUT',
                      body: JSON.stringify({ data: restore, revision: revision.current }),
                    });
                    replaceSaved(result);
                    setWorldId(result.data.worlds[0]?.id || '');
                    setRestore(null);
                    setSettings(false);
                    navigate('overview');
                    setNotice('备份恢复成功');
                  } catch (e) {
                    setNotice((e as Error).message);
                  } finally {
                    setRestoring(false);
                  }
                }}
              >
                {restoring ? '校验与恢复中…' : '确认替换并恢复'}
              </button>
            </div>
          </Modal>
        )}
      </div>
    </EntityTooltipProvider>
  );
}

function EntityCard({
  entity: e,
  world,
  index = 0,
  onOpen,
}: {
  entity: Entity;
  world: World;
  index?: number;
  onOpen: (id: string) => void;
}) {
  const Icon = typeIcons[e.type] || BookOpen;
  return (
    <article className={`entity-card ${e.type === 'character' ? 'character-card' : ''}`}>
      <div
        className={`card-art art-${e.type === 'character' ? index % 4 : e.type === 'magic' ? 'magic' : 'paper'}`}
      >
        {e.type === 'character' ? (
          e.portrait ? (
            <img src={e.portrait} alt={`${e.name}立绘`} />
          ) : (
            <>
              <span className="character-monogram">{e.name.slice(0, 1)}</span>
              <span className="character-role">
                {e.attributes['身份 / 职业'] || '等待书写的灵魂'}
              </span>
            </>
          )
        ) : e.cover ? (
          <img src={e.cover} alt={`${e.name}封面`} />
        ) : (
          <Icon size={34} strokeWidth={1} />
        )}
        <span className="art-index">
          {e.type === 'character' ? 'CHARACTER FILE' : getEntityTypeLabel(world, e.type)}
        </span>
      </div>
      <div className="entity-card-body">
        <div className="card-meta">
          <span>{getEntityTypeLabel(world, e.type)}</span>
          <VisibilityBadge value={e.visibility} />
          <span className={`status-dot ${e.status}`}>
            {e.status === 'complete' ? '已完善' : '草稿'}
          </span>
        </div>
        <h3>
          <EntityLink entity={e} onOpen={onOpen} />
        </h3>
        <p>{e.summary || '还没有摘要，点击条目开始书写。'}</p>
        <div className="card-bottom">
          <div className="tag-row">
            {e.tags.slice(0, 2).map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <button className="icon-btn" aria-label={`打开${e.name}`} onClick={() => onOpen(e.id)}>
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </article>
  );
}

function Overview({
  world,
  entities,
  maps,
  plots,
  sessions,
  onNavigate,
  onOpen,
  onMap,
  onSettings,
  onCreate,
}: {
  world: World;
  entities: Entity[];
  maps: Workspace['maps'];
  plots: Workspace['plots'];
  sessions: Workspace['sessions'];
  onNavigate: (view: View) => void;
  onOpen: (id: string) => void;
  onMap: (id: string) => void;
  onSettings: () => void;
  onCreate: () => void;
}) {
  const access = useAccess();
  const featured = maps.find((m) => m.kind === 'world') || maps[0];
  const chars = entities.filter((e) => e.type === 'character');
  const recent = [...entities].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  const stats = [
    {
      icon: BookOpen,
      n: entities.filter((e) => e.type !== 'character').length,
      label: '世界设定',
      to: 'lore',
    },
    { icon: Users, n: chars.length, label: '鲜活人物', to: 'characters' },
    { icon: Map, n: maps.length, label: '探索地图', to: 'atlas' },
    { icon: GitBranch, n: plots.length, label: '故事路线', to: 'plots' },
  ] as const;
  return (
    <>
      <div className="overview-heading">
        <div>
          <div className="eyebrow">
            <span className="tiny-diamond" /> YOUR WORLD, UNFOLDING
          </div>
          <h1>
            {world.name}
            <span>·</span>
            {world.subtitle || '新的篇章'}
          </h1>
          <p>{world.description || '一片尚未被命名的天地。为它写下第一段故事。'}</p>
          <div className="world-tags">
            <span>
              <Globe2 size={12} /> {world.system}
            </span>
            <span>
              <Feather size={12} /> 持续创作中
            </span>
          </div>
        </div>
        <button className="btn edit-world" disabled={!access.owner} onClick={onSettings}>
          <Settings2 size={15} /> 世界设置
        </button>
      </div>
      <div className="stats-row">
        {stats.map(({ icon: Icon, n, label, to }) => (
          <button key={to} onClick={() => onNavigate(to)}>
            <span className="stat-icon">
              <Icon size={21} strokeWidth={1.5} />
            </span>
            <span className="stat-number">{String(n).padStart(2, '0')}</span>
            <span className="stat-label">{label}</span>
            <ArrowRight size={14} />
          </button>
        ))}
      </div>
      <div className="overview-grid">
        <section className="atlas-feature">
          <div className="section-top">
            <h2>
              <Compass size={18} /> 世界地图
            </h2>
            <button className="text-btn" onClick={() => onNavigate('atlas')}>
              进入地图工坊 <ArrowRight size={14} />
            </button>
          </div>
          {featured ? (
            <button
              className="map-preview"
              onClick={() => onMap(featured.id)}
              aria-label={`打开${featured.name}`}
            >
              <svg
                viewBox={`0 0 ${featured.width} ${featured.height}`}
                preserveAspectRatio="xMidYMid slice"
              >
                <TerrainArtwork map={featured} />
                {featured.pins.map((p) => (
                  <g key={p.id} transform={`translate(${p.x},${p.y})`}>
                    <circle r="10" fill="#fcf4db" stroke="#5d6852" strokeWidth="2" />
                    <circle r="3" fill="#56705c" />
                    <text
                      x="16"
                      y="5"
                      fontSize="20"
                      fill="#364937"
                      style={{
                        paintOrder: 'stroke',
                        stroke: '#eae8c8',
                        strokeWidth: 5,
                        fontFamily: 'serif',
                      }}
                    >
                      {p.label}
                    </text>
                  </g>
                ))}
              </svg>
              <div className="map-vignette" />
              <span className="map-title">
                <small>THE ATLAS OF</small>
                <strong>{featured.name}</strong>
                <span>
                  {featured.pins.length} 个地图标记 · {maps.length} 个关联地图
                </span>
              </span>
              <span className="map-compass">
                N<br />
                <Compass size={37} strokeWidth={1} />
              </span>
              <span className="map-open">
                <ArrowRight size={18} />
              </span>
            </button>
          ) : (
            <div className="map-empty">
              <Compass size={50} strokeWidth={1} />
              <h3>未曾踏足的世界</h3>
              <button className="btn" onClick={() => onNavigate('atlas')}>
                绘制第一张地图
              </button>
            </div>
          )}
          <div className="map-caption">
            <span>
              <span className="tiny-dot" /> 地图中的每一处，都可以成为故事的起点
            </span>
            <span>WORLD ATLAS / 01</span>
          </div>
        </section>
        <section className="recent-panel">
          <div className="section-top">
            <h2>最近书写</h2>
            <button
              className="icon-btn"
              aria-label="查看全部设定"
              onClick={() => onNavigate('lore')}
            >
              <ArrowRight size={17} />
            </button>
          </div>
          <div className="recent-list">
            {recent.map((e, i) => {
              const Icon = typeIcons[e.type] || BookOpen;
              return (
                <div className="recent-item" key={e.id}>
                  <span className={`recent-icon recent-${i}`}>
                    <Icon size={19} strokeWidth={1.5} />
                  </span>
                  <div>
                    <h3>
                      <EntityLink entity={e} onOpen={onOpen} />
                    </h3>
                    <p>
                      {getEntityTypeLabel(world, e.type)}
                      <span>·</span>
                      {new Date(e.updatedAt).toLocaleDateString('zh-CN', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                  <ChevronRight size={15} />
                </div>
              );
            })}
            {!recent.length && <p className="muted">你的第一篇设定，将从这里开始。</p>}
          </div>
          <button className="new-inspiration" onClick={onCreate}>
            <Plus size={18} />
            <span>记下一闪而过的灵感</span>
          </button>
        </section>
      </div>
      <div className="lower-grid">
        <section>
          <div className="section-top">
            <h2>故事中的人</h2>
            <button className="text-btn" onClick={() => onNavigate('characters')}>
              全部角色 <ArrowRight size={14} />
            </button>
          </div>
          <div className="people-strip">
            {chars.slice(0, 3).map((e, i) => (
              <div className={`person-mini person-${i}`} key={e.id}>
                <div className={`avatar avatar-${i}`}>
                  {e.portrait ? <img src={e.portrait} alt="" /> : e.name[0]}
                </div>
                <div>
                  <h3>
                    <EntityLink entity={e} onOpen={onOpen} />
                  </h3>
                  <p>{e.attributes['身份 / 职业'] || e.tags[0] || '角色档案'}</p>
                </div>
                <ArrowRight size={14} />
              </div>
            ))}
            {!chars.length && (
              <button className="new-inspiration" onClick={() => onNavigate('characters')}>
                <Plus size={18} /> 创建第一个角色
              </button>
            )}
          </div>
        </section>
        <section className="next-session">
          <div className="section-top">
            <h2>下一段冒险</h2>
            <span className="badge">
              {sessions.some((s) => s.status === 'planned') ? '准备中' : '等待启程'}
            </span>
          </div>
          <h3>{sessions.find((s) => s.status === 'planned')?.title || '属于你们的故事'}</h3>
          <p>
            <CalendarDays size={14} />
            {sessions.find((s) => s.status === 'planned')?.date || '创建跑团计划，记录每次冒险'}
          </p>
          <button className="text-btn" onClick={() => onNavigate('journal')}>
            打开团务日志 <ArrowRight size={14} />
          </button>
        </section>
      </div>
    </>
  );
}
