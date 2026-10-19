import { memo, useId } from 'react';

/** Native SVG paper and marginal engraving, shared by the atlas, preview and export.
 * Overlay has no hit area and never filters authored geometry or text.
 */
export const MapPaper = memo(function MapPaper({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  const uid = `vellum-${useId().replaceAll(':', '')}`;
  const unit = Math.min(width, height) / 640;
  const inset = 14 * unit;
  return (
    <g data-map-paper="parchment" pointerEvents="none" aria-hidden="true">
      <defs>
        <filter
          id={`${uid}-cloud`}
          x="0"
          y="0"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency=".009 .014"
            numOctaves="3"
            seed="19"
            stitchTiles="stitch"
          />
          <feColorMatrix type="matrix" values="0 0 0 0 .40  0 0 0 0 .34  0 0 0 0 .22  .2 0 0 0 0" />
        </filter>
        <filter
          id={`${uid}-grain`}
          x="0"
          y="0"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency=".72"
            numOctaves="2"
            seed="37"
            stitchTiles="stitch"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 .34  0 0 0 0 .30  0 0 0 0 .22  .14 0 0 0 0"
          />
        </filter>
        <radialGradient id={`${uid}-age`} cx="49%" cy="46%" r="69%">
          <stop offset=".60" stopColor="#96805a" stopOpacity="0" />
          <stop offset=".89" stopColor="#96805a" stopOpacity=".035" />
          <stop offset="1" stopColor="#8c764f" stopOpacity=".15" />
        </radialGradient>
        <pattern id={`${uid}-fibers`} width="127" height="109" patternUnits="userSpaceOnUse">
          <path
            d="M11 18l6-1m43 20l9 2m-39 43l3-6m71-50l5 3m-9 57l7-2m-59-51l2 4m-28 47l5 1"
            fill="none"
            stroke="#817251"
            strokeWidth=".3"
            opacity=".07"
          />
          <path
            d="M22 36l7 1m48 26l6-2m-25 30l5 1m40-73l5-1"
            fill="none"
            stroke="#fffcf2"
            strokeWidth=".5"
            opacity=".18"
          />
        </pattern>
      </defs>
      <rect width={width} height={height} filter={`url(#${uid}-cloud)`} opacity=".16" />
      <rect width={width} height={height} filter={`url(#${uid}-grain)`} opacity=".19" />
      <rect width={width} height={height} fill={`url(#${uid}-fibers)`} />
      <rect width={width} height={height} fill={`url(#${uid}-age)`} />
      <g fill="none" stroke="#6c6049" opacity=".66" strokeWidth={0.65 * unit}>
        <rect x={inset} y={inset} width={width - inset * 2} height={height - inset * 2} />
        <rect
          x={inset + 4 * unit}
          y={inset + 4 * unit}
          width={width - inset * 2 - 8 * unit}
          height={height - inset * 2 - 8 * unit}
          strokeWidth={0.3 * unit}
        />
        {/* Unlabelled border divisions are engraving, not invented geographic coordinates. */}
        {Array.from(
          { length: Math.max(0, Math.floor((width - inset * 2) / (50 * unit)) - 1) },
          (_, i) => {
            const x = inset + (i + 1) * 50 * unit;
            return (
              <path
                key={`longitude-${i}`}
                d={`M${x} ${inset}v${4 * unit}M${x} ${height - inset}v${-4 * unit}`}
                strokeWidth={0.42 * unit}
              />
            );
          },
        )}
        {Array.from(
          { length: Math.max(0, Math.floor((height - inset * 2) / (50 * unit)) - 1) },
          (_, i) => {
            const y = inset + (i + 1) * 50 * unit;
            return (
              <path
                key={`latitude-${i}`}
                d={`M${inset} ${y}h${4 * unit}M${width - inset} ${y}h${-4 * unit}`}
                strokeWidth={0.42 * unit}
              />
            );
          },
        )}
        {[
          [inset, inset, 0],
          [width - inset, inset, 90],
          [width - inset, height - inset, 180],
          [inset, height - inset, 270],
        ].map(([x, y, angle]) => (
          <g key={angle} transform={`translate(${x} ${y}) rotate(${angle}) scale(${unit})`}>
            <path d="M0 32V0H32M4 22V4H22M0 0l11 11M8 11l3-3 3 3-3 3Z" />
            <path d="M19 0l3-2 3 2-3 2ZM0 19l-2 3 2 3 2-3Z" fill="#6c6049" />
          </g>
        ))}
      </g>
      <g
        transform={`translate(${width - 67 * unit} ${height - 71 * unit}) scale(${unit})`}
        stroke="#5f5543"
        fill="none"
        opacity=".8"
      >
        <circle r="25" strokeWidth=".55" />
        <circle r="29" strokeWidth=".25" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <g key={angle} transform={`rotate(${angle})`}>
            <path
              d={angle % 90 === 0 ? 'M0-37L5 0H-5Z' : 'M0-25L3 0H-3Z'}
              fill="#f4ecd8"
              strokeWidth=".6"
            />
            <path
              d={angle % 90 === 0 ? 'M0-37L5 0H0Z' : 'M0-25L3 0H0Z'}
              fill="#5f5543"
              strokeWidth=".3"
            />
          </g>
        ))}
        <circle r="3" fill="#f4ecd8" strokeWidth=".8" />
        <path d="M0-45c-7-7 0-10 0-14 0 4 7 7 0 14m0-2v10" strokeWidth=".7" />
        <text
          y="-64"
          fill="#5f5543"
          stroke="none"
          fontFamily="Georgia, serif"
          fontSize="10"
          textAnchor="middle"
        >
          N
        </text>
        {[
          [-43, 3, 'W'],
          [43, 3, 'E'],
          [0, 48, 'S'],
        ].map(([x, y, label]) => (
          <text
            key={label}
            x={x}
            y={y}
            fill="#5f5543"
            stroke="none"
            fontFamily="Georgia, serif"
            fontSize="8"
            textAnchor="middle"
          >
            {label}
          </text>
        ))}
      </g>
    </g>
  );
});
