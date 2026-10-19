import type { GeneratedGeography } from '../../shared/geography';
import { linePath } from '../lib/terrain';

/** UI-only overlay, intentionally excluded from snapshots and map exports. */
export function GeographicSelectionArtwork({
  geography,
  cells,
}: {
  geography?: GeneratedGeography;
  cells: Set<number>;
}) {
  if (!geography || !cells.size) return null;
  const unit = Math.max(geography.width, geography.height) / 1000;
  return (
    <g data-geographic-selection="true" data-editor-overlay="true" pointerEvents="none">
      {geography.cells
        .filter((cell) => cell.land && cells.has(cell.id))
        .map((cell) => (
          <path
            key={cell.id}
            data-selected-cell={cell.id}
            d={linePath(cell.polygon, true)}
            fill="#e9c56a"
            fillOpacity=".38"
            stroke="#704d19"
            strokeWidth={1.7 * unit}
            strokeLinejoin="round"
          />
        ))}
    </g>
  );
}
