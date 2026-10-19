import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeneratedGeography } from '../../shared/geography';
import {
  selectGeographicCells,
  type GeographicSelectionModifiers,
} from '../lib/geographic-selection';

/** A click selects a complete cell. Pointer moves deliberately have no selection effect. */
export function useGeographicSelection(mapId: string | undefined, geography?: GeneratedGeography) {
  const [selectedCells, setSelectedCells] = useState<Set<number>>(() => new Set());
  const anchor = useRef<number | undefined>(undefined);
  const shape = useMemo(
    () =>
      geography
        ? `${geography.seed}:${geography.width}:${geography.height}:${geography.cells.map((c) => `${c.id},${c.land},${c.center.x},${c.center.y}`).join(';')}`
        : '',
    [geography],
  );
  useEffect(() => {
    setSelectedCells(new Set());
    anchor.current = undefined;
  }, [mapId, shape]);
  function clearSelection() {
    setSelectedCells(new Set());
    anchor.current = undefined;
  }
  function selectCell(id: number, modifiers: GeographicSelectionModifiers = {}) {
    if (!geography?.cells[id]?.land) return;
    const previousAnchor = anchor.current;
    setSelectedCells((current) =>
      selectGeographicCells(geography, current, id, previousAnchor, modifiers),
    );
    anchor.current = id;
  }
  return { selectedCells, selectCell, clearSelection };
}
