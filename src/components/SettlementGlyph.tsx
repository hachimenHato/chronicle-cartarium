import type { SettlementKind } from '../../shared/cartography';

/** Five distinct, original pen-and-wash silhouettes; reused by the map and its key. */
export function SettlementGlyph({ kind }: { kind: SettlementKind }) {
  const roof = '#9e7455',
    shade = '#947f62',
    pale = '#eee0bc';
  return (
    <g
      data-settlement-glyph={kind}
      transform={`scale(${kind === 'castle' ? 0.52 : kind === 'city' ? 0.65 : kind === 'town' ? 0.8 : kind === 'camp' ? 0.85 : 0.95})`}
    >
      <path d="M-25 16Q-5 21 26 15Q9 23-18 21Z" fill={shade} stroke="none" opacity=".17" />
      {kind === 'village' && (
        <>
          <path d="M-18 3L-16-6L-6-7L-3 3V14H-18ZM2-2L4-10L16-9L20-1V15H2Z" fill={pale} />
          <path d="M-21 3L-12-8L-3-7L1 3ZM-1-2L9-14L20-9L23-1Z" fill={roof} />
          <path
            d="M-16 2L-10-4M-11 2L-6-3M4-2L10-9M9-1L15-8"
            stroke={pale}
            strokeWidth=".6"
            fill="none"
          />
          <path
            d="M-12 14V7H-7V14M9 15V6H14V15M4 2H7V5H4M16 2H19V5H16M-23 12V19M-19 13V19M-24 15H-17M-2 17Q1 12 4 17"
            fill="none"
          />
          <path d="M17-10V-17H20V-9" fill={shade} />
        </>
      )}
      {kind === 'town' && (
        <>
          <path d="M-23 5V-4L-17-10L-10-4V12H-23ZM9-6L16-13L24-6V12H9Z" fill={pale} />
          <path d="M-25-3L-18-12L-9-6L-8-2ZM7-5L16-15L26-6L24-3Z" fill={roof} />
          <path d="M-5 9V-15H4V9Z" fill={pale} />
          <path d="M-7-15L0-26L7-15Z" fill={roof} />
          <circle cy="-10" r="2.5" fill="none" />
          <path d="M0-12V-10L2-9M-2-4V1H2V-4Z" fill="none" />
          <path d="M-17 6H17V16H-17Z" fill={pale} />
          <path d="M-21 7L-15 0H13L20 7Z" fill={roof} />
          <path
            d="M-18 8H19M-18 11Q-14 14-10 11Q-6 14-2 11Q2 14 6 11Q10 14 14 11Q17 14 20 11"
            fill="none"
          />
          <path
            d="M-10 16V11M-2 16V12M6 16V12M14 16V11M-21 1H-18V5H-21M18-1H21V3H18M-27 18Q0 23 28 17"
            fill="none"
          />
        </>
      )}
      {kind === 'city' && (
        <>
          <path d="M-22 5V-7L-14-13L-6-7V6M5 5V-10L12-18L20-10V6" fill={pale} />
          <path d="M-26-6L-15-17L-3-7ZM3-10L13-22L23-10Z" fill={roof} />
          <path d="M-6 7V-21H3V7M15 7V-23H21V7" fill={pale} />
          <path d="M-9-21L-2-33L6-21ZM12-23L18-32L24-23Z" fill="#777b6b" />
          <path d="M-3-16H0V-12H-3M17-18H19V-14H17M-17-5H-13V-1H-17M8-3H11V1H8" fill="none" />
          <path
            d="M-27 5L-24 1L-20 5L-17 1L-13 5L-10 1L-6 5L-2 1L2 5L6 1L10 5L14 1L18 5L22 1L27 5V15Q0 25-27 15Z"
            fill={pale}
          />
          <path
            d="M-27 9Q0 18 27 9M-24 14H-15M-20 17H-13M13 14H22M12 18H19M-6 20V12Q0 5 6 12V20"
            fill="none"
          />
          <path d="M-4 20V13Q0 9 4 13V20Z" fill={shade} />
          <path d="M-27 12V-1H-21V15M21 15V-1H27V12" fill={pale} />
          <path d="M-29-1L-24-9L-19-1ZM19-1L24-9L29-1Z" fill={roof} />
        </>
      )}
      {kind === 'castle' && (
        <>
          <path d="M-10 5V-22H10V5Z" fill="#ddd5bd" />
          <path d="M-13-22L0-33L13-22Z" fill="#777b6b" />
          <path d="M0-33V-42M1-40L11-37L1-34" fill={roof} />
          <path
            d="M-24 14V-13H-19V-8H-14V-13H-9V4H9V-13H14V-8H19V-13H24V14Q0 22-24 14Z"
            fill="#ddd5bd"
          />
          <path
            d="M-9 4V-1H-4V4H1V-1H6V4H9M-21-3H-18V2H-21M17-3H20V2H17M-3-17H3V-11H-3M-22 7H-14M-19 11H-11M12 7H21M10 12H18"
            fill="none"
          />
          <path d="M-6 18V9Q0 1 6 9V18Z" fill={shade} />
          <path d="M-4 16V9M0 17V7M4 16V9M-5 11H5M-5 14H5M-7 20L-10 25M7 20L10 25" fill="none" />
        </>
      )}
      {kind === 'camp' && (
        <>
          <path d="M-24 9L-14-12L0 9ZM3 10L13-8L27 10Z" fill="#c5be92" />
          <path d="M-14-12L-10 9H0M13-8L16 10H27" fill="#aaa782" />
          <path d="M-13-2L-18 9H-8ZM13 0L8 10H18Z" fill="#78694f" />
          <path d="M-27 12L-24 9M1 12L0 9M0 14L3 10M29 13L27 10M-14-12V-18M13-8V-14" fill="none" />
          <ellipse cx="1" cy="16" rx="6" ry="2.5" fill="none" />
          <path d="M-2 15Q-5 11 0 7Q-1 12 3 10Q7 14 3 16Z" fill="#ba8252" />
          <path d="M1 5Q-3 1 1-3Q4-6 1-8M-6 20L6 18M-4 18L4 21" fill="none" opacity=".6" />
        </>
      )}
    </g>
  );
}
