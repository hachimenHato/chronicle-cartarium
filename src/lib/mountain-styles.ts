import type { MapPoint } from '../../shared/cartography';

export type MountainTier = 'high' | 'middle' | 'low' | 'very-low';
export interface MountainStyle {
  id: string;
  label: string;
  family: string;
  tier: MountainTier;
  outline: MapPoint[];
  summitIndex: number;
  crest: MapPoint[];
  spurs: MapPoint[][];
  hatchCount: number;
  lightHatches: number;
  width: number;
  rise: number;
}

export const mountainTiers = [
  { id: 'high', label: '高峰', width: 21, rise: 33 },
  { id: 'middle', label: '中峰', width: 24, rise: 23 },
  { id: 'low', label: '矮山', width: 25, rise: 13 },
  { id: 'very-low', label: '极矮山丘', width: 26, rise: 6.5 },
] as const;

interface Family {
  id: string;
  label: string;
  tier: MountainTier;
  shape: number[][];
  smooth?: number;
}
// These are 32 separately designed structural profiles. The four treatments below
// change shoulders, saddles and rock ridges; no style is a resized or mirrored alias.
const families: Family[] = [
  {
    id: 'horn',
    tier: 'high',
    label: '峭立角峰',
    shape: [
      [-1, 0],
      [-0.72, 0.16],
      [-0.48, 0.39],
      [-0.22, 0.7],
      [0.02, 1],
      [0.14, 0.74],
      [0.42, 0.39],
      [0.71, 0.17],
      [1, 0],
    ],
  },
  {
    id: 'twin-horn',
    tier: 'high',
    label: '双角高峰',
    shape: [
      [-1, 0],
      [-0.72, 0.27],
      [-0.4, 0.89],
      [-0.19, 0.54],
      [0.15, 1],
      [0.36, 0.59],
      [0.66, 0.32],
      [1, 0],
    ],
  },
  {
    id: 'trident',
    tier: 'high',
    label: '三尖峰群',
    shape: [
      [-1, 0],
      [-0.78, 0.25],
      [-0.58, 0.76],
      [-0.35, 0.49],
      [-0.08, 1],
      [0.13, 0.5],
      [0.43, 0.86],
      [0.61, 0.43],
      [1, 0],
    ],
  },
  {
    id: 'leaning',
    tier: 'high',
    label: '偏斜刃峰',
    shape: [
      [-1, 0],
      [-0.62, 0.23],
      [-0.26, 0.48],
      [0.12, 0.64],
      [0.41, 1],
      [0.5, 0.7],
      [0.58, 0.28],
      [1, 0],
    ],
  },
  {
    id: 'high-cliff',
    tier: 'high',
    label: '高峰断壁',
    shape: [
      [-1, 0],
      [-0.72, 0.22],
      [-0.45, 0.37],
      [-0.3, 0.63],
      [-0.1, 0.9],
      [0.13, 1],
      [0.28, 0.94],
      [0.31, 0.18],
      [0.7, 0.12],
      [1, 0],
    ],
  },
  {
    id: 'towers',
    tier: 'high',
    label: '破碎岩塔',
    shape: [
      [-1, 0],
      [-0.76, 0.23],
      [-0.69, 0.7],
      [-0.48, 0.77],
      [-0.41, 0.44],
      [-0.15, 0.56],
      [-0.1, 1],
      [0.1, 0.95],
      [0.2, 0.48],
      [0.49, 0.64],
      [0.62, 0.27],
      [1, 0],
    ],
  },
  {
    id: 'serrated',
    tier: 'high',
    label: '锯齿高岭',
    shape: [
      [-1, 0],
      [-0.82, 0.45],
      [-0.65, 0.28],
      [-0.48, 0.76],
      [-0.29, 0.58],
      [-0.1, 1],
      [0.1, 0.71],
      [0.31, 0.9],
      [0.47, 0.54],
      [0.64, 0.7],
      [0.82, 0.22],
      [1, 0],
    ],
  },
  {
    id: 'buttress',
    tier: 'high',
    label: '阔肩主峰',
    shape: [
      [-1, 0],
      [-0.84, 0.28],
      [-0.64, 0.46],
      [-0.45, 0.39],
      [-0.31, 0.72],
      [-0.01, 1],
      [0.2, 0.8],
      [0.37, 0.74],
      [0.54, 0.42],
      [0.77, 0.32],
      [1, 0],
    ],
  },
  {
    id: 'dome',
    tier: 'middle',
    label: '圆顶山峰',
    smooth: 2,
    shape: [
      [-1, 0],
      [-0.78, 0.2],
      [-0.53, 0.64],
      [-0.2, 0.93],
      [0.1, 1],
      [0.41, 0.84],
      [0.66, 0.5],
      [0.8, 0.17],
      [1, 0],
    ],
  },
  {
    id: 'saddle',
    tier: 'middle',
    label: '双峰鞍山',
    shape: [
      [-1, 0],
      [-0.77, 0.25],
      [-0.42, 1],
      [-0.08, 0.5],
      [0.19, 0.56],
      [0.48, 0.87],
      [0.76, 0.3],
      [1, 0],
    ],
  },
  {
    id: 'compound',
    tier: 'middle',
    label: '复合峰群',
    shape: [
      [-1, 0],
      [-0.73, 0.22],
      [-0.58, 0.65],
      [-0.41, 0.42],
      [-0.12, 0.93],
      [0.03, 1],
      [0.22, 0.49],
      [0.49, 0.72],
      [0.73, 0.37],
      [1, 0],
    ],
  },
  {
    id: 'knife',
    tier: 'middle',
    label: '刀背长脊',
    shape: [
      [-1, 0],
      [-0.74, 0.38],
      [-0.54, 0.59],
      [-0.31, 0.82],
      [-0.04, 1],
      [0.25, 0.88],
      [0.44, 0.76],
      [0.64, 0.41],
      [1, 0],
    ],
  },
  {
    id: 'mesa',
    tier: 'middle',
    label: '桌状高台',
    shape: [
      [-1, 0],
      [-0.71, 0.13],
      [-0.6, 0.79],
      [-0.35, 0.94],
      [-0.06, 1],
      [0.28, 0.96],
      [0.51, 0.85],
      [0.66, 0.14],
      [1, 0],
    ],
  },
  {
    id: 'steps',
    tier: 'middle',
    label: '阶梯断崖',
    shape: [
      [-1, 0],
      [-0.78, 0.22],
      [-0.72, 0.45],
      [-0.43, 0.47],
      [-0.36, 0.73],
      [-0.13, 0.75],
      [-0.05, 1],
      [0.19, 0.96],
      [0.27, 0.55],
      [0.55, 0.52],
      [0.63, 0.18],
      [1, 0],
    ],
  },
  {
    id: 'broad-back',
    tier: 'middle',
    label: '宽背山体',
    smooth: 1,
    shape: [
      [-1, 0],
      [-0.8, 0.25],
      [-0.55, 0.56],
      [-0.38, 0.82],
      [-0.18, 0.89],
      [0.03, 0.84],
      [0.22, 1],
      [0.46, 0.71],
      [0.77, 0.37],
      [1, 0],
    ],
  },
  {
    id: 'offset',
    tier: 'middle',
    label: '偏肩独峰',
    shape: [
      [-1, 0],
      [-0.81, 0.43],
      [-0.54, 1],
      [-0.3, 0.7],
      [-0.07, 0.42],
      [0.24, 0.48],
      [0.51, 0.32],
      [0.77, 0.22],
      [1, 0],
    ],
  },
  {
    id: 'round-hill',
    tier: 'low',
    label: '圆缓矮山',
    smooth: 2,
    shape: [
      [-1, 0],
      [-0.71, 0.32],
      [-0.45, 0.67],
      [-0.08, 1],
      [0.24, 0.93],
      [0.57, 0.56],
      [0.78, 0.2],
      [1, 0],
    ],
  },
  {
    id: 'low-saddle',
    tier: 'low',
    label: '双丘鞍岭',
    smooth: 1,
    shape: [
      [-1, 0],
      [-0.76, 0.44],
      [-0.44, 1],
      [-0.1, 0.46],
      [0.17, 0.39],
      [0.52, 0.87],
      [0.81, 0.4],
      [1, 0],
    ],
  },
  {
    id: 'rolling-ridge',
    tier: 'low',
    label: '起伏长岭',
    smooth: 1,
    shape: [
      [-1, 0],
      [-0.79, 0.47],
      [-0.61, 0.62],
      [-0.39, 0.49],
      [-0.11, 1],
      [0.13, 0.73],
      [0.32, 0.55],
      [0.56, 0.77],
      [0.8, 0.35],
      [1, 0],
    ],
  },
  {
    id: 'rock-knoll',
    tier: 'low',
    label: '岩丘独峰',
    shape: [
      [-1, 0],
      [-0.68, 0.19],
      [-0.36, 0.26],
      [-0.21, 0.74],
      [0.04, 1],
      [0.24, 0.84],
      [0.32, 0.3],
      [0.65, 0.19],
      [1, 0],
    ],
  },
  {
    id: 'low-table',
    tier: 'low',
    label: '小型台地',
    shape: [
      [-1, 0],
      [-0.78, 0.24],
      [-0.58, 0.79],
      [-0.28, 0.94],
      [0.12, 1],
      [0.46, 0.86],
      [0.63, 0.38],
      [1, 0],
    ],
  },
  {
    id: 'fan',
    tier: 'low',
    label: '扇状缓山',
    smooth: 1,
    shape: [
      [-1, 0],
      [-0.84, 0.34],
      [-0.62, 0.49],
      [-0.33, 0.7],
      [0.1, 1],
      [0.31, 0.67],
      [0.52, 0.41],
      [0.76, 0.22],
      [1, 0],
    ],
  },
  {
    id: 'off-knoll',
    tier: 'low',
    label: '偏置丘峰',
    smooth: 2,
    shape: [
      [-1, 0],
      [-0.75, 0.19],
      [-0.51, 0.3],
      [-0.24, 0.34],
      [0.06, 0.67],
      [0.4, 1],
      [0.63, 0.76],
      [0.8, 0.35],
      [1, 0],
    ],
  },
  {
    id: 'broken-low',
    tier: 'low',
    label: '崎岖低脊',
    shape: [
      [-1, 0],
      [-0.79, 0.45],
      [-0.56, 0.33],
      [-0.39, 0.89],
      [-0.14, 0.61],
      [0.12, 1],
      [0.39, 0.58],
      [0.54, 0.66],
      [0.77, 0.2],
      [1, 0],
    ],
  },
  {
    id: 'soft-mound',
    tier: 'very-low',
    label: '平缓丘包',
    smooth: 3,
    shape: [
      [-1, 0],
      [-0.79, 0.24],
      [-0.56, 0.62],
      [-0.22, 0.91],
      [0.13, 1],
      [0.46, 0.77],
      [0.75, 0.3],
      [1, 0],
    ],
  },
  {
    id: 'tiny-twins',
    tier: 'very-low',
    label: '低矮双丘',
    smooth: 2,
    shape: [
      [-1, 0],
      [-0.78, 0.49],
      [-0.44, 1],
      [-0.1, 0.62],
      [0.22, 0.48],
      [0.53, 0.83],
      [0.8, 0.39],
      [1, 0],
    ],
  },
  {
    id: 'earth-wave',
    tier: 'very-low',
    label: '波浪土脊',
    smooth: 2,
    shape: [
      [-1, 0],
      [-0.82, 0.54],
      [-0.54, 0.79],
      [-0.29, 0.56],
      [-0.06, 0.8],
      [0.2, 1],
      [0.47, 0.62],
      [0.73, 0.43],
      [1, 0],
    ],
  },
  {
    id: 'oval',
    tier: 'very-low',
    label: '椭圆浅丘',
    smooth: 3,
    shape: [
      [-1, 0],
      [-0.79, 0.55],
      [-0.51, 0.85],
      [-0.23, 0.99],
      [0.08, 1],
      [0.41, 0.88],
      [0.73, 0.61],
      [1, 0],
    ],
  },
  {
    id: 'earth-bank',
    tier: 'very-low',
    label: '短崖土岗',
    smooth: 1,
    shape: [
      [-1, 0],
      [-0.76, 0.2],
      [-0.48, 0.48],
      [-0.18, 0.82],
      [0.16, 1],
      [0.39, 0.92],
      [0.54, 0.25],
      [0.8, 0.11],
      [1, 0],
    ],
  },
  {
    id: 'apron',
    tier: 'very-low',
    label: '扇状山脚',
    smooth: 2,
    shape: [
      [-1, 0],
      [-0.82, 0.41],
      [-0.54, 0.5],
      [-0.24, 0.66],
      [0.17, 1],
      [0.44, 0.57],
      [0.7, 0.33],
      [1, 0],
    ],
  },
  {
    id: 'hillocks',
    tier: 'very-low',
    label: '起伏丘群',
    smooth: 2,
    shape: [
      [-1, 0],
      [-0.81, 0.43],
      [-0.65, 0.75],
      [-0.4, 0.56],
      [-0.12, 1],
      [0.14, 0.6],
      [0.44, 0.79],
      [0.73, 0.36],
      [1, 0],
    ],
  },
  {
    id: 'long-slope',
    tier: 'very-low',
    label: '缓长坡丘',
    smooth: 2,
    shape: [
      [-1, 0],
      [-0.82, 0.18],
      [-0.57, 0.38],
      [-0.3, 0.49],
      [-0.03, 0.64],
      [0.35, 1],
      [0.62, 0.81],
      [0.82, 0.31],
      [1, 0],
    ],
  },
];

const treatments = ['原生岩脊', '断肩沟壑', '展开肩峰', '偏置支脊'];
const mix = (a: MapPoint, b: MapPoint, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const snap = (n: number) => Math.round(n * 100000) / 100000;

function soften(points: MapPoint[], passes: number) {
  for (let pass = 0; pass < passes; pass++) {
    const next = [points[0]];
    for (let i = 1; i < points.length; i++)
      next.push(mix(points[i - 1], points[i], 0.25), mix(points[i - 1], points[i], 0.75));
    next.push(points.at(-1)!);
    points = next;
  }
  return points;
}

function profile(family: Family, variant: number): MountainStyle {
  const tier = mountainTiers.find((t) => t.id === family.tier)!;
  let outline = family.shape.map(([x, y]) => ({ x, y: -y }));
  if (variant === 1) {
    const next: MapPoint[] = [];
    for (let i = 0; i < outline.length - 1; i++) {
      const a = outline[i],
        b = outline[i + 1];
      next.push(a);
      if (i === 1 || i === outline.length - 4) {
        const ledge = mix(a, b, 0.4),
          notch = mix(a, b, 0.67);
        ledge.y -= 0.06;
        notch.y += 0.13;
        next.push(ledge, notch);
      }
    }
    next.push(outline.at(-1)!);
    outline = next;
  } else if (variant === 2) {
    outline = outline.map((p, i) => ({
      x: p.x + Math.sin(((p.x + 1) * Math.PI) / 2) * 0.08,
      y:
        i === 0 || i === outline.length - 1
          ? 0
          : p.y -
            0.16 * Math.exp(-(((p.x + 0.39) / 0.23) ** 2)) +
            0.12 * Math.exp(-(((p.x - 0.15) / 0.18) ** 2)),
    }));
  } else if (variant === 3) {
    outline = outline.map((p, i) => ({
      x: p.x - Math.sin(((p.x + 1) * Math.PI) / 2) * 0.17,
      y:
        i === 0 || i === outline.length - 1
          ? 0
          : p.y + 0.12 * Math.sin(p.x * 5.4 + 1.3) * Math.sin(((p.x + 1) * Math.PI) / 2),
    }));
  }
  outline = soften(
    outline.map((p) => ({ ...p, y: Math.min(0, p.y) })),
    family.smooth ?? 0,
  );
  const top = Math.min(...outline.map((p) => p.y));
  outline = outline.map((p) => ({ x: snap(p.x), y: snap(p.y / -top) }));
  const summitIndex = outline.reduce((best, p, i) => (p.y < outline[best].y ? i : best), 0);
  const summit = outline[summitIndex];
  const endX = clamp(summit.x * 0.35 + [0.29, 0.14, 0.48, -0.08][variant], -0.32, 0.57);
  const crest = [
    summit,
    { x: summit.x + [0.06, -0.05, 0.12, -0.12][variant], y: -0.79 },
    { x: summit.x * 0.7 + [0.04, 0.13, -0.08, 0.07][variant], y: -0.55 },
    { x: endX * 0.74, y: -0.3 },
    { x: endX, y: 0.13 },
  ];
  // Keep even strongly offset rock ridges underneath their own skyline.
  for (const point of crest.slice(1)) {
    const edge = outline.findIndex((p, i) => i > 0 && p.x >= point.x);
    if (edge > 0) {
      const a = outline[edge - 1],
        b = outline[edge];
      const roof = mix(a, b, (point.x - a.x) / (b.x - a.x)).y;
      point.y = Math.max(point.y, roof + 0.025);
    }
  }
  const spurCount = family.tier === 'very-low' ? 1 : variant === 1 || variant === 3 ? 3 : 2;
  const spurs = Array.from({ length: spurCount }, (_, i) => {
    const at = crest[2 + (i % 2)];
    const end = { x: (i % 2 ? 0.76 : -0.73) + variant * 0.04, y: 0.02 };
    return [at, mix(at, end, 0.46), end];
  });
  return {
    id: `${family.tier}/${family.id}/${variant + 1}`,
    label: `${family.label}·${treatments[variant]}`,
    tier: family.tier,
    family: family.id,
    outline,
    summitIndex,
    crest,
    spurs,
    hatchCount:
      (family.tier === 'high'
        ? 13
        : family.tier === 'middle'
          ? 10
          : family.tier === 'low'
            ? 7
            : 4) + variant,
    lightHatches: family.tier === 'very-low' ? 2 : 3 + (variant % 3),
    width: tier.width,
    rise: tier.rise,
  };
}

export const MOUNTAIN_STYLES: readonly MountainStyle[] = families.flatMap((f) =>
  Array.from({ length: 4 }, (_, i) => profile(f, i)),
);

export function mountainTier(elevation: number): MountainTier {
  return elevation >= 0.68
    ? 'high'
    : elevation >= 0.48
      ? 'middle'
      : elevation >= 0.32
        ? 'low'
        : 'very-low';
}

function variation(seed: number, index: number, channel: number) {
  let n = Math.imul(index + 1, 374761393) ^ Math.imul(channel + 1, 668265263) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/** Stable, geography-aware style assignment. Each tier exhausts its bag before
 * reuse, with nearby identical families penalized independently of the bag. */
export function assignMountainStyles(
  nodes: (MapPoint & { elevation: number })[],
  seed: number,
  scale: number,
) {
  const use = new Map<string, number>();
  const assigned: MountainStyle[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const tier = mountainTier(nodes[i].elevation);
    const nearby = assigned
      .map((style, j) => ({
        style,
        d: Math.hypot(nodes[j].x - nodes[i].x, nodes[j].y - nodes[i].y),
      }))
      .filter((p) => p.d < 100 * scale);
    const available = MOUNTAIN_STYLES.filter((s) => s.tier === tier);
    const priority = (style: MountainStyle) =>
      (use.get(style.id) ?? 0) * 1000 +
      nearby.reduce(
        (sum, p) =>
          sum +
          (p.style.family === style.family ? 12 : 0) * (1 - p.d / (100 * scale)) +
          (p.style.id === style.id ? 100 : 0),
        0,
      ) +
      variation(seed, MOUNTAIN_STYLES.indexOf(style), i + 61);
    const style = available.reduce((best, s) => (priority(s) < priority(best) ? s : best));
    assigned.push(style);
    use.set(style.id, (use.get(style.id) ?? 0) + 1);
  }
  return assigned;
}
