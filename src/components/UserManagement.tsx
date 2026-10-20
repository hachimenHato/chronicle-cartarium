import { useEffect, useState } from 'react';
import { Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import type { Workspace } from '../../shared/model';
import { getEntityTypeLabel } from '../../shared/entity-types';
import {
  moduleLabels,
  type ContentModule,
  type EditScope,
  type RecordGrant,
  type UserAccount,
  type UserDirectory,
} from '../../shared/access';
import { request } from '../lib/api';
import { useAccess } from './AccessContext';

const roleLabels = { owner: '主管理员', moderator: '次级管理员', user: '普通用户' };
const emptyUser = (): UserAccount => ({
  id: '',
  username: '',
  role: 'user',
  disabled: false,
  grants: {},
  records: {},
  canExport: false,
  canViewPrivate: false,
  tourCompleted: false,
});
export function UserManagement({
  data,
  onModeChanged,
  loginEnabled,
}: {
  data: Workspace;
  onModeChanged?: () => void;
  loginEnabled?: boolean;
}) {
  const access = useAccess();
  const [directory, setDirectory] = useState<UserDirectory>();
  const [draft, setDraft] = useState<UserAccount>();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [recordId, setRecordId] = useState('');
  const load = () =>
    request<UserDirectory>('/api/admin/users')
      .then(setDirectory)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, [loginEnabled]);
  const perform = async (action: () => Promise<UserDirectory>, message: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setDirectory(await action());
      setNotice(message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const records = [
    ...data.entities.map((e) => ({
      id: e.id,
      name: e.name,
      worldId: e.worldId,
      module:
        e.type === 'character'
          ? '角色'
          : getEntityTypeLabel(
              data.worlds.find((w) => w.id === e.worldId),
              e.type,
            ),
      visibility: e.visibility,
    })),
    ...data.maps.map((e) => ({
      id: e.id,
      name: e.name,
      worldId: e.worldId,
      module: '地图',
      visibility: e.visibility,
    })),
    ...data.plots.map((e) => ({
      id: e.id,
      name: e.name,
      worldId: e.worldId,
      module: '剧情',
      visibility: e.visibility,
    })),
    ...data.relations.map((e) => ({
      id: e.id,
      name: `${data.entities.find((v) => v.id === e.sourceId)?.name ?? '人物'} → ${data.entities.find((v) => v.id === e.targetId)?.name ?? '人物'}：${e.label}`,
      worldId: e.worldId,
      module: '关系',
      visibility: e.visibility,
    })),
    ...data.sessions.map((e) => ({
      id: e.id,
      name: e.title,
      worldId: e.worldId,
      module: '日志',
      visibility: e.visibility,
    })),
    ...data.variables.map((e) => ({
      id: e.id,
      name: e.name,
      worldId: e.worldId,
      module: '变量',
      visibility: e.visibility,
    })),
  ];
  const updateOverride = (id: string, field: keyof RecordGrant, value: string) => {
    if (!draft) return;
    const next = { ...draft.records[id] };
    if (value === 'inherit') delete next[field];
    else next[field] = value === 'allow';
    const overrides = { ...draft.records };
    if (Object.keys(next).length) overrides[id] = next;
    else delete overrides[id];
    setDraft({ ...draft, records: overrides });
  };
  if (!directory)
    return (
      <div>
        {error ? (
          <p className="inline-error">{error}</p>
        ) : (
          <p className="muted">正在读取用户管理…</p>
        )}
      </div>
    );
  return (
    <section className="user-management settings-group">
      <h3>
        <Users size={18} /> 多用户管理
      </h3>
      <p className="muted">
        普通用户默认只读公开内容。次级管理员可管理全部创作内容、导出档案及用户权限；世界本身与系统配置仅主管理员可修改。
      </p>
      <label className="check-row">
        <input
          type="checkbox"
          checked={directory.enabled}
          disabled={!access.owner || busy || directory.loginEnabled === false}
          onChange={(e) => {
            const enabled = e.target.checked;
            const before = directory;
            setDirectory({ ...before, enabled });
            void perform(
              () =>
                request('/api/admin/users/mode', {
                  method: 'PUT',
                  body: JSON.stringify({ enabled, revision: before.revision }),
                }),
              enabled ? '多用户模式已开启。' : '多用户模式已关闭，其他账户不能继续访问。',
            ).then((ok) => {
              if (!ok) setDirectory(before);
              else onModeChanged?.();
            });
          }}
        />
        <span>开启多用户模式</span>
      </label>
      {directory.loginEnabled === false && (
        <p className="muted">
          请先在“登录与访问保护”中开启登录并设置账号密码，然后才能启用多用户。
        </p>
      )}
      <div className="user-account-list">
        {directory.users.map((u) => (
          <div key={u.id}>
            <span>
              <strong>{u.username}</strong>
              <small>
                {roleLabels[u.role]}
                {u.disabled ? ' · 已停用' : ''}
              </small>
            </span>
            {u.role !== 'owner' && (
              <>
                <button
                  className="btn"
                  disabled={busy || !directory.enabled}
                  onClick={() => {
                    setDraft(structuredClone(u));
                    setPassword('');
                    setError('');
                    setFilter('');
                    setRecordId('');
                  }}
                >
                  管理权限
                </button>
                <button
                  className="icon-btn danger"
                  aria-label={`删除用户 ${u.username}`}
                  disabled={u.id === access.actor.id || busy}
                  onClick={() => {
                    if (
                      window.confirm(`删除账户“${u.username}”？创作内容会保留，作者归属不会转移。`)
                    )
                      void perform(
                        () =>
                          request(`/api/admin/users/${u.id}`, {
                            method: 'DELETE',
                            body: JSON.stringify({ revision: directory.revision }),
                          }),
                        '账户已删除。',
                      );
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <button
        className="btn"
        disabled={!directory.enabled || busy}
        onClick={() => {
          setDraft(emptyUser());
          setPassword('');
          setError('');
        }}
      >
        <Plus size={16} /> 创建用户
      </button>
      {draft && (
        <form
          className="user-permission-editor form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(
              () =>
                request('/api/admin/users', {
                  method: 'PUT',
                  body: JSON.stringify({
                    id: draft.id || undefined,
                    username: draft.username,
                    role: draft.role,
                    disabled: draft.disabled,
                    grants: draft.grants,
                    records: draft.records,
                    canExport: draft.canExport,
                    canViewPrivate: draft.canViewPrivate,
                    password: password || undefined,
                    revision: directory.revision,
                  }),
                }),
              '用户与权限已保存。',
            ).then((ok) => {
              if (ok) {
                setDraft(undefined);
                setPassword('');
              }
            });
          }}
        >
          <h4>
            <ShieldCheck size={17} /> {draft.id ? `管理 ${draft.username}` : '创建新用户'}
          </h4>
          <div className="two-cols">
            <label className="field">
              用户名
              <input
                value={draft.username}
                required
                minLength={2}
                maxLength={40}
                autoComplete="off"
                onChange={(e) => setDraft({ ...draft, username: e.target.value })}
              />
            </label>
            <label className="field">
              账户级别
              <select
                value={draft.role}
                disabled={draft.id === access.actor.id}
                onChange={(e) =>
                  setDraft({ ...draft, role: e.target.value as UserAccount['role'] })
                }
              >
                <option value="user">普通用户</option>
                <option value="moderator">次级管理员</option>
              </select>
            </label>
          </div>
          <label className="field">
            {draft.id ? '新密码（留空保留原密码）' : '初始密码'}
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              required={!draft.id}
              minLength={10}
              maxLength={72}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={draft.disabled}
              disabled={draft.id === access.actor.id}
              onChange={(e) => setDraft({ ...draft, disabled: e.target.checked })}
            />
            停用账户
          </label>
          {draft.role === 'user' ? (
            <>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.canExport}
                  onChange={(e) => setDraft({ ...draft, canExport: e.target.checked })}
                />
                允许导出已获准查看的世界档案
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={draft.canViewPrivate}
                  onChange={(e) => setDraft({ ...draft, canViewPrivate: e.target.checked })}
                />
                允许查看全部 GM 私密内容（也可在下方按条目授权）
              </label>
              <div className="permission-table-wrap">
                <table className="permission-table">
                  <thead>
                    <tr>
                      <th>模块</th>
                      <th>创建</th>
                      <th>修改范围</th>
                      <th>删除范围</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(moduleLabels).map(([key, label]) => {
                      const module = key as ContentModule;
                      const grant = draft.grants[module] ?? {
                        create: false,
                        update: 'none',
                        delete: 'none',
                      };
                      return (
                        <tr key={key}>
                          <th>{label}</th>
                          <td>
                            <input
                              aria-label={`${label}创建权限`}
                              type="checkbox"
                              checked={grant.create}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  grants: {
                                    ...draft.grants,
                                    [key]: { ...grant, create: e.target.checked },
                                  },
                                })
                              }
                            />
                          </td>
                          {(['update', 'delete'] as const).map((action) => (
                            <td key={action}>
                              <select
                                aria-label={`${label}${action === 'update' ? '修改' : '删除'}范围`}
                                value={grant[action]}
                                onChange={(e) =>
                                  setDraft({
                                    ...draft,
                                    grants: {
                                      ...draft.grants,
                                      [key]: { ...grant, [action]: e.target.value as EditScope },
                                    },
                                  })
                                }
                              >
                                <option value="none">不允许</option>
                                <option value="own">仅自己的内容</option>
                                <option value="any">包括其他人的内容</option>
                              </select>
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <h4>单独授权</h4>
              <p className="muted">
                单独允许或禁止优先于模块权限。授权修改前需允许查看该条目；未设置的项沿用全局规则。
              </p>
              <input
                aria-label="搜索授权条目"
                placeholder="搜索条目、地图、剧情名称…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <select
                aria-label="选择授权条目"
                value={recordId}
                onChange={(e) => setRecordId(e.target.value)}
              >
                <option value="">选择一个创作条目</option>
                {records
                  .filter((r) => r.name.includes(filter) || r.module.includes(filter))
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {data.worlds.find((w) => w.id === r.worldId)?.name} / {r.module} / {r.name}{' '}
                      {r.visibility === 'public' ? '' : '（GM）'}
                    </option>
                  ))}
              </select>
              <div className="record-grants">
                {[...new Set([...Object.keys(draft.records), ...(recordId ? [recordId] : [])])].map(
                  (id) => (
                    <div key={id}>
                      <strong>{records.find((r) => r.id === id)?.name ?? '已删除条目'}</strong>
                      <div className="button-row">
                        {(['read', 'update', 'delete'] as const).map((action) => (
                          <label className="field" key={action}>
                            {action === 'read' ? '查看' : action === 'update' ? '修改' : '删除'}
                            <select
                              aria-label={`${records.find((r) => r.id === id)?.name} ${action}`}
                              value={
                                draft.records[id]?.[action] === undefined
                                  ? 'inherit'
                                  : draft.records[id][action]
                                    ? 'allow'
                                    : 'deny'
                              }
                              onChange={(e) => updateOverride(id, action, e.target.value)}
                            >
                              <option value="inherit">沿用整体权限</option>
                              <option value="allow">单独允许</option>
                              <option value="deny">单独禁止</option>
                            </select>
                          </label>
                        ))}
                      </div>
                    </div>
                  ),
                )}
              </div>
            </>
          ) : (
            <p className="muted">
              次级管理员具有所有创作模块的增删改查、导出和用户管理权限。不能创建、编辑、删除世界，也不能更改主题、后台名称、访问方式、数据库、备份迁移或初始化。
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setDraft(undefined)}
              disabled={busy}
            >
              取消编辑
            </button>
            <button className="btn primary" disabled={busy}>
              {busy ? '正在保存…' : '保存用户与权限'}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
          <button className="text-btn" onClick={() => void load()}>
            刷新用户列表
          </button>
        </p>
      )}
      {notice && (
        <p className="success-text" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
