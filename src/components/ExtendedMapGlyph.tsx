import type { MapSymbolKind } from '../../shared/cartography';

/** Original small-scale engraving symbols; no external images or copied assets. */
export function ExtendedMapGlyph({ kind }: { kind: MapSymbolKind }) {
  switch (kind) {
    case 'waterfall':
      return (
        <>
          <path d="M-18-13H2V9L17 13L9 17H-12L-19 11Z" />
          <path d="M-10-13V8Q-2 17 10 12M-4-13V7M-18 19Q-5 15 17 19" fill="none" />
        </>
      );
    case 'volcano':
      return (
        <>
          <path d="M-19 14L-7-8L0-4L7-8L20 14Z" />
          <path d="M-6-8Q0-13 7-8M-4-11Q-14-19-5-20Q6-23 10-15M0-4L5 13" fill="none" />
          <path d="M-2-5L0 4L5 8L3 2L4-5Z" fill="#ab7657" />
        </>
      );
    case 'crater':
      return (
        <>
          <path d="M-20 5Q-12-12 0-14Q13-9 20 6L12 15H-12Z" />
          <ellipse cy="2" rx="12" ry="6" fill="#857963" />
          <path d="M-18 7L-12 10M10-5L15-3M-2 12L1 15" fill="none" />
        </>
      );
    case 'glacier':
      return (
        <>
          <path d="M-19 14L-14-6L-5-13L0-3L8-16L16-5L20 14Z" fill="#d7e1d7" />
          <path d="M-5-13L-9 4L-3 14M8-16L4 3L13 14M-15 9H17" fill="none" />
        </>
      );
    case 'dead-tree':
      return (
        <>
          <path d="M-3 16L-1-15L3-17L3 16Z" />
          <path
            d="M0 5L-11-5L-14-13M-8-2L-17-3M2-3L12-10L16-17M11-9L20-8M-8 17H10"
            fill="none"
            strokeWidth="1.8"
          />
        </>
      );
    case 'giant-mushroom':
      return (
        <>
          <path d="M-4-1L-5 16H7L4-1Z" />
          <path d="M-20-2Q-17-20 0-20Q17-18 20-2Q0 7-20-2Z" />
          <path d="M-15 0Q0 4 16 0M-4 13Q0 9 5 12" fill="none" />
          <circle cx="-8" cy="-10" r="2.5" fill="#f0e2c0" />
          <circle cx="7" cy="-13" r="3" fill="#f0e2c0" />
        </>
      );
    case 'inn':
      return (
        <>
          <path d="M-15-3L0-16L15-3V15H-15Z" />
          <path
            d="M-19-3L0-20L19-3M-4 15V4H3V15M-10-4H-6V0H-10M6-4H10V0H6M14 0H22V9H15"
            fill="none"
          />
          <path d="M17 5H21" fill="none" />
        </>
      );
    case 'tavern':
      return (
        <>
          <path d="M-18 0L-9-10L4 0V15H-18Z" />
          <path d="M8-10H17V4Q17 11 12 11Q7 11 7 4Z" />
          <path
            d="M17-6H21V2H17M8-11Q6-18 10-17Q11-22 15-17Q19-18 18-11M-13 5H-7V9H-13"
            fill="none"
          />
        </>
      );
    case 'market':
      return (
        <>
          <path d="M-19-7L-14-16H14L19-7V-2H-19Z" />
          <path
            d="M-16-2V14M16-2V14M-20 5H20V13H-20ZM-10-15L-12-2M0-15V-2M10-15L12-2"
            fill="none"
          />
          <circle cx="-9" cy="2" r="2" />
          <path d="M1 5V0H8V5" />
        </>
      );
    case 'manor':
      return (
        <>
          <path d="M-17-1L0-15L17-1V15H-17Z" />
          <path
            d="M-11-5V-16H-6V-8M-7 15V5H0V15M5 4H10V10H5M-22 17H22M-22 7V17M22 7V17"
            fill="none"
          />
        </>
      );
    case 'barracks':
      return (
        <>
          <path d="M-20-2L-12-12H12L20-2V13H-20Z" />
          <path
            d="M-20-2H20M-13 13V2H-7V13M-2 2H3V8H-2M9 2H14V8H9M0-12V-21L12-17L0-15"
            fill="none"
          />
        </>
      );
    case 'gate':
      return (
        <>
          <path d="M-20-12H-10V15H-20ZM10-12H20V15H10ZM-10-8H10V-1H-10Z" />
          <path
            d="M-10 15V4Q0-9 10 4V15M-17-12V-17H-13V-12M13-12V-17H17V-12M-6 1V15M0-2V15M6 1V15"
            fill="none"
          />
        </>
      );
    case 'wall':
      return (
        <>
          <path d="M-21-7H-16V-13H-10V-7H-4V-13H3V-7H9V-13H16V-7H21V15H-21Z" />
          <path
            d="M-20 0H20M-20 8H20M-12-7V0M0-7V0M12-7V0M-6 0V8M7 0V8M-12 8V15M1 8V15M13 8V15"
            fill="none"
          />
        </>
      );
    case 'watchtower':
      return (
        <>
          <path
            d="M-11-13H11V-3H-11ZM-7-3L-11 16M7-3L11 16M-7-3L9 11M7-3L-9 11M-10 11H10M-14-13L0-21L14-13"
            fill="none"
            strokeWidth="1.6"
          />
          <path d="M-8-9H8" fill="none" />
        </>
      );
    case 'monastery':
      return (
        <>
          <path d="M-19-3H19V15H-19Z" />
          <path
            d="M-10-3V-15L-4-21L2-15V-3M-2-3V-10H15L21-3M-12 15V5Q-7-2-2 5V15M4 15V5Q9-2 14 5V15M-5-16V-9"
            fill="none"
          />
        </>
      );
    case 'chapel':
      return (
        <>
          <path d="M-13-2L0-14L13-2V15H-13Z" />
          <path d="M0-14V-23M-5-19H5M-5 15V6Q0-2 5 6V15" fill="none" />
          <circle cy="-3" r="2.5" fill="none" />
        </>
      );
    case 'graveyard':
      return (
        <>
          <path d="M-20 16H20M-14 15V-2H-20V-7H-14V-13H-9V-7H-3V-2H-9V15" fill="none" />
          <path d="M3 14V2Q10-8 17 2V14Z" />
          <path d="M8 2H12M10 0V8" fill="none" />
        </>
      );
    case 'altar':
      return (
        <>
          <path d="M-19 13H19V18H-19ZM-15 7H15V13H-15ZM-12-6H12V0H-12ZM-8 0H8V7H-8Z" />
          <path d="M-5-6Q-11-13-3-18Q-1-12 3-15Q9-9 4-6" fill="#c29662" />
        </>
      );
    case 'standing-stones':
      return (
        <>
          <path d="M-19 11L-18-8L-11-12L-8 12ZM8 12L10-12L17-8L20 11ZM-5 9L-4-18H3L6 9Z" />
          <path d="M-22 15Q0 23 22 15M-2-11H2M-2-5H2" fill="none" />
        </>
      );
    case 'obelisk':
      return (
        <>
          <path d="M-7 13L-5-15L0-22L5-15L7 13ZM-11 13H11V18H-11Z" />
          <path d="M0-22V13M-3-8H0M-3-3H0M-3 2H0" fill="none" />
        </>
      );
    case 'wizard-tower':
      return (
        <>
          <path d="M-9-6H9L12 17H-12ZM-13-6L0-23L13-6Z" />
          <path d="M-3 17V9Q0 5 3 9V17M-4 0H4M0-17L2-13L-2-13ZM14-17H20M17-20V-14" fill="none" />
        </>
      );
    case 'portal':
      return (
        <>
          <path d="M-16 16V-3Q0-24 16-3V16H9V-3Q0-15-9-3V16Z" />
          <path d="M-8 16H8M-16 3H-10M10 3H16" fill="none" />
          <ellipse cy="4" rx="6" ry="10" fill="none" stroke="#8c789c" />
          <path d="M-3 5Q4-3 4 5Q-1 12-3 5" fill="none" />
        </>
      );
    case 'magic-crystal':
      return (
        <>
          <path d="M-4 16L-7-10L0-22L7-10L4 16ZM-4 15L-17 4L-16-8L-9-5L-4 4ZM4 15L18 2L15-9L8-4L4 3Z" />
          <path d="M0-22V15M-16-8L-6 13M15-9L6 13" fill="none" />
        </>
      );
    case 'enchanted-tree':
      return (
        <>
          <path d="M-5 17L0-4L5 17Z" />
          <path d="M0-3C-20 10-23-8-11-10C-15-23 6-25 8-15C23-17 25 6 0-3Z" />
          <path d="M0-2L-9-11M0-2L10-10M-9 18Q0 13 12 18" fill="none" />
          <circle cx="-9" cy="-5" r="2" fill="#e9dfb2" />
          <circle cx="7" cy="-12" r="2" fill="#e9dfb2" />
        </>
      );
    case 'floating-island':
      return (
        <>
          <path d="M-21-1Q0-12 21-1L10 10L2 22L-4 9L-14 7Z" />
          <path d="M-21-1Q0 7 21-1M-3 1L2 22M8 3L10 10M-7-2V-12L-1-18L5-12V-2" fill="none" />
        </>
      );
    case 'dragon-lair':
      return (
        <>
          <path d="M-21 14L-12-6L1-15L16-4L21 14Z" />
          <path d="M-10 14V6Q0-10 9 6V14Z" fill="#75664f" />
          <path d="M1 4Q-8-13 6-15L3-21L15-13L18-6L10-7L12-2L5 2Z" />
          <circle cx="11" cy="-11" r="1" fill="#463d30" />
        </>
      );
    case 'monster-den':
      return (
        <>
          <path d="M-19 15Q-23-11 0-15Q22-8 19 15Z" />
          <path d="M-13 15Q-14-9 0-9Q14-9 13 15Z" fill="#655d49" />
          <path d="M-9-8L-5-1L-1-9M2-9L6-1L10-7" fill="#d8cba5" />
          <circle cx="-4" cy="5" r="1.5" fill="#b0a475" />
          <circle cx="5" cy="5" r="1.5" fill="#b0a475" />
        </>
      );
    case 'dungeon':
      return (
        <>
          <path d="M-17 16V-6Q0-22 17-6V16H10V-4Q0-13-10-4V16Z" />
          <path d="M-10 16H9M-8 11H7M-6 6H5M-17-4H-10M10-4H17M-9-15L-5-9M9-15L5-9" fill="none" />
        </>
      );
    case 'treasure':
      return (
        <>
          <path d="M-17-2Q-17-13 0-13Q17-13 17-2V13H-17Z" />
          <path
            d="M-17-2H17M-10-11V13M10-11V13M-3-4H3V4H-3ZM-21 17H20M17-17H23M20-20V-14"
            fill="none"
          />
        </>
      );
    case 'battlefield':
      return (
        <>
          <path
            d="M-14-16L12 13M14-16L-12 13M-17-12L-10-18M17-12L10-18M-16 9L-8 17M16 9L8 17"
            fill="none"
            strokeWidth="2"
          />
          <path d="M-5 6Q0-2 5 6V13H-5Z" />
          <path d="M-2 9H2M0 12V16M-20 19H21" fill="none" />
        </>
      );
    case 'bandit-camp':
      return (
        <>
          <path d="M-20 14L-10-8L1 14ZM0 14L11-13L23 14Z" />
          <path d="M-10-8L-10 14M11-13V14M-4-4V-19L9-15L-4-11" fill="none" />
          <circle cx="1" cy="-15" r="2" fill="#e8dfc7" />
        </>
      );
    case 'gallows':
      return (
        <>
          <path d="M-12 17V-19H13M-12-9L-2-19M-20 18H-3M11-19V-8" fill="none" strokeWidth="2.5" />
          <ellipse cx="11" cy="-4" rx="3" ry="5" fill="none" />
          <path d="M-17 18V13H0V18" fill="none" />
        </>
      );
    case 'camp':
      return (
        <>
          <path d="M-19 12L-7-13L7 12ZM-7-13V12M8 16L20 7M8 7L20 16" fill="none" />
          <path d="M10 10Q7 3 15-4Q13 4 19 4Q23 12 10 10Z" fill="#bd9665" />
        </>
      );
    case 'windmill':
      return (
        <>
          <path d="M-8-2L-11 17H11L8-2L0-10Z" />
          <path
            d="M0-6L-15-21L-20-16L-4 0M0-6L16-21L21-16L4 0M0-6L-16 9L-11 14L4-2M0-6L15 9L20 4L4-10"
            fill="none"
          />
          <path d="M-3 17V8H3V17" fill="none" />
        </>
      );
    case 'watermill':
      return (
        <>
          <path d="M-18 15V-3L-6-13L7-3V15Z" />
          <circle cx="10" cy="7" r="11" fill="none" />
          <path d="M10-4V18M-1 7H21M2-1L18 15M18-1L2 15M-20 21Q-4 17 22 21" fill="none" />
        </>
      );
    case 'smithy':
      return (
        <>
          <path d="M-20 15V-1L-9-12L2-1V15Z" />
          <path d="M6 1H20L16 6H11L9 12H19V16H3V12H7L6 6L1 4Z" />
          <path d="M11-17L18-13L15-8L8-12ZM11-10L4-1" fill="none" />
        </>
      );
    case 'stable':
      return (
        <>
          <path d="M-20 14V-5L-11-14H11L20-5V14Z" />
          <path d="M-20-5H20M-11 14V0H11V14M-11 0L11 14M11 0L-11 14M-5-10H5" fill="none" />
        </>
      );
    case 'warehouse':
      return (
        <>
          <path d="M-20-3L0-17L20-3V16H-20Z" />
          <path d="M-20-3H20M-12 16V2H12V16M-12 8H12M-2 2V16M4-15V-21H10V-10" fill="none" />
        </>
      );
    case 'well':
      return (
        <>
          <ellipse cy="11" rx="12" ry="6" />
          <path
            d="M-12 11V17Q0 25 12 17V11M-14 11V-7M14 11V-7M-19-7L0-18L19-7ZM0-7V6M-3 5H3V10H-3"
            fill="none"
          />
        </>
      );
    case 'fountain':
      return (
        <>
          <path d="M-20 12Q0 24 20 12L15 20H-15ZM-8 2Q0 8 8 2L5 7H-5ZM-2 7V13H2V7" />
          <path d="M0 2V-16M0-11Q-14-19-15 7M0-11Q14-19 15 7M-10 10Q0 7 10 10" fill="none" />
        </>
      );
    case 'mine':
      return (
        <>
          <path d="M-20 16L-15-7L0-16L15-7L20 16Z" />
          <path d="M-10 16V-2H10V16Z" fill="#766b53" />
          <path d="M-15-5H15M-12-5V16M12-5V16M-15 19L-6 6M15 19L6 6M-12 14H12" fill="none" />
        </>
      );
    case 'quarry':
      return (
        <>
          <path d="M-21 13V-13H-8V-5H3V3H15V13Z" />
          <path d="M-16-9H-10M-5-1H1M7 7H13M-9 18H2V9H-9ZM7 18H20V12H7Z" fill="none" />
        </>
      );
    case 'lighthouse':
      return (
        <>
          <path d="M-8 16L-5-8H5L8 16ZM-8-8H8V-15H-8ZM-10-15L0-22L10-15Z" />
          <path d="M-5 0H5M-6 9H6M-22-17L-12-12M22-17L12-12M-22-7L-12-12M22-7L12-12" fill="none" />
        </>
      );
    case 'ship':
      return (
        <>
          <path d="M-22 9H22L14 19H-12Z" />
          <path d="M-2 9V-21M-2-17L-17 5H-2ZM2-18Q15-15 17 5H2Z" />
          <path d="M-23 22Q-15 18-6 22Q3 26 12 22Q18 19 23 22" fill="none" />
        </>
      );
    case 'boat':
      return (
        <>
          <path d="M-20 2Q0-7 20 2L12 13H-10Z" />
          <path d="M-19 2Q0 8 19 2M-13-13L13 17M10 13L17 19M-21 18Q0 13 22 18" fill="none" />
        </>
      );
    case 'dock':
      return (
        <>
          <path d="M-19-5H19V2H-19ZM-4 2H4V18H-4Z" />
          <path d="M-15-10V5M15-10V5M-8-5V2M8-5V2M-8 19Q2 23 12 19M-4 8H4M-4 14H4" fill="none" />
        </>
      );
    case 'road-sign':
      return (
        <>
          <path d="M-2-21H2V20H-2ZM-19-15H10L19-9L10-3H-19ZM-17 2H19V12H-17L-22 7Z" />
          <path d="M-10-9H8M-11 7H11M-8 21H8" fill="none" />
        </>
      );
    default:
      return null;
  }
}
