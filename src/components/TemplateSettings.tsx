import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  entityLabels,
  entityTemplates,
  makeId,
  type EntityType,
  type World,
} from '../../shared/model';
import {
  getEntityTemplate,
  validTemplateFieldName,
  TEMPLATE_FIELD_LIMIT,
  TEMPLATE_FIELD_NAME_LIMIT,
  type TemplateFieldDraft,
} from '../../shared/entity-templates';
import { Modal } from './Common';
import { useUnsavedDraft } from '../lib/useUnsavedDraft';
import './TemplateSettings.css';
import { getEntityTypes } from '../../shared/entity-types';

export function TemplateSettings({
  world,
  initialType,
  onApply,
  onClose,
  onDirty,
}: {
  world: World;
  initialType: EntityType;
  onApply: (type: EntityType, fields: TemplateFieldDraft[]) => void;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [type, setType] = useState(initialType);
  const load = (kind: EntityType) =>
    getEntityTemplate(world, kind).map((name) => ({
      id: makeId('field'),
      originalName: name,
      name,
    }));
  const [fields, setFields] = useState<TemplateFieldDraft[]>(() => load(initialType));
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const original = getEntityTemplate(world, type);
  const dirty =
    Boolean(newName) ||
    JSON.stringify(fields.map((field) => [field.originalName, field.name])) !==
      JSON.stringify(original.map((name) => [name, name]));
  useUnsavedDraft(dirty, onDirty);
  const discard = () => !dirty || window.confirm('模板还有未应用的修改。放弃这些修改？');
  const close = () => {
    if (discard()) onClose();
  };
  const move = (index: number, delta: number) =>
    setFields((current) => {
      const result = [...current];
      [result[index], result[index + delta]] = [result[index + delta], result[index]];
      return result;
    });
  return (
    <Modal title="模板设置" onClose={close} wide>
      <form
        className="template-settings"
        onSubmit={(event) => {
          event.preventDefault();
          if (newName.trim()) {
            setError('请先添加新增字段，或清空新增字段名称，再应用模板。');
            return;
          }
          try {
            onApply(type, fields);
          } catch (issue) {
            setError((issue as Error).message);
          }
        }}
      >
        <div className="template-setting-heading">
          <label className="field">
            设定类型
            <select
              value={type}
              onChange={(event) => {
                if (!discard()) return;
                const next = event.target.value as EntityType;
                setType(next);
                setFields(load(next));
                setNewName('');
                setError('');
              }}
            >
              {getEntityTypes(world).map(({ id: key, name: label }) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div>
            <strong>{world.name}</strong>
            <p>
              模板仅用于当前世界的这类设定。新增、改名和排序会同步到该类已有条目；移除项中已填写的内容保留为条目额外字段。
            </p>
          </div>
        </div>
        <div className="template-field-list">
          {fields.map((field, index) => (
            <div className="template-field-row" key={field.id} data-field-name={field.name}>
              <span className="template-field-number">{String(index + 1).padStart(2, '0')}</span>
              <input
                aria-label={`字段名称 ${field.originalName || `新字段 ${index + 1}`}`}
                value={field.name}
                maxLength={TEMPLATE_FIELD_NAME_LIMIT}
                onChange={(event) =>
                  setFields((current) =>
                    current.map((item) =>
                      item.id === field.id ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
              />
              <div className="template-field-actions">
                <button
                  type="button"
                  className="icon-btn"
                  disabled={index === 0}
                  aria-label={`上移字段 ${field.name}`}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={index === fields.length - 1}
                  aria-label={`下移字段 ${field.name}`}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn danger"
                  aria-label={`移除字段 ${field.name}`}
                  onClick={() =>
                    setFields((current) => current.filter((item) => item.id !== field.id))
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
          {!fields.length && (
            <p className="template-empty">模板没有通用字段。可以从下方添加，或恢复默认字段。</p>
          )}
        </div>
        <div className="template-add-field">
          <label className="field">
            新增字段名称
            <input
              placeholder="例如：外貌描写、信仰、口头禅"
              value={newName}
              maxLength={TEMPLATE_FIELD_NAME_LIMIT}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={fields.length >= TEMPLATE_FIELD_LIMIT || !newName.trim()}
            onClick={() => {
              const name = newName.trim();
              if (!validTemplateFieldName(name)) {
                setError('字段名称不能包含换行、控制字符或保留名称。');
                return;
              }
              if (fields.some((field) => field.name.trim() === name)) {
                setError('字段名称不能重复。');
                return;
              }
              setFields((current) => [...current, { id: makeId('field'), name }]);
              setNewName('');
              setError('');
            }}
          >
            <Plus size={15} />
            添加字段
          </button>
        </div>
        <div className="template-setting-footer">
          <span>
            {fields.length} / {TEMPLATE_FIELD_LIMIT} 个字段
          </span>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              setFields(
                (entityTemplates[type] ?? []).map((name) => ({
                  id: makeId('field'),
                  originalName: original.includes(name) ? name : undefined,
                  name,
                })),
              );
              setNewName('');
              setError('');
            }}
          >
            <RotateCcw size={14} />
            恢复默认字段
          </button>
        </div>
        <p className="template-save-hint">
          应用后自动保存。请等待页面显示“所有更改已保存”再关闭网页；取消不会修改模板。
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={close}>
            取消
          </button>
          <button className="btn primary">应用模板</button>
        </div>
      </form>
    </Modal>
  );
}
