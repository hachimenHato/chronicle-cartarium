import { newEntity } from '../../shared/entity-templates';
import type { AtlasMap, Entity, World } from '../../shared/model';
import { divisionEntityTypes, divisionLabels, biomeCatalog } from '../../shared/cartography';

/** Commit these records and the map together; never persist dangling division links. */
export function associateGeographicDivisions(
  map: AtlasMap,
  entities: Entity[],
  options: {
    world?: World;
    actorId?: string;
    canCreate: boolean;
  },
) {
  const geography = map.editor?.generated?.geography;
  if (!geography) return { map, entities: [] as Entity[], unlinked: 0 };
  const created: Entity[] = [],
    used = new Set<string>();
  let unlinked = 0;
  const divisions = geography.divisions.map((division) => {
    const type = divisionEntityTypes[division.kind];
    const available = entities.filter((e) => e.worldId === map.worldId && e.type === type);
    let entity =
      available.find((e) => e.id === division.entityId) ??
      available.find((e) => !used.has(e.id) && e.name === division.name) ??
      available.find((e) => !used.has(e.id));
    if (!entity && options.canCreate) {
      const cells = geography.cells.filter((c) => c.land && c[division.kind] === division.id);
      const average = (key: 'elevation' | 'temperature' | 'precipitation') =>
        cells.length ? Math.round(cells.reduce((sum, c) => sum + c[key], 0) / cells.length) : 0;
      const biomes = [
        ...new Set(cells.map((c) => biomeCatalog.find((b) => b.id === c.biome)?.label ?? c.biome)),
      ];
      entity = {
        ...newEntity(map.worldId, type, options.world),
        createdBy: options.actorId ?? map.createdBy,
        name: division.name,
        summary: `${map.name}中的${divisionLabels[division.kind]}，包含${cells.length}个基础区域。`,
        content: `## 地理分布\n\n位于地图「${map.name}」，覆盖${cells.length}个基础区域。平均海拔约${average('elevation')}米，年均气温约${average('temperature')}℃，年降水约${average('precipitation')}毫米。\n\n## 创作方向\n\n${division.kind === 'country' ? '补充统治结构、首都、资源、外交与边界争端。' : division.kind === 'culture' ? '补充语言、日常生活、传统、价值观与跨国分布。' : '补充核心信条、仪式、圣地、组织与地方派别。'}\n\n地理信息来自生成地图；社会历史与人物故事仍待作者完善。`,
        tags: ['地图生成', divisionLabels[division.kind], ...biomes],
        visibility: map.visibility ?? 'gm',
      };
      created.push(entity);
    }
    if (!entity) {
      unlinked++;
      return { ...division, entityId: undefined };
    }
    used.add(entity.id);
    return { ...division, name: entity.name, entityId: entity.id };
  });
  return {
    map: {
      ...map,
      editor: {
        ...map.editor!,
        generated: { ...map.editor!.generated!, geography: { ...geography, divisions } },
      },
    },
    entities: created,
    unlinked,
  };
}
