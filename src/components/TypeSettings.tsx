import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { EntityTypeDefinition, World } from '../../shared/model';
import { entityLabels } from '../../shared/model';
import { getEntityTypes } from '../../shared/entity-types';
import { Modal } from './Common';
import { useUnsavedDraft } from '../lib/useUnsavedDraft';

export function TypeSettings({
  world,
  onApply,
  onClose,
  onDirty,
}: {
  world: World;
  onApply: (types: EntityTypeDefinition[]) => void;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [types, setTypes] = useState(() => structuredClone(getEntityTypes(world)));
  const [error, setError] = useState('');
  const dirty = JSON.stringify(types) !== JSON.stringify(getEntityTypes(world));
  useUnsavedDraft(dirty, onDirty);
  return (
    <Modal
      title="设定类型管理"
      onClose={() => {
        if (!dirty || window.confirm('类型列表还有未应用的修改，放弃修改？')) onClose();
      }}
      wide
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            onApply(types);
          } catch (issue) {
            setError((issue as Error).message);
          }
        }}
      >
        <p className="muted">
          为“{world.name}
          ”整理世界片段的分类。改名保留条目与模板；仍有条目的类型需先迁移条目，再移除。角色档案保持独立。
        </p>
        <div className="type-settings-list">
          {types.map((type) => (
            <div className="type-setting-row" key={type.id}>
              <label className="field">
                类型名称
                <input
                  aria-label={`类型名称 ${type.name}`}
                  value={type.name}
                  maxLength={60}
                  onChange={(e) =>
                    setTypes(
                      types.map((v) => (v.id === type.id ? { ...v, name: e.target.value } : v)),
                    )
                  }
                  required
                />
              </label>
              <label className="field">
                用途与创作提示
                <input
                  aria-label={`类型说明 ${type.name}`}
                  value={type.description}
                  maxLength={2000}
                  placeholder="例如：怪物习性、领主继承、冒险委托…"
                  onChange={(e) =>
                    setTypes(
                      types.map((v) =>
                        v.id === type.id ? { ...v, description: e.target.value } : v,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="icon-btn danger"
                aria-label={`移除类型 ${type.name}`}
                disabled={type.id === 'character'}
                onClick={() => setTypes(types.filter((v) => v.id !== type.id))}
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn"
          disabled={types.length >= 60}
          onClick={() =>
            setTypes([
              ...types,
              {
                id: `custom_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
                name: '',
                description: '',
              },
            ])
          }
        >
          <Plus size={16} /> 添加设定类型
        </button>
        {Object.keys(entityLabels).some((id) => !types.some((t) => t.id === id)) && (
          <label className="field">
            恢复内置类型
            <select
              value=""
              onChange={(e) => {
                const type = getEntityTypes().find((t) => t.id === e.target.value);
                if (type) setTypes([...types, type]);
              }}
            >
              <option value="">选择需要恢复的内置类型…</option>
              {getEntityTypes()
                .filter((t) => !types.some((v) => v.id === t.id))
                .map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary">应用类型列表</button>
        </div>
      </form>
    </Modal>
  );
}
