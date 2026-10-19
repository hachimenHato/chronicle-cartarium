import type { MapEditorData } from './cartography';

export type BuiltInEntityType =
  | 'character'
  | 'location'
  | 'faction'
  | 'culture'
  | 'religion'
  | 'history'
  | 'magic'
  | 'species'
  | 'item'
  | 'rule'
  | 'cosmology'
  | 'economy'
  | 'language';
export type EntityType = BuiltInEntityType | `custom_${string}`;
export interface EntityTypeDefinition {
  id: EntityType;
  name: string;
  description: string;
}
export type Visibility = 'public' | 'gm';
/** Assigned by the server. Legacy records belong to the installation owner. */
export interface AuthoredRecord {
  createdBy?: string;
}
export interface PublishedRecord extends AuthoredRecord {
  /** Absent on older creative records: private to GM. */
  visibility?: Visibility;
}
export interface World {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  system: string;
  createdAt: string;
  /** Per-world overrides; a missing type inherits its built-in template, [] is intentionally empty. */
  entityTemplates?: Partial<Record<EntityType, string[]>>;
  /** Full catalogue when customized; missing inherits the built-in catalogue. */
  entityTypes?: EntityTypeDefinition[];
}
export interface Entity extends AuthoredRecord {
  id: string;
  worldId: string;
  type: EntityType;
  name: string;
  summary: string;
  content: string;
  tags: string[];
  visibility: Visibility;
  status: 'draft' | 'complete';
  attributes: Record<string, string>;
  portrait?: string;
  cover?: string;
  graphPosition?: { x: number; y: number };
  updatedAt: string;
}
export interface MapPin {
  id: string;
  x: number;
  y: number;
  label: string;
  description: string;
  kind: 'city' | 'landmark' | 'danger' | 'note';
  entityId?: string;
  childMapId?: string;
}
export interface MapStroke {
  id: string;
  points: { x: number; y: number }[];
  color: string;
  width: number;
  tool: 'brush' | 'road' | 'river';
}
export interface AtlasMap extends PublishedRecord {
  id: string;
  worldId: string;
  name: string;
  summary: string;
  kind: 'world' | 'region' | 'town';
  parentId?: string;
  seed: number;
  width: number;
  height: number;
  /** Horizontal geographic coverage in km; absent on legacy maps. */
  scaleKm?: number;
  pins: MapPin[];
  strokes: MapStroke[];
  /** Optional so pre-editor maps and version-1 JSON backups remain readable. */
  editor?: MapEditorData;
}
export interface Relation extends PublishedRecord {
  id: string;
  worldId: string;
  sourceId: string;
  targetId: string;
  label: string;
  description: string;
  kind: 'ally' | 'enemy' | 'family' | 'neutral';
}
export interface Condition {
  variable: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
  value: string;
}
export interface Effect {
  variable: string;
  value: string;
}
export interface PlotNode {
  id: string;
  title: string;
  summary: string;
  entityIds: string[];
  x: number;
  y: number;
  kind: 'start' | 'scene' | 'choice' | 'ending';
  status: 'locked' | 'available' | 'completed';
  conditions: Condition[];
  conditionMode: 'all' | 'any';
  effects: Effect[];
}
export interface PlotEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}
export interface Plot extends PublishedRecord {
  id: string;
  worldId: string;
  name: string;
  summary: string;
  nodes: PlotNode[];
  edges: PlotEdge[];
  layoutVersion?: 1;
}
export interface Session extends PublishedRecord {
  id: string;
  worldId: string;
  title: string;
  date: string;
  content: string;
  status: 'planned' | 'completed';
}
export interface StateVariable extends PublishedRecord {
  id: string;
  worldId: string;
  name: string;
  value: string;
}
export interface Workspace {
  worlds: World[];
  entities: Entity[];
  maps: AtlasMap[];
  relations: Relation[];
  plots: Plot[];
  sessions: Session[];
  variables: StateVariable[];
}
export interface WorkspaceEnvelope {
  data: Workspace;
  revision: number;
  mode: 'mysql' | 'demo' | 'sqlite';
}
export const entityLabels: Record<EntityType, string> = {
  character: '角色人物',
  location: '地理与地点',
  faction: '组织与势力',
  culture: '文化与风俗',
  religion: '信仰与神祇',
  history: '历史与纪元',
  magic: '魔法与科技',
  species: '种族与生物',
  item: '物品与遗物',
  rule: '规则与机制',
  cosmology: '宇宙与法则',
  economy: '经济与贸易',
  language: '语言与文字',
};
export const entityTemplates: Record<EntityType, string[]> = {
  character: [
    '身份 / 职业',
    '年龄 / 种族',
    '外貌特征',
    '性格与信念',
    '动机与目标',
    '弱点与恐惧',
    '能力与属性',
    '背景经历',
    '秘密与线索',
    'GM 扮演提示',
  ],
  location: [
    '地理与气候',
    '人口与资源',
    '治理与法律',
    '区域与建筑',
    '交通与经济',
    '危险与冲突',
    '冒险线索',
  ],
  faction: ['宗旨与目标', '领袖与成员', '组织结构', '资源与影响', '盟友与对手', '加入与晋升'],
  culture: ['社会结构', '习俗与禁忌', '艺术与饮食', '价值与伦理', '节庆与仪式'],
  religion: ['神祇与领域', '教义与禁忌', '仪式与圣地', '组织与教派', '神迹与矛盾'],
  history: ['纪年与时期', '起因', '关键人物', '事件经过', '影响与遗留'],
  magic: ['来源与原理', '使用条件', '能力与边界', '代价与风险', '社会影响'],
  species: ['生理与寿命', '栖息与分布', '文化与社会', '特殊能力', '与他族关系'],
  item: ['外观与来源', '能力与用途', '使用条件', '代价与限制', '持有者与传说'],
  rule: ['适用场景', '判定方法', '难度与数值', '成功与失败', '规则示例'],
  cosmology: ['世界起源', '位面与结构', '自然法则', '时间与历法', '死亡与来世'],
  economy: ['货币与价值', '产业与资源', '贸易与交通', '阶层与分配', '稀缺与矛盾'],
  language: ['使用族群', '文字体系', '语音与语法', '命名规则', '重要词汇'],
};
export const makeId = (prefix = 'id') => `${prefix}_${crypto.randomUUID()}`;
