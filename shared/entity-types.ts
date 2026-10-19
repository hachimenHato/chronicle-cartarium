import {
  entityLabels,
  type EntityType,
  type EntityTypeDefinition,
  type World,
  type Workspace,
} from './model';

export function getEntityTypes(world?: World): EntityTypeDefinition[] {
  return (
    world?.entityTypes ??
    Object.entries(entityLabels).map(([id, name]) => ({
      id: id as EntityType,
      name,
      description: '',
    }))
  );
}
export function getEntityTypeLabel(world: World | undefined, type: EntityType): string {
  return (
    getEntityTypes(world).find((definition) => definition.id === type)?.name ??
    entityLabels[type] ??
    '自定义设定'
  );
}
export function isEntityType(value: string): value is EntityType {
  return Object.hasOwn(entityLabels, value) || /^custom_[a-zA-Z0-9_-]{1,23}$/.test(value);
}
export function applyEntityTypes(
  data: Workspace,
  worldId: string,
  definitions: EntityTypeDefinition[],
): Workspace {
  const world = data.worlds.find((w) => w.id === worldId);
  if (!world) throw new Error('当前世界不存在。');
  if (definitions.length < 1 || definitions.length > 60) throw new Error('设定类型应为1–60种。');
  if (!definitions.some((d) => d.id === 'character')) throw new Error('角色档案类型需要保留。');
  const next = definitions.map((d) => ({
    ...d,
    name: d.name.trim(),
    description: d.description.trim(),
  }));
  if (
    next.some(
      (d) =>
        !isEntityType(d.id) ||
        !d.name ||
        d.name.length > 60 ||
        /[\u0000-\u001f\u007f]/.test(d.name) ||
        d.description.length > 2000,
    )
  )
    throw new Error('类型名称须为1–60个字符，说明最多2000个字符。');
  if (
    new Set(next.map((d) => d.id)).size !== next.length ||
    new Set(next.map((d) => d.name)).size !== next.length
  )
    throw new Error('类型名称不能重复。');
  const removed = getEntityTypes(world).filter((old) => !next.some((d) => d.id === old.id));
  for (const old of removed) {
    if (data.entities.some((e) => e.worldId === worldId && e.type === old.id))
      throw new Error(`“${old.name}”仍有条目，请先迁移条目或删除条目，再移除此类型。`);
  }
  const templates = Object.fromEntries(
    Object.entries(world.entityTemplates ?? {}).filter(([id]) => next.some((d) => d.id === id)),
  );
  return {
    ...data,
    worlds: data.worlds.map((w) =>
      w.id === worldId
        ? { ...w, entityTypes: next, ...(w.entityTemplates ? { entityTemplates: templates } : {}) }
        : w,
    ),
  };
}
