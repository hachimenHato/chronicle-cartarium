import type { AuthoredRecord, Entity, PublishedRecord, Workspace } from './model';

export const moduleLabels = {
  characters: '角色档案',
  lore: '世界知识库',
  maps: '地图工坊',
  relations: '人物关系',
  plots: '剧情编织',
  sessions: '团务日志',
  variables: '世界变量',
} as const;
export type ContentModule = keyof typeof moduleLabels;
export type EditScope = 'none' | 'own' | 'any';
export interface ModuleGrant {
  create: boolean;
  update: EditScope;
  delete: EditScope;
}
export interface RecordGrant {
  read?: boolean;
  update?: boolean;
  delete?: boolean;
}
export interface UserAccount {
  id: string;
  username: string;
  role: 'owner' | 'moderator' | 'user';
  disabled: boolean;
  grants: Partial<Record<ContentModule, ModuleGrant>>;
  records: Record<string, RecordGrant>;
  canExport: boolean;
  canViewPrivate: boolean;
  tourCompleted: boolean;
}
export interface UserDirectory {
  enabled: boolean;
  revision: number;
  users: UserAccount[];
}
export const ownerAccount = (username = 'GM'): UserAccount => ({
  id: 'owner',
  username,
  role: 'owner',
  disabled: false,
  grants: {},
  records: {},
  canExport: true,
  canViewPrivate: true,
  tourCompleted: false,
});
export const isAdministrator = (actor: UserAccount) => actor.role !== 'user';
export const canExport = (actor: UserAccount) => isAdministrator(actor) || actor.canExport;
export function canRead(
  actor: UserAccount,
  record: (PublishedRecord | Entity) & { id: string },
): boolean {
  if (isAdministrator(actor)) return true;
  const specific = actor.records[record.id];
  if (specific?.read !== undefined) return specific.read;
  return record.createdBy === actor.id || record.visibility === 'public' || actor.canViewPrivate;
}
export function canCreate(actor: UserAccount, module: ContentModule): boolean {
  return isAdministrator(actor) || Boolean(actor.grants[module]?.create);
}
export function canChange(
  actor: UserAccount,
  module: ContentModule,
  record: AuthoredRecord & { id: string },
  action: 'update' | 'delete',
): boolean {
  if (isAdministrator(actor)) return true;
  const specific = actor.records[record.id]?.[action];
  if (specific !== undefined) return specific;
  const scope = actor.grants[module]?.[action] ?? 'none';
  return scope === 'any' || (scope === 'own' && record.createdBy === actor.id);
}
export function recordModule(
  collection: Exclude<keyof Workspace, 'worlds'>,
  record: { id: string; type?: string },
): ContentModule {
  return collection === 'entities'
    ? record.type === 'character'
      ? 'characters'
      : 'lore'
    : collection;
}
