import type { GeneratedGeography } from '../../shared/geography';
import { pointInPolygon } from './terrain';
import type { DivisionKind, MapPoint } from '../../shared/cartography';
export function cellAt(g: GeneratedGeography, point: MapPoint) {
  return g.cells.find((c) => pointInPolygon(point, c.polygon));
}
export function assignGeographicCells(
  g: GeneratedGeography,
  divisionId: string,
  ids: Set<number>,
): GeneratedGeography {
  const division = g.divisions.find((d) => d.id === divisionId);
  if (!division) return g;
  return fillGeographicCells(g, division.kind, ids, divisionId);
}
export function clearGeographicCells(
  g: GeneratedGeography,
  kind: DivisionKind,
  ids: Set<number>,
): GeneratedGeography {
  return fillGeographicCells(g, kind, ids);
}
function fillGeographicCells(
  g: GeneratedGeography,
  kind: DivisionKind,
  ids: Set<number>,
  divisionId?: string,
): GeneratedGeography {
  const cells = g.cells.map((c) => (c.land && ids.has(c.id) ? { ...c, [kind]: divisionId } : c));
  const borders = g.borders.filter((b) => ['plate', 'cell'].includes(b.kind));
  for (const edge of borders.filter((b) => b.kind === 'cell')) {
    const a = cells[edge.cells[0]],
      b = cells[edge.cells[1]];
    if (!a?.land || !b?.land) continue;
    for (const kind of ['country', 'culture', 'religion'] as const)
      if (a[kind] !== b[kind] && (a[kind] || b[kind]))
        borders.push({ ...edge, id: `${kind}_${a.id}_${b.id}`, kind });
  }
  return {
    ...g,
    cells,
    borders,
    divisions: g.divisions.map((d) => {
      const owned = cells.filter((c) => c[d.kind] === d.id);
      if (!owned.length) return d;
      const average = {
        x: owned.reduce((s, c) => s + c.center.x, 0) / owned.length,
        y: owned.reduce((s, c) => s + c.center.y, 0) / owned.length,
      };
      const nearest = owned.reduce((a, b) =>
        Math.hypot(a.center.x - average.x, a.center.y - average.y) <
        Math.hypot(b.center.x - average.x, b.center.y - average.y)
          ? a
          : b,
      );
      return { ...d, center: nearest.center };
    }),
  };
}
export function preserveGeographicNames(
  next: GeneratedGeography,
  previous?: GeneratedGeography,
): GeneratedGeography {
  if (!previous) return next;
  return {
    ...next,
    areas: next.areas.map((a) => {
      const old = previous.areas.find((o) => o.id === a.id);
      return old ? { ...a, name: old.name, entityId: old.entityId } : a;
    }),
    divisions: next.divisions.map((d) => {
      const old = previous.divisions.find((o) => o.id === d.id);
      return old ? { ...d, name: old.name, entityId: old.entityId } : d;
    }),
    ports: next.ports.map((p) => {
      const old = previous.ports.find((o) => o.id === p.id);
      return old
        ? { ...p, name: old.name, ...(!p.settlementId ? { entityId: old.entityId } : {}) }
        : p;
    }),
  };
}
