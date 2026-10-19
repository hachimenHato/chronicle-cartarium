import type {
  GeneratedGeography,
  GeographicPort,
  GeographicSeaRoute,
} from '../../shared/geography';
import { GEOGRAPHY_LIMITS } from '../../shared/geography';
import type { GeneratedSettlement, MapPoint, SettlementKind } from '../../shared/cartography';
import type { SketchCell } from './sketch-generation-v1';
import { pointInPolygon } from './terrain';
import type { ElevationField } from './elevation';
import { sampleMapSurface } from '../../shared/map-surface';
import { createWaterRouter } from './water-routing';
import { ensureCoastalPorts } from './coastal-ports';

/** Reserve a few low coastal sites before land roads are calculated. */
export function preferCoastalSettlements(
  cells: SketchCell[],
  columns: number,
  rows: number,
  indices: number[],
  kinds: SettlementKind[],
  blocked = new Set<number>(),
) {
  const next = [...indices];
  const coast = cells
    .map((c, id) => ({ c, id }))
    .filter(({ c, id }) => {
      if (!c.land || c.elevation > 0.16 || c.slope > 0.5 || blocked.has(id)) return false;
      const x = id % columns,
        y = Math.floor(id / columns);
      return [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(
        ([a, b]) => a >= 0 && a < columns && b >= 0 && b < rows && !cells[b * columns + a].land,
      );
    });
  let span = 0;
  for (const c of cells) span = Math.max(span, c.x, c.y);
  let moved = 0;
  for (const index of indices
    .map((_, i) => i)
    .sort(
      (a, b) =>
        (kinds[a] === 'city' ? 0 : kinds[a] === 'town' ? 1 : 2) -
        (kinds[b] === 'city' ? 0 : kinds[b] === 'town' ? 1 : 2),
    )) {
    if (
      !['city', 'town', 'village'].includes(kinds[index]) ||
      moved >= Math.min(4, Math.max(2, Math.floor(indices.length / 3)))
    )
      continue;
    const origin = cells[indices[index]];
    const candidate = coast
      .filter(
        ({ c, id }) =>
          !next.some(
            (at, i) =>
              i !== index &&
              (at === id || Math.hypot(c.x - cells[at].x, c.y - cells[at].y) < span * 0.045),
          ),
      )
      .sort(
        (a, b) =>
          Math.hypot(a.c.x - origin.x, a.c.y - origin.y) -
          Math.hypot(b.c.x - origin.x, b.c.y - origin.y),
      )[0];
    if (candidate && Math.hypot(candidate.c.x - origin.x, candidate.c.y - origin.y) < span * 0.3) {
      next[index] = candidate.id;
      moved++;
    }
  }
  return next;
}
const distance = (a: MapPoint, b: MapPoint) => Math.hypot(a.x - b.x, a.y - b.y);
export function buildGeographicNavigation(
  g: GeneratedGeography,
  sites: GeneratedSettlement[],
  seed: number,
  surface?: ElevationField,
): { ports: GeographicPort[]; seaRoutes: GeographicSeaRoute[] } {
  // Coarse region centers cannot certify the actual coast. Without a fine
  // surface omit navigation rather than invent potentially overland sea lanes.
  if (!surface) return { ports: [], seaRoutes: [] };
  const spacing = Math.sqrt((g.width * g.height) / Math.max(1, g.cells.length));
  const router = createWaterRouter(surface),
    used = new Set<number>(),
    ports: GeographicPort[] = [];
  for (const site of sites) {
    if (!['city', 'town', 'village'].includes(site.kind) || sampleMapSurface(surface, site) <= 0)
      continue;
    const cell =
      g.cells.find((c) => c.land && pointInPolygon(site, c.polygon)) ??
      g.cells
        .filter((c) => c.land)
        .sort((a, b) => distance(site, a.center) - distance(site, b.center))[0];
    if (!cell || used.has(cell.id) || distance(site, cell.center) > spacing * 2.7) continue;
    const harbor = router.findHarbor(
      site,
      Math.min(
        spacing * 1.8,
        Math.max(surface.width / surface.columns, surface.height / surface.rows) * 5,
      ),
      true,
    );
    if (!harbor) continue;
    used.add(cell.id);
    ports.push({
      id: `port_${site.id}`,
      settlementId: site.id,
      name: `${site.name}港`,
      center: { x: site.x, y: site.y },
      harbor,
      cell: cell.id,
    });
    if (ports.length >= GEOGRAPHY_LIMITS.ports) break;
  }
  const coverage = ensureCoastalPorts(g, surface, router, ports, sites);
  const basins = new Map(ports.map((port) => [port.id, router.basinAt(port.harbor)]));
  const pairs = ports
    .flatMap((p, i) =>
      ports
        .slice(i + 1)
        .filter((q) => basins.get(p.id) === basins.get(q.id))
        .map((q) => ({
          p,
          q,
          length:
            distance(p.harbor, q.harbor) *
            (coverage.landComponent(p.center) === coverage.landComponent(q.center) ? 1.15 : 0.85),
        })),
    )
    .sort((a, b) => a.length - b.length);
  const roots = new Map(ports.map((p) => [p.id, p.id])),
    degree = new Map<string, number>(),
    seaRoutes: GeographicSeaRoute[] = [];
  const root = (id: string): string => (roots.get(id) === id ? id : root(roots.get(id)!));
  // The saved layer has one shared point budget. A dense archipelago must not
  // produce navigation that is impossible for the server to accept.
  let pointBudget =
    180_000 -
    g.cells.reduce((sum, cell) => sum + cell.polygon.length, 0) -
    g.borders.reduce((sum, border) => sum + border.points.length, 0);
  for (const pair of pairs) {
    const connected = root(pair.p.id) === root(pair.q.id);
    if (connected && ((degree.get(pair.p.id) ?? 0) >= 2 || (degree.get(pair.q.id) ?? 0) >= 2))
      continue;
    const points = router.route(pair.p.harbor, pair.q.harbor, seed + seaRoutes.length * 117);
    if (points.length < 2 || points.length > pointBudget) continue;
    seaRoutes.push({
      id: `sea_${pair.p.id}_${pair.q.id}`,
      name: `${pair.p.name} — ${pair.q.name}`,
      from: pair.p.id,
      to: pair.q.id,
      points,
    });
    pointBudget -= points.length;
    roots.set(root(pair.p.id), root(pair.q.id));
    degree.set(pair.p.id, (degree.get(pair.p.id) ?? 0) + 1);
    degree.set(pair.q.id, (degree.get(pair.q.id) ?? 0) + 1);
    if (seaRoutes.length >= GEOGRAPHY_LIMITS.seaRoutes) break;
  }
  return { ports, seaRoutes };
}
