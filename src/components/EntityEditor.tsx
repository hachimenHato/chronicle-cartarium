import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Eye,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  Link2,
  UserRound,
  Settings2,
  X,
} from 'lucide-react';
import { type Entity, type EntityType, type World } from '../../shared/model';
import { getEntityTypes, getEntityTypeLabel } from '../../shared/entity-types';
import { useAccess } from './AccessContext';
import {
  getEntityTemplate,
  orderedEntityAttributes,
  entityAttributeEntries,
  validTemplateFieldName,
  TEMPLATE_FIELD_LIMIT,
  TEMPLATE_FIELD_NAME_LIMIT,
} from '../../shared/entity-templates';
import { Empty, EntityLink, VisibilityBadge, WikiContent } from './Common';
import { request } from '../lib/api';
import { useUnsavedDraft } from '../lib/useUnsavedDraft';
import { CoverPresets } from './CoverPresets';

export { newEntity } from '../../shared/entity-templates';
export default function EntityEditor({
  entity,
  entities,
  world,
  onTemplateSettings,
  onSave,
  onDelete,
  onBack,
  onOpen,
  onDirty,
}: {
  entity: Entity;
  entities: Entity[];
  world: World;
  onTemplateSettings: (type: EntityType) => void;
  onSave: (entity: Entity) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
  onOpen: (id: string) => void;
  onDirty: (value: boolean) => void;
}) {
  const access = useAccess();
  const module = entity.type === 'character' ? 'characters' : 'lore';
  const writable = entity.name ? access.update(module, entity) : access.create(module);
  const [draft, setDraft] = useState<Entity>(() => ({
    ...entity,
    attributes: orderedEntityAttributes(entity, world),
  }));
  const [editing, setEditing] = useState(!entity.name && writable);
  const [tab, setTab] = useState<'content' | 'attributes'>('content');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [custom, setCustom] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  useUnsavedDraft(
    uploading || (editing && JSON.stringify(draft) !== JSON.stringify(entity)),
    onDirty,
  );
  useEffect(() => {
    if (!editing) setDraft({ ...entity, attributes: orderedEntityAttributes(entity, world) });
  }, [entity, editing, world]);
  const templateFields = getEntityTemplate(world, draft.type);
  const update = (patch: Partial<Entity>) => setDraft((old) => ({ ...old, ...patch }));
  const backlinks = entities.filter(
    (e) =>
      e.id !== entity.id &&
      [...e.content.matchAll(/\[\[([^\]]+)\]\]/g)].some((match) => match[1].trim() === entity.name),
  );
  const save = () => {
    if (Object.keys(draft.attributes).length > TEMPLATE_FIELD_LIMIT) {
      setError('档案字段超过100项，请先移除不需要的条目额外字段。');
      return;
    }
    if (!draft.name.trim()) {
      setError('请填写条目名称');
      return;
    }
    if (entities.some((e) => e.id !== draft.id && e.name === draft.name.trim())) {
      setError('同一世界中已有这个名称，请使用不同名称以便准确关联');
      return;
    }
    onSave({ ...draft, name: draft.name.trim(), updatedAt: new Date().toISOString() });
    setEditing(false);
    setError('');
  };
  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const result = await request<{ url: string }>('/api/uploads', { method: 'POST', body });
      update(draft.type === 'character' ? { portrait: result.url } : { cover: result.url });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="entity-page">
      <div className="page-topline">
        <button className="text-btn" onClick={onBack}>
          <ArrowLeft size={16} /> 返回知识库
        </button>
        <div className="button-row">
          <button
            className="btn"
            disabled={editing || uploading || !access.administrator}
            title={
              editing
                ? '请先保存或取消条目编辑，再修改这类设定的模板'
                : '修改当前世界这类设定的通用字段'
            }
            onClick={() => onTemplateSettings(draft.type)}
          >
            <Settings2 size={15} />
            模板设置
          </button>
          {editing ? (
            <>
              <button
                className="btn"
                disabled={uploading}
                onClick={() => {
                  if (!entity.name) onBack();
                  else {
                    setDraft(entity);
                    setEditing(false);
                  }
                }}
              >
                取消
              </button>
              <button className="btn primary" onClick={save} disabled={uploading}>
                <Save size={15} /> 保存条目
              </button>
            </>
          ) : (
            <button className="btn" disabled={!writable} onClick={() => setEditing(true)}>
              <Pencil size={15} /> 编辑条目
            </button>
          )}
        </div>
      </div>
      <div className="entity-layout">
        <article className="article-sheet">
          <div className="eyebrow">
            <BookOpen size={13} /> 世界知识库 / {getEntityTypeLabel(world, draft.type)}
          </div>
          {editing ? (
            <>
              <label className="field">
                条目名称
                <input
                  className="title-input"
                  value={draft.name}
                  onChange={(e) => update({ name: e.target.value })}
                  placeholder="为这个设定起个名字"
                  maxLength={120}
                />
              </label>
              <label className="field">
                简要描述
                <textarea
                  rows={2}
                  value={draft.summary}
                  onChange={(e) => update({ summary: e.target.value })}
                  placeholder="用于搜索结果和悬浮预览"
                />
              </label>
            </>
          ) : (
            <>
              <h1>{draft.name}</h1>
              <p className="article-summary">{draft.summary || '这个故事，还在等待被书写。'}</p>
            </>
          )}
          <div className="tabs">
            <button className={tab === 'content' ? 'active' : ''} onClick={() => setTab('content')}>
              <BookOpen size={15} /> 正文内容
            </button>
            <button
              className={tab === 'attributes' ? 'active' : ''}
              onClick={() => setTab('attributes')}
            >
              <UserRound size={15} /> 设定档案{' '}
              <span>{Object.values(draft.attributes).filter(Boolean).length}</span>
            </button>
          </div>
          {tab === 'content' ? (
            editing ? (
              <>
                <div className="editor-hint">
                  支持 Markdown。输入 <code>[[条目名称]]</code> 建立关联。
                </div>
                <textarea
                  className="markdown-editor"
                  value={draft.content}
                  onChange={(e) => update({ content: e.target.value })}
                  placeholder="## 从这里开始书写\n\n描述它的来历、矛盾和那些不为人知的秘密……"
                />
                <label className="field">
                  插入关联
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value)
                        update({ content: draft.content + ` [[${e.target.value}]]` });
                    }}
                  >
                    <option value="">选择已有设定…</option>
                    {entities
                      .filter((e) => e.id !== entity.id)
                      .map((e) => (
                        <option key={e.id}>{e.name}</option>
                      ))}
                  </select>
                </label>
              </>
            ) : (
              <WikiContent
                content={draft.content || '暂无正文，点击“编辑条目”开始创作。'}
                entities={entities}
                onOpen={onOpen}
              />
            )
          ) : (
            <div className="attribute-list">
              {editing && (
                <p className="muted">
                  通用字段在“模板设置”中统一调整；这里可填写内容或添加条目额外字段。
                </p>
              )}
              {entityAttributeEntries(draft, world).map(([key, value]) => (
                <div key={key} className="attribute-item">
                  <label className="field">
                    <span>
                      {key}
                      {!templateFields.includes(key) && (
                        <small className="attribute-extra">条目额外字段</small>
                      )}
                    </span>
                    {editing ? (
                      <textarea
                        rows={3}
                        value={value}
                        onChange={(e) =>
                          update({ attributes: { ...draft.attributes, [key]: e.target.value } })
                        }
                      />
                    ) : (
                      <p>{value || '尚未填写'}</p>
                    )}
                  </label>
                  {editing && !templateFields.includes(key) && (
                    <button
                      className="icon-btn"
                      title={`删除字段 ${key}`}
                      onClick={() => {
                        const attrs = { ...draft.attributes };
                        delete attrs[key];
                        update({ attributes: attrs });
                      }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
              {editing && (
                <div className="inline-form">
                  <input
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    placeholder="添加自定义档案字段"
                    maxLength={TEMPLATE_FIELD_NAME_LIMIT}
                  />
                  <button
                    className="btn"
                    disabled={
                      !validTemplateFieldName(custom.trim()) ||
                      Object.hasOwn(draft.attributes, custom.trim()) ||
                      Object.keys(draft.attributes).length >= TEMPLATE_FIELD_LIMIT
                    }
                    onClick={() => {
                      update({ attributes: { ...draft.attributes, [custom.trim()]: '' } });
                      setCustom('');
                    }}
                  >
                    <Plus size={15} /> 添加
                  </button>
                </div>
              )}
            </div>
          )}
        </article>
        <aside className="detail-sidebar">
          {
            <div className="portrait-box">
              {(draft.type === 'character' ? draft.portrait : draft.cover) ? (
                <img
                  src={draft.type === 'character' ? draft.portrait : draft.cover}
                  alt={`${draft.name}的${draft.type === 'character' ? '立绘' : '封面'}`}
                />
              ) : (
                <div className="portrait-placeholder">
                  <UserRound size={54} strokeWidth={1} />
                  <span>{draft.type === 'character' ? '人物立绘' : '设定封面'}</span>
                </div>
              )}
              {editing && (
                <>
                  <label className="btn upload-btn">
                    <Upload size={15} />
                    {uploading ? '正在上传…' : draft.type === 'character' ? '上传立绘' : '上传封面'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={uploading}
                      onChange={(e) => upload(e.target.files?.[0])}
                    />
                  </label>
                  {draft.type !== 'character' && (
                    <CoverPresets value={draft.cover} onChoose={(cover) => update({ cover })} />
                  )}
                  {(draft.type === 'character' ? draft.portrait : draft.cover) && (
                    <button
                      className="text-btn danger"
                      onClick={() =>
                        update(
                          draft.type === 'character'
                            ? { portrait: undefined }
                            : { cover: undefined },
                        )
                      }
                    >
                      {draft.type === 'character' ? '移除立绘' : '移除封面'}
                    </button>
                  )}
                  <small>PNG / JPG / WebP · 最大 8 MB</small>
                </>
              )}
            </div>
          }
          <div className="panel metadata">
            <h3>条目信息</h3>
            {editing ? (
              <>
                <label className="field">
                  设定类型
                  <select
                    value={draft.type}
                    onChange={(e) => {
                      const type = e.target.value as EntityType;
                      update({
                        type,
                        attributes: {
                          ...Object.fromEntries(getEntityTemplate(world, type).map((k) => [k, ''])),
                          ...draft.attributes,
                        },
                      });
                    }}
                  >
                    {getEntityTypes(world)
                      .filter(
                        (t) =>
                          t.id === entity.type ||
                          access.create(t.id === 'character' ? 'characters' : 'lore'),
                      )
                      .map(({ id: k, name: v }) => (
                        <option value={k} key={k}>
                          {v}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  可见范围
                  <select
                    value={draft.visibility}
                    onChange={(e) => update({ visibility: e.target.value as Entity['visibility'] })}
                  >
                    <option value="public">玩家可见</option>
                    <option value="gm">仅 GM 可见</option>
                  </select>
                </label>
                <label className="field">
                  编写状态
                  <select
                    value={draft.status}
                    onChange={(e) => update({ status: e.target.value as Entity['status'] })}
                  >
                    <option value="draft">草稿</option>
                    <option value="complete">已完善</option>
                  </select>
                </label>
                <label className="field">
                  标签（用逗号分隔）
                  <input
                    value={draft.tags.join(', ')}
                    onChange={(e) =>
                      update({
                        tags: e.target.value
                          .split(/[,，]/)
                          .map((t) => t.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </label>
              </>
            ) : (
              <>
                <dl>
                  <dt>类型</dt>
                  <dd>{getEntityTypeLabel(world, draft.type)}</dd>
                  <dt>可见范围</dt>
                  <dd>{draft.visibility === 'gm' ? '仅 GM 可见' : '玩家可见'}</dd>
                  <dt>状态</dt>
                  <dd>{draft.status === 'draft' ? '正在构思' : '已完善'}</dd>
                  <dt>最后修改</dt>
                  <dd>{new Date(draft.updatedAt).toLocaleDateString('zh-CN')}</dd>
                </dl>
                <div className="tag-row">
                  {draft.tags.map((tag) => (
                    <span className="tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="panel metadata">
            <h3>
              <Link2 size={15} /> 反向链接 <span className="count">{backlinks.length}</span>
            </h3>
            {backlinks.length ? (
              backlinks.map((e) => (
                <div className="backlink" key={e.id}>
                  <EntityLink entity={e} onOpen={onOpen} />
                  <VisibilityBadge value={e.visibility} />
                </div>
              ))
            ) : (
              <p className="muted">其他条目引用这里时，会自动出现在此处。</p>
            )}
          </div>
          {entity.name &&
            (confirmDelete ? (
              <div className="panel delete-confirm">
                <p>删除后会清理关联关系与地图引用，正文引用会标记为未关联。</p>
                <button className="btn danger" onClick={() => onDelete(entity.id)}>
                  确认删除条目
                </button>
                <button className="text-btn" onClick={() => setConfirmDelete(false)}>
                  取消
                </button>
              </div>
            ) : (
              <button
                className="text-btn danger"
                disabled={!access.remove(module, entity)}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} /> 删除条目
              </button>
            ))}
        </aside>
      </div>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
