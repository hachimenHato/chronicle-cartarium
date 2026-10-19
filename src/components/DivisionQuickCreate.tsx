import { useState } from 'react';
import { type Entity, type World } from '../../shared/model';
import { getEntityTemplate, newEntity } from '../../shared/entity-templates';
import { divisionLabels, divisionEntityTypes, type DivisionKind } from '../../shared/cartography';
import { Modal } from './Common';

export function DivisionQuickCreate({
  kind,
  worldId,
  world,
  entities,
  onCreate,
  onClose,
  initialName,
}: {
  kind: DivisionKind;
  worldId: string;
  world?: World;
  entities: Entity[];
  onCreate: (entity: Entity) => boolean;
  onClose: () => void;
  initialName?: string;
}) {
  const [entity, setEntity] = useState(() => ({
    ...newEntity(worldId, divisionEntityTypes[kind], world),
    ...(initialName ? { name: initialName } : {}),
  }));
  const [error, setError] = useState('');
  const label = divisionLabels[kind];
  return (
    <Modal title={`快速创建${label}`} onClose={onClose}>
      <form
        className="division-quick-form"
        onSubmit={(event) => {
          event.preventDefault();
          const name = entity.name.trim();
          if (!name) {
            setError('请输入名称。');
            return;
          }
          if (
            entities.some(
              (e) =>
                e.worldId === worldId &&
                e.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
            )
          ) {
            setError('这个世界已存在同名条目，请使用不同名称或关联已有条目。');
            return;
          }
          if (
            onCreate({
              ...entity,
              name,
              summary: entity.summary.trim(),
              updatedAt: new Date().toISOString(),
            })
          )
            onClose();
          else setError('分区数量已达到上限，请先删除不需要的分区。');
        }}
      >
        <p className="atlas-subtle">
          创建后直接关联到当前地图，再选择区域分配归属。详细设定可随时打开条目补充。
        </p>
        <label>
          {label}名称
          <input
            className="field"
            required
            maxLength={240}
            value={entity.name}
            onChange={(e) => setEntity({ ...entity, name: e.target.value })}
          />
        </label>
        <label>
          摘要
          <textarea
            className="field"
            rows={3}
            maxLength={2000}
            value={entity.summary}
            onChange={(e) => setEntity({ ...entity, summary: e.target.value })}
          />
        </label>
        {getEntityTemplate(world, entity.type)
          .slice(0, 2)
          .map((key) => (
            <label key={key}>
              {key}
              <textarea
                className="field"
                rows={2}
                maxLength={10000}
                value={entity.attributes[key]}
                onChange={(e) =>
                  setEntity({
                    ...entity,
                    attributes: { ...entity.attributes, [key]: e.target.value },
                  })
                }
              />
            </label>
          ))}
        <label>
          内容标记
          <select
            className="field"
            value={entity.visibility}
            onChange={(e) =>
              setEntity({ ...entity, visibility: e.target.value as Entity['visibility'] })
            }
          >
            <option value="public">公开内容</option>
            <option value="gm">GM 私密内容</option>
          </select>
        </label>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" type="submit">
            创建并关联{label}
          </button>
        </div>
      </form>
    </Modal>
  );
}
