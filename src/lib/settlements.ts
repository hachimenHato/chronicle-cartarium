import {
  settlementCatalog,
  type SketchGenerationV2,
  type SettlementKind,
} from '../../shared/cartography';
export function settlementCounts(
  settings: Pick<SketchGenerationV2, 'settlements' | 'settlementCounts'>,
): Record<SettlementKind, number> {
  return (
    settings.settlementCounts ?? {
      village: 0,
      town: Math.max(0, settings.settlements - 1),
      city: Math.min(1, settings.settlements),
      castle: 0,
      camp: 0,
    }
  );
}
export function settlementPlan(settings: SketchGenerationV2) {
  const counts = settlementCounts(settings);
  const prefixes = [
    '溪湾',
    '松岸',
    '白石',
    '青岚',
    '南渡',
    '暮野',
    '望川',
    '长桥',
    '林间',
    '北湾',
    '晓原',
    '星原',
    '月溪',
    '银杉',
    '赤岩',
    '雾泉',
    '云丘',
    '霜叶',
    '绿谷',
    '青鹿',
    '石门',
    '鹰崖',
    '樱坂',
    '灯河',
  ];
  const result: {
    id: string;
    kind: SettlementKind;
    name: string;
    buildings: number;
    size: number;
  }[] = [];
  for (const kind of ['city', 'castle', 'town', 'village', 'camp'] as const)
    for (let index = 0; index < counts[kind]; index++) {
      const id = `${kind}_${index}`;
      const offset = result.length;
      const label =
        prefixes[offset % prefixes.length] +
        (offset >= prefixes.length
          ? ['东', '西', '上', '下'][Math.floor(offset / prefixes.length) - 1]
          : '') +
        settlementCatalog[kind].suffix;
      result.push({
        id,
        kind,
        name: settings.settlementNames?.[id] ?? label,
        buildings: settings.settlementCounts
          ? settlementCatalog[kind].buildings
          : kind === 'city'
            ? 9
            : 5,
        size: settings.settlementCounts ? settlementCatalog[kind].size : 1.8,
      });
    }
  return result;
}
