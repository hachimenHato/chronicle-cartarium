import type { MapObject, GeneratedSettlement, SketchGenerationV2 } from '../../shared/cartography';
import { settlementPlan } from './settlements';
/** Names and links are display metadata; retain the geographic result without rerunning it. */
export function renameSettlementArtwork(
  objects: MapObject[],
  sites: GeneratedSettlement[] | undefined,
  settings: SketchGenerationV2,
) {
  const planned = new Map(settlementPlan(settings).map((s) => [s.id, s.name]));
  const next = sites?.map(({ entityId: oldLink, ...site }) => {
    const entityId = settings.settlementLinks ? settings.settlementLinks[site.id] : oldLink;
    return { ...site, name: planned.get(site.id) ?? site.name, ...(entityId ? { entityId } : {}) };
  });
  return {
    sites: next,
    objects: objects.map((object) => {
      const match = /^聚落 (\d+) · 名称$/.exec(object.name);
      const name = match && next?.[Number(match[1]) - 1]?.name;
      return name && name !== object.text ? { ...object, text: name } : object;
    }),
  };
}
