import type { GeneratedGeography } from '../../shared/geography';
import { linePath } from './terrain';

/** Province/district edges are a subset of the same shared mesh, never guessed polygons. */
export function administrativeBorderPaths(g: GeneratedGeography) {
  const owners = new Map<number, string>();
  for (const area of g.areas)
    if (area.kind === 'province' || area.kind === 'district')
      for (const id of area.cells) owners.set(id, area.id);
  const cells = new Map(g.cells.map((cell) => [cell.id, cell]));
  const grid: string[] = [],
    administrative: string[] = [];
  for (const border of g.borders) {
    if (border.kind !== 'cell') continue;
    const a = cells.get(border.cells[0]),
      b = cells.get(border.cells[1]);
    if (!a?.land || !b?.land) continue;
    const path = linePath(border.points);
    if (a.country && b.country && a.country !== b.country) continue;
    const first = owners.get(a.id),
      second = owners.get(b.id);
    if (first && second && first !== second) administrative.push(path);
    else grid.push(path);
  }
  return { grid: grid.join(' '), administrative: administrative.join(' ') };
}
