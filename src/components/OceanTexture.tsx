import { memo, useId } from 'react';
import type { MapPoint } from '../../shared/cartography';
import { linePath } from '../lib/terrain';

/** Repeating engraved wavelets and broken currents, beneath land and authored detail.
 * Plain SVG keeps exports self-contained and avoids expensive per-pixel filters. */
export const OceanTexture = memo(function OceanTexture({
  width,
  height,
  points,
}: {
  width: number;
  height: number;
  points?: MapPoint[];
}) {
  const id = `sea-engraving-${useId().replaceAll(':', '')}`;
  const unit = Math.max(0.35, Math.min(width, height) / 800);
  return (
    <g data-sea-texture="engraved" pointerEvents="none" aria-hidden="true" stroke="none">
      <defs>
        <pattern id={id} width={126 * unit} height={94 * unit} patternUnits="userSpaceOnUse">
          <g transform={`scale(${unit})`} fill="none" stroke="#637c78" strokeLinecap="round">
            <path
              d="M7 17q5-4 10 0t10 0m-17 4q6-2 11 0M69 57q6-4 12 0t12 0m-18 4q5-2 10 0M105 29q4-3 8 0t8 0M35 81q6-3 12 0t12 0"
              strokeWidth=".8"
              opacity=".34"
            />
            <path
              d="M3 37c17-3 22 2 36-1m8 0c11-1 17 2 25 0m16-1c15-2 20 0 30-1M9 66c13-2 22 2 34-1M65 12c12-2 21 1 34-1M4 91c21-2 31 1 42-1m29 1c15-2 25 0 39-1"
              strokeWidth=".45"
              opacity=".19"
            />
            <path d="M14 43h8m48 24h7m27-21h5M51 21h7" strokeWidth=".35" opacity=".2" />
          </g>
        </pattern>
        {points && (
          <clipPath id={`${id}-clip`}>
            <path d={linePath(points, true)} fillRule="evenodd" />
          </clipPath>
        )}
      </defs>
      <rect
        width={width}
        height={height}
        fill={`url(#${id})`}
        clipPath={points ? `url(#${id}-clip)` : undefined}
      />
    </g>
  );
});
