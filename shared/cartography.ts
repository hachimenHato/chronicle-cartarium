import type { GeographicSettings } from './geography';
import type { GeneratedMapSnapshot, MapMilitaryLine } from './generated-map';
/** Persisted vector map editing contract. Coordinates are in map units. */
export interface MapPoint {
  x: number;
  y: number;
}

export const legacyBiomeIds = [
  'water',
  'grass',
  'forest',
  'mountain',
  'desert',
  'swamp',
  'snow',
] as const;
export type TerrainBiome =
  | (typeof legacyBiomeIds)[number]
  | 'hill'
  | 'plateau'
  | 'taiga'
  | 'rainforest'
  | 'savanna'
  | 'tundra'
  | 'badlands';
export type EditorMode = 'sketch' | 'sculpt' | 'detail';
export const mapSymbolIds = [
  'tree',
  'pine',
  'mountain',
  'hill',
  'dune',
  'reeds',
  'rock',
  'city',
  'village',
  'town',
  'castle',
  'tower',
  'ruin',
  'temple',
  'bridge',
  'cave',
  'port',
  'house',
  'farmland',
  'waterfall',
  'volcano',
  'crater',
  'glacier',
  'dead-tree',
  'giant-mushroom',
  'inn',
  'tavern',
  'market',
  'manor',
  'barracks',
  'gate',
  'wall',
  'watchtower',
  'monastery',
  'chapel',
  'graveyard',
  'altar',
  'standing-stones',
  'obelisk',
  'wizard-tower',
  'portal',
  'magic-crystal',
  'enchanted-tree',
  'floating-island',
  'dragon-lair',
  'monster-den',
  'dungeon',
  'treasure',
  'battlefield',
  'bandit-camp',
  'gallows',
  'camp',
  'windmill',
  'watermill',
  'smithy',
  'stable',
  'warehouse',
  'well',
  'fountain',
  'mine',
  'quarry',
  'lighthouse',
  'ship',
  'boat',
  'dock',
  'road-sign',
] as const;
export type MapSymbolKind = (typeof mapSymbolIds)[number];
export const symbolCategories = {
  nature: '自然地貌',
  settlement: '聚落建筑',
  defense: '防御设施',
  faith: '信仰圣地',
  fantasy: '魔法奇迹',
  adventure: '冒险危险',
  resource: '资源交通',
} as const;
export type SymbolCategory = keyof typeof symbolCategories;

export interface MapRegion {
  id: string;
  name: string;
  biome: TerrainBiome;
  geometry: 'brush' | 'polygon';
  points: MapPoint[];
  /** Brush diameter, not radius. */
  width: number;
  seed: number;
  roughness: number;
  density: number;
  visible: boolean;
  locked: boolean;
}

export interface MapObject {
  id: string;
  name: string;
  kind: 'symbol' | 'path' | 'polygon' | 'text' | 'image';
  /** Baked base objects sit below editable terrain regions. Absent means detail. */
  layer?: 'base' | 'detail';
  points: MapPoint[];
  symbol?: MapSymbolKind;
  /** Uploaded raster, stored separately in DATA_DIR/uploads. Images have two ordered corners. */
  imageUrl?: string;
  text: string;
  color: string;
  stroke: string;
  strokeWidth: number;
  size: number;
  rotation: number;
  opacity: number;
  /** Optional SVG Gaussian softness in map units. Absent is a sharp vector edge. */
  blur?: number;
  visible: boolean;
  locked: boolean;
}

/** Versioned recipe: authored regions remain the source of truth; geometry is derived. */
interface SketchGenerationCommon {
  seed: number;
  climate: 'temperate' | 'dry' | 'cold';
  /** Requested maximum; small or unsuitable islands may support fewer settlements. */
  settlements: number;
  rivers: boolean;
  routes: boolean;
}
export type SketchGenerationDetail = 'standard' | 'high' | 'ultra';
export type ElevationOperation = 'raise' | 'lower' | 'flatten' | 'smooth';
export interface ElevationStroke {
  id: string;
  operation: ElevationOperation;
  points: MapPoint[];
  /** Brush diameter in map units, between 5 and 500. */
  width: number;
  /** Normalized brush strength, between 0 and 1. */
  strength: number;
  /** Flatten target in meters, between -2000 and 6000. */
  target: number;
}
/** Versioned, deterministic height source and ordered edits. Heights use meters. */
export interface ElevationSettings {
  version: 1;
  preset: 'sketch' | 'continent' | 'archipelago' | 'highlands';
  seed: number;
  relief: number;
  seaLevel: number;
  strokes: ElevationStroke[];
}
export const MAP_ELEVATION_LIMITS = {
  strokes: 96,
  points: 256,
  totalPoints: 8192,
} as const;
export interface SketchGenerationV1 extends SketchGenerationCommon {
  version: 1;
}
export interface SketchGenerationV2 extends SketchGenerationCommon {
  version: 2;
  geography?: GeographicSettings;
  /** Sampling density on the longer map axis, independent of vector export dimensions. */
  detail: SketchGenerationDetail;
  /** Opt-in map-scale curves. Omitted recipes retain the original v2 linework. */
  linework?: 'organic';
  /** Omitted recipes retain their original height field. */
  elevation?: ElevationSettings;
  /** Explicit typed limits supersede the legacy aggregate settlements limit. */
  settlementCounts?: Record<SettlementKind, number>;
  /** Stable type/ordinal IDs retain authored names across terrain regeneration. */
  settlementNames?: Record<string, string>;
  /** Stable type/ordinal IDs retain location links without rerunning geography. */
  settlementLinks?: Record<string, string>;
}
export const settlementCatalog = {
  village: { label: '村落', suffix: '村', size: 2.4, buildings: 3 },
  town: { label: '小镇', suffix: '镇', size: 3.1, buildings: 8 },
  city: { label: '城市', suffix: '城', size: 4.6, buildings: 15 },
  castle: { label: '城堡', suffix: '堡', size: 4.4, buildings: 2 },
  camp: { label: '营地', suffix: '营地', size: 2, buildings: 3 },
} as const;
export type SettlementKind = keyof typeof settlementCatalog;
export interface GeneratedSettlement {
  id: string;
  kind: SettlementKind;
  name: string;
  x: number;
  y: number;
  /** Linked location page; ports belonging to this settlement share this association. */
  entityId?: string;
}
export type SketchGenerationSettings = SketchGenerationV1 | SketchGenerationV2;
export const generationDetailCatalog: {
  id: SketchGenerationDetail;
  label: string;
  samples: number;
}[] = [
  { id: 'standard', label: '标准', samples: 192 },
  { id: 'high', label: '精细', samples: 288 },
  { id: 'ultra', label: '极细', samples: 384 },
];

export interface MapEditorData {
  version: 1;
  mode: EditorMode;
  baseVisible: boolean;
  regions: MapRegion[];
  objects: MapObject[];
  divisions?: MapDivision[];
  divisionPaint?: DivisionPaint[];
  /** Omitted on legacy maps. Regenerates only the derived terrain, never manual objects. */
  generation?: SketchGenerationSettings;
  generated?: GeneratedMapSnapshot;
  military?: MapMilitaryLine[];
  /** Display only. Never part of the physical generation recipe or snapshot signature. */
  hiddenFeatures?: Partial<Record<'settlements' | 'ports' | 'roads' | 'seaRoutes', string[]>>;
}

export type DivisionKind = 'country' | 'culture' | 'religion';
export interface MapDivision {
  id: string;
  kind: DivisionKind;
  name: string;
  entityId?: string;
  color: string;
  visible: boolean;
}
/** Ordered ownership edits. Layers are exclusive internally, independent across kinds. */
export interface DivisionPaint {
  id: string;
  divisionId: string;
  operation: 'paint' | 'erase';
  geometry: 'brush' | 'polygon';
  points: MapPoint[];
  width: number;
  roughness: number;
  seed: number;
}
export const DIVISION_LIMITS = { divisions: 96, strokes: 256, points: 256, totalPoints: 16384 };
export const divisionLabels: Record<DivisionKind, string> = {
  country: '国家',
  culture: '文化',
  religion: '信仰',
};
export const divisionEntityTypes = {
  country: 'faction',
  culture: 'culture',
  religion: 'religion',
} as const;

export const biomeCatalog: { id: TerrainBiome; label: string; color: string }[] = [
  { id: 'water', label: '水域', color: '#b8d6dc' },
  { id: 'grass', label: '草原', color: '#d3dcb0' },
  { id: 'forest', label: '森林', color: '#a7c19a' },
  { id: 'mountain', label: '山地', color: '#c4baa0' },
  { id: 'desert', label: '沙漠', color: '#e9d19a' },
  { id: 'swamp', label: '沼泽', color: '#a9bfaf' },
  { id: 'snow', label: '雪原', color: '#e4edf0' },
  { id: 'hill', label: '丘陵', color: '#bfc89b' },
  { id: 'plateau', label: '高原', color: '#c7b48e' },
  { id: 'taiga', label: '针叶林', color: '#819f8c' },
  { id: 'rainforest', label: '雨林', color: '#83ab81' },
  { id: 'savanna', label: '稀树草原', color: '#cec48b' },
  { id: 'tundra', label: '苔原', color: '#bdc4b3' },
  { id: 'badlands', label: '荒岩', color: '#c39c7d' },
];

export const symbolCatalog: {
  id: MapSymbolKind;
  label: string;
  color: string;
  category: SymbolCategory;
}[] = [
  { id: 'tree', label: '阔叶树', color: '#64895b', category: 'nature' },
  { id: 'pine', label: '针叶树', color: '#496e5c', category: 'nature' },
  { id: 'mountain', label: '山峰', color: '#a2957a', category: 'nature' },
  { id: 'hill', label: '丘陵', color: '#a3ad79', category: 'nature' },
  { id: 'dune', label: '沙丘', color: '#c6a76b', category: 'nature' },
  { id: 'reeds', label: '芦苇', color: '#6b9074', category: 'nature' },
  { id: 'rock', label: '岩石', color: '#9d9d93', category: 'nature' },
  { id: 'city', label: '城市', color: '#9a806b', category: 'settlement' },
  { id: 'village', label: '村落', color: '#aa896b', category: 'settlement' },
  { id: 'town', label: '小镇', color: '#aa896b', category: 'settlement' },
  { id: 'castle', label: '城堡', color: '#828579', category: 'defense' },
  { id: 'tower', label: '高塔', color: '#8c8a7b', category: 'defense' },
  { id: 'ruin', label: '遗迹', color: '#939384', category: 'adventure' },
  { id: 'temple', label: '神殿', color: '#b6a079', category: 'faith' },
  { id: 'bridge', label: '桥梁', color: '#a78e72', category: 'resource' },
  { id: 'cave', label: '洞穴', color: '#7c7c6b', category: 'adventure' },
  { id: 'port', label: '港口', color: '#6d9292', category: 'resource' },
  { id: 'house', label: '房屋', color: '#bc9278', category: 'settlement' },
  { id: 'farmland', label: '农田', color: '#b3b974', category: 'resource' },
  { id: 'waterfall', label: '瀑布', color: '#a3ad79', category: 'nature' },
  { id: 'volcano', label: '火山', color: '#a3ad79', category: 'nature' },
  { id: 'crater', label: '陨石坑', color: '#a3ad79', category: 'nature' },
  { id: 'glacier', label: '冰川', color: '#a3ad79', category: 'nature' },
  { id: 'dead-tree', label: '枯树', color: '#a3ad79', category: 'nature' },
  { id: 'giant-mushroom', label: '巨型蘑菇', color: '#a3ad79', category: 'nature' },
  { id: 'inn', label: '旅店', color: '#bc9278', category: 'settlement' },
  { id: 'tavern', label: '酒馆', color: '#bc9278', category: 'settlement' },
  { id: 'market', label: '集市', color: '#bc9278', category: 'settlement' },
  { id: 'manor', label: '庄园', color: '#bc9278', category: 'settlement' },
  { id: 'barracks', label: '兵营', color: '#828579', category: 'defense' },
  { id: 'gate', label: '城门', color: '#828579', category: 'defense' },
  { id: 'wall', label: '城墙', color: '#828579', category: 'defense' },
  { id: 'watchtower', label: '瞭望塔', color: '#828579', category: 'defense' },
  { id: 'monastery', label: '修道院', color: '#b6a079', category: 'faith' },
  { id: 'chapel', label: '教堂', color: '#b6a079', category: 'faith' },
  { id: 'graveyard', label: '墓园', color: '#b6a079', category: 'faith' },
  { id: 'altar', label: '祭坛', color: '#b6a079', category: 'faith' },
  { id: 'standing-stones', label: '石阵', color: '#b6a079', category: 'faith' },
  { id: 'obelisk', label: '方尖碑', color: '#b6a079', category: 'faith' },
  { id: 'wizard-tower', label: '法师塔', color: '#a391ad', category: 'fantasy' },
  { id: 'portal', label: '传送门', color: '#a391ad', category: 'fantasy' },
  { id: 'magic-crystal', label: '魔晶矿簇', color: '#a391ad', category: 'fantasy' },
  { id: 'enchanted-tree', label: '古老神木', color: '#a391ad', category: 'fantasy' },
  { id: 'floating-island', label: '浮空岛', color: '#a391ad', category: 'fantasy' },
  { id: 'dragon-lair', label: '龙巢', color: '#aa896b', category: 'adventure' },
  { id: 'monster-den', label: '兽穴', color: '#aa896b', category: 'adventure' },
  { id: 'dungeon', label: '地下城入口', color: '#aa896b', category: 'adventure' },
  { id: 'treasure', label: '宝藏', color: '#aa896b', category: 'adventure' },
  { id: 'battlefield', label: '古战场', color: '#aa896b', category: 'adventure' },
  { id: 'bandit-camp', label: '匪徒营地', color: '#aa896b', category: 'adventure' },
  { id: 'gallows', label: '绞刑架', color: '#aa896b', category: 'adventure' },
  { id: 'camp', label: '营地', color: '#aa896b', category: 'adventure' },
  { id: 'windmill', label: '风车磨坊', color: '#a78e72', category: 'resource' },
  { id: 'watermill', label: '水车磨坊', color: '#a78e72', category: 'resource' },
  { id: 'smithy', label: '铁匠铺', color: '#a78e72', category: 'resource' },
  { id: 'stable', label: '马厩', color: '#a78e72', category: 'resource' },
  { id: 'warehouse', label: '仓库', color: '#a78e72', category: 'resource' },
  { id: 'well', label: '水井', color: '#a78e72', category: 'resource' },
  { id: 'fountain', label: '喷泉', color: '#a78e72', category: 'resource' },
  { id: 'mine', label: '矿井', color: '#a78e72', category: 'resource' },
  { id: 'quarry', label: '采石场', color: '#a78e72', category: 'resource' },
  { id: 'lighthouse', label: '灯塔', color: '#a78e72', category: 'resource' },
  { id: 'ship', label: '帆船', color: '#a78e72', category: 'resource' },
  { id: 'boat', label: '小舟', color: '#a78e72', category: 'resource' },
  { id: 'dock', label: '码头', color: '#a78e72', category: 'resource' },
  { id: 'road-sign', label: '路标', color: '#a78e72', category: 'resource' },
];

export const MAP_EDITOR_LIMITS = {
  regions: 200,
  objects: 8000,
  points: 2000,
  symbolsPerRegion: 160,
} as const;
