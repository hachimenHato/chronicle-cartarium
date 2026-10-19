import type { GeneratedGeography } from '../../shared/geography';
import type { DivisionKind, MapPoint } from '../../shared/cartography';
import { cellAt } from './geographic-edits';
import { sampleElevation, type ElevationField } from './elevation';

export interface GeographicSelectionModifiers {
  extend?: boolean;
  group?: boolean;
  kind?: DivisionKind;
}

/** Coastal mesh cells can contain both land and water; the saved fine surface is authoritative. */
export function selectableGeographicCell(
  geography: GeneratedGeography,
  point: MapPoint,
  surface?: ElevationField,
) {
  if (surface && sampleElevation(surface, point) <= 0) return undefined;
  const cell = cellAt(geography, point);
  return cell?.land ? cell : undefined;
}

/** Pure selection edits never change map ownership, geography or persisted snapshots. */
export function selectGeographicCells(
  geography: GeneratedGeography,
  selected: ReadonlySet<number>,
  id: number,
  anchor?: number,
  modifiers: GeographicSelectionModifiers = {},
): Set<number> {
  const cell = geography.cells[id];
  if (!cell?.land) return new Set(selected);
  const next = new Set(selected);
  if (modifiers.group) {
    const kind = modifiers.kind ?? 'country';
    const queue = [id];
    const visited = new Set(queue);
    for (let i = 0; i < queue.length; i++) {
      for (const neighbor of geography.cells[queue[i]].neighbors) {
        const candidate = geography.cells[neighbor];
        if (candidate?.land && candidate[kind] === cell[kind] && !visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    for (const member of visited) next.add(member);
    return next;
  }
  if (modifiers.extend && anchor !== undefined && anchor !== id && geography.cells[anchor]?.land) {
    const queue = [anchor];
    const previous = new Map<number, number | undefined>([[anchor, undefined]]);
    for (let i = 0; i < queue.length && !previous.has(id); i++) {
      for (const neighbor of geography.cells[queue[i]].neighbors) {
        if (geography.cells[neighbor]?.land && !previous.has(neighbor)) {
          previous.set(neighbor, queue[i]);
          queue.push(neighbor);
        }
      }
    }
    if (previous.has(id)) {
      let cursor: number | undefined = id;
      while (cursor !== undefined) {
        next.add(cursor);
        cursor = previous.get(cursor);
      }
      return next;
    }
  }
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
