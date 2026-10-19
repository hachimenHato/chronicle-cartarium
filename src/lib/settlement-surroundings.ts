import type { AtlasMap } from '../../shared/model';
import type { MapPoint, SettlementKind } from '../../shared/cartography';
import { seededRandom } from './terrain';

/** Two objects per small building; a shared budget keeps landmarks and labels intact. */
export function surroundingBuildingCount(
  kind: SettlementKind,
  mapKind: AtlasMap['kind'] | undefined,
  sites: number,
): number {
  if (mapKind === 'town') return 0;
  const desired =
    mapKind === 'world'
      ? { village: 24, town: 36, city: 52, castle: 28, camp: 22 }[kind]
      : { village: 3, town: 6, city: 9, castle: 5, camp: 4 }[kind];
  return Math.min(desired, Math.floor(600 / Math.max(1, sites)));
}

/** Irregular rings with room for the main miniature; independent RNG never changes hydrology. */
export function surroundingBuildingSites(
  center: MapPoint,
  size: number,
  count: number,
  unit: number,
  seed: number,
  accepts: (point: MapPoint, radius: number) => boolean,
) {
  const random = seededRandom(seed);
  const sites: { point: MapPoint; width: number; height: number; angle: number }[] = [];
  const inner = size * 0.48 + 1.25;
  const outer = Math.sqrt(inner * inner + count * 1.35 + 2);
  for (let attempt = 0; attempt < count * 18 && sites.length < count; attempt++) {
    const angle = random() * Math.PI * 2;
    const radius = unit * Math.sqrt(inner * inner + random() * (outer * outer - inner * inner));
    const point = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius * 0.8,
    };
    const width = unit * (0.31 + random() * 0.19),
      height = width * 0.7;
    if (
      !accepts(point, width * 1.45) ||
      sites.some(
        (site) =>
          Math.hypot(site.point.x - point.x, site.point.y - point.y) < (site.width + width) * 1.45,
      )
    )
      continue;
    sites.push({ point, width, height, angle: (random() - 0.5) * 0.65 });
  }
  return sites;
}
