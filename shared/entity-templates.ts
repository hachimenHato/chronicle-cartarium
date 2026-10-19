import {
  entityTemplates,
  makeId,
  type Entity,
  type EntityType,
  type World,
  type Workspace,
} from './model';

export const TEMPLATE_FIELD_LIMIT = 100;
export const TEMPLATE_FIELD_NAME_LIMIT = 200;
export function validTemplateFieldName(name: string) {
  return (
    Boolean(name.trim()) &&
    name === name.trim() &&
    name.length <= TEMPLATE_FIELD_NAME_LIMIT &&
    !/[\u0000-\u001f\u007f]/.test(name) &&
    !['__proto__', 'constructor', 'prototype'].includes(name)
  );
}
export function getEntityTemplate(world: World | undefined, type: EntityType): string[] {
  return [...(world?.entityTemplates?.[type] ?? entityTemplates[type] ?? [])];
}
export function newEntity(worldId: string, type: EntityType = 'location', world?: World): Entity {
  return {
    id: makeId('entity'),
    worldId,
    type,
    name: '',
    summary: '',
    content: '',
    tags: [],
    visibility: 'public',
    status: 'draft',
    attributes: Object.fromEntries(getEntityTemplate(world, type).map((name) => [name, ''])),
    updatedAt: new Date().toISOString(),
  };
}
export function entityAttributeEntries(entity: Entity, world?: World): [string, string][] {
  const fields = getEntityTemplate(world, entity.type);
  return [
    ...fields.map((name) => [name, entity.attributes[name] ?? '']),
    ...Object.entries(entity.attributes).filter(([name]) => !fields.includes(name)),
  ] as [string, string][];
}
export function orderedEntityAttributes(entity: Entity, world?: World): Record<string, string> {
  return Object.fromEntries(entityAttributeEntries(entity, world));
}
export interface TemplateFieldDraft {
  id: string;
  originalName?: string;
  name: string;
}

/** Applies a type template and its existing records together in the revision-checked workspace save. */
export function applyEntityTemplate(
  data: Workspace,
  worldId: string,
  type: EntityType,
  draft: TemplateFieldDraft[],
): Workspace {
  const world = data.worlds.find((item) => item.id === worldId);
  if (!world) throw new Error('当前世界不存在，请重新载入。');
  if (draft.length > TEMPLATE_FIELD_LIMIT) throw new Error('每种模板最多100个字段。');
  const fields = draft.map((field) => ({ ...field, name: field.name.trim() }));
  if (fields.some((field) => !validTemplateFieldName(field.name)))
    throw new Error('字段名称须为1–200个字符，不能包含换行、控制字符或保留名称。');
  if (new Set(fields.map((field) => field.name)).size !== fields.length)
    throw new Error('字段名称不能重复。');
  const previous = getEntityTemplate(world, type);
  const originals = fields.flatMap((field) => (field.originalName ? [field.originalName] : []));
  if (
    originals.some((name) => !previous.includes(name)) ||
    new Set(originals).size !== originals.length
  )
    throw new Error('模板已变化，请重新打开模板设置。');
  const used = new Set(originals);
  const now = new Date().toISOString();
  const entities = data.entities.map((entity) => {
    if (entity.worldId !== worldId || entity.type !== type) return entity;
    const extras = Object.entries(entity.attributes).filter(
      ([name, value]) => !used.has(name) && (!previous.includes(name) || Boolean(value.trim())),
    );
    const values = fields.map((field) => {
      let value = field.originalName
        ? (entity.attributes[field.originalName] ?? '')
        : (entity.attributes[field.name] ?? '');
      const collision = extras.find(([name]) => name === field.name);
      if (collision) {
        if (value.trim() && collision[1].trim() && value !== collision[1])
          throw new Error(
            `“${entity.name}”已有不同内容的“${field.name}”字段，请使用其他名称或先整理该条目。`,
          );
        if (!value.trim()) value = collision[1];
      }
      return [field.name, value] as const;
    });
    const names = new Set(fields.map((field) => field.name));
    const attributes = Object.fromEntries([
      ...values,
      ...extras.filter(([name]) => !names.has(name)),
    ]);
    if (Object.keys(attributes).length > TEMPLATE_FIELD_LIMIT)
      throw new Error(`“${entity.name}”连同保留字段超过100项，请先整理该条目。`);
    return JSON.stringify(attributes) === JSON.stringify(entity.attributes)
      ? entity
      : { ...entity, attributes, updatedAt: now };
  });
  return {
    ...data,
    entities,
    worlds: data.worlds.map((item) =>
      item.id === worldId
        ? {
            ...item,
            entityTemplates: { ...item.entityTemplates, [type]: fields.map((field) => field.name) },
          }
        : item,
    ),
  };
}
