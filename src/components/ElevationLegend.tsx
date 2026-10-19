import { elevationBands } from '../lib/sketch-generation-v2';
import type { ElevationField } from '../lib/elevation';

/** Kept inside the SVG so the meaning of exported height colors travels with the map. */
export function ElevationLegend({ field }: { field: ElevationField }) {
  const scale = Math.min(field.width / 1000, field.height / 640);
  const bands = elevationBands.filter((_, i) => [0, 1, 2, 4, 5, 6, 7, 8, 9].includes(i));
  return (
    <g
      data-elevation-legend="true"
      pointerEvents="none"
      transform={`translate(${22 * scale} ${field.height - 81 * scale}) scale(${scale})`}
    >
      <rect
        width="386"
        height="60"
        rx="4"
        fill="#fffdf2"
        fillOpacity=".94"
        stroke="#817968"
        strokeWidth=".6"
      />
      <text x="12" y="17" fontSize="11" fill="#403e34" fontFamily="sans-serif">
        海拔（米） · 相对当前海平面
      </text>
      {bands.map(({ level, color }, i) => (
        <g key={level} transform={`translate(${12 + i * 40} 25)`}>
          <rect width="40" height="10" fill={color} />
          <text y="24" fontSize="9" fill="#403e34" fontFamily="sans-serif">
            {level}
          </text>
        </g>
      ))}
    </g>
  );
}
