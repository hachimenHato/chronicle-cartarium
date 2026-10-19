import type { MapObject, MapPoint } from '../../shared/cartography';
import type { MountainStyle } from './mountain-styles';
import { pointInPolygon } from './terrain';

const mix = (a: MapPoint, b: MapPoint, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const distance = (a: MapPoint, b: MapPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const reversed = (points: MapPoint[]) => [...points].reverse();
function variation(seed: number, index: number, channel: number) {
  let n = Math.imul(index + 1, 374761393) ^ Math.imul(channel + 1, 668265263) ^ seed;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export interface MountainPeak {
  style: MountainStyle;
  anchor: MapPoint;
  outline: MapPoint[];
  feet: MapPoint[];
  crest: MapPoint[];
  spurs: MapPoint[][];
  summit: MapPoint;
  summitIndex: number;
  half: number;
  rise: number;
}

export function projectMountainStyle(
  style: MountainStyle,
  anchor: MapPoint,
  half: number,
  rise: number,
): MountainPeak {
  const project = (p: MapPoint) => ({ x: anchor.x + p.x * half, y: anchor.y + p.y * rise });
  const outline = style.outline.map(project);
  const feet = [
    { x: 1, y: 0 },
    { x: 0.76, y: 0.16 },
    { x: 0.43, y: 0.19 },
    { x: 0.05, y: 0.15 },
    { x: -0.34, y: 0.21 },
    { x: -0.71, y: 0.13 },
    { x: -1, y: 0 },
  ].map(project);
  return {
    style,
    anchor,
    outline,
    feet,
    crest: style.crest.map(project),
    spurs: style.spurs.map((points) => points.map(project)),
    summit: outline[style.summitIndex],
    summitIndex: style.summitIndex,
    half,
    rise,
  };
}

export const mountainBody = (peak: MountainPeak) => [...peak.outline, ...peak.feet.slice(1, -1)];

function curve(a: MapPoint, b: MapPoint, bend: number, count = 8) {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1),
      p = mix(a, b, t);
    return { x: p.x + Math.sin(t * Math.PI) * bend, y: p.y + Math.sin(t * Math.PI) * bend * 0.25 };
  });
}
function above(polygon: MapPoint[], y: number) {
  const out: MapPoint[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    if (a.y <= y) out.push(a);
    if (a.y <= y !== b.y <= y) out.push(mix(a, b, (y - a.y) / (b.y - a.y)));
  }
  return out;
}
function along(points: MapPoint[], t: number) {
  const lengths = points.slice(1).map((p, i) => distance(points[i], p));
  let left = lengths.reduce((sum, n) => sum + n, 0) * t;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i]) return mix(points[i], points[i + 1], left / (lengths[i] || 1));
    left -= lengths[i];
  }
  return points.at(-1)!;
}
// Each filled pen ring returns along its bridge. The bridge has zero area and
// no outline, so multiple independent strokes remain one ordinary editable object.
function ink(strokes: MapPoint[][], thickness: number) {
  const loops = strokes.map((stroke) => {
    const sides = [-1, 1].map((side) =>
      stroke.map((p, i) => {
        const a = stroke[Math.max(0, i - 1)],
          b = stroke[Math.min(stroke.length - 1, i + 1)];
        const length = distance(a, b) || 1;
        const taper =
          i === 0 || i === stroke.length - 1
            ? 0
            : Math.sqrt(Math.max(0, Math.sin((Math.PI * i) / (stroke.length - 1))));
        return {
          x: p.x - ((b.y - a.y) / length) * thickness * taper * side,
          y: p.y + ((b.x - a.x) / length) * thickness * taper * side,
        };
      }),
    );
    return [...sides[0], ...reversed(sides[1])];
  });
  if (!loops.length) return [];
  const anchor = loops[0][0];
  return loops.flatMap((loop) => [anchor, ...loop, loop[0], anchor]);
}

/** Shared by actual generation and the 128-style gallery. At most 14 objects;
 * styles affect silhouettes, branching and pen work, never the height field. */
export function drawMountainPeak(
  peak: MountainPeak,
  scale: number,
  seed: number,
  index: number,
): MapObject[] {
  const { style, anchor, outline, feet, crest, summit, summitIndex, rise } = peak;
  const gentle = style.tier === 'very-low' ? 0.42 : style.tier === 'low' ? 0.7 : 1;
  const objects: MapObject[] = [];
  const add = (
    part: string,
    kind: 'polygon' | 'path',
    points: MapPoint[],
    color: string,
    stroke = 'none',
    strokeWidth = 0,
    opacity = 1,
  ) => {
    if (points.length < (kind === 'polygon' ? 3 : 2)) return;
    objects.push({
      id: `peak-${index}-${objects.length}`,
      name: `古典山脉 · ${style.id} ${style.label} · ${part}`,
      kind,
      points,
      color,
      stroke,
      strokeWidth: strokeWidth * scale,
      opacity,
      text: '',
      size: 24,
      rotation: 0,
      visible: true,
      locked: false,
    });
  };
  const body = mountainBody(peak);
  add(
    '山脚淡彩过渡',
    'polygon',
    [
      ...outline,
      ...feet.slice(1, -1).map((p) => ({
        x: anchor.x + (p.x - anchor.x) * 1.2,
        y: anchor.y + (p.y - anchor.y) * 1.2,
      })),
    ],
    '#9b8664',
    'none',
    0,
    0.075 * gentle,
  );
  add('连绵山体', 'polygon', body, '#e8dcc0', 'none', 0, 0.38);
  add('连绵山体', 'polygon', above(body, anchor.y - rise * 0.08), '#e8dcc0', 'none', 0, 0.56);
  add('连绵山体', 'polygon', above(body, anchor.y - rise * 0.33), '#e8dcc0', 'none', 0, 0.8);
  const shadow = [...outline.slice(summitIndex), ...feet.slice(1, 4), ...reversed(crest.slice(1))];
  const light = [...outline.slice(0, summitIndex + 1), ...crest.slice(1), ...feet.slice(3, -1)];
  add(
    '向阳淡彩',
    'polygon',
    above(light, anchor.y - rise * 0.08),
    '#fff1d4',
    'none',
    0,
    0.25 * gentle,
  );
  add('背阴淡彩', 'polygon', shadow, '#8e8471', 'none', 0, 0.14 * gentle);
  add(
    '背阴淡彩',
    'polygon',
    above(shadow, anchor.y - rise * 0.08),
    '#8e8471',
    'none',
    0,
    0.17 * gentle,
  );
  add(
    '岩面局部阴影',
    'polygon',
    [summit, along(outline.slice(summitIndex), 0.2), crest[2], crest[1]],
    '#75694f',
    'none',
    0,
    0.2 * gentle,
  );
  add('分叉岩脊', 'path', crest, 'none', '#786149', 0.35, 0.7 * gentle);
  const spurs = peak.spurs
    .map((points, i) => {
      const path = [
        ...curve(points[0], points[1], (i % 2 ? -1 : 1) * scale * 0.4),
        ...curve(points[1], points[2], -0.6 * scale).slice(1),
      ];
      return path.filter((p) => pointInPolygon(p, body));
    })
    .filter((p) => p.length >= 3);
  add('分叉岩脊', 'polygon', ink(spurs, 0.12 * scale), '#907555', 'none', 0, 0.54 * gentle);
  const shaded: MapPoint[][] = [],
    lit: MapPoint[][] = [];
  for (let j = 1; j <= style.hatchCount; j++) {
    const t = j / (style.hatchCount + 1);
    const start = along(outline.slice(summitIndex), t * 0.9);
    const end = mix(crest.at(-1)!, feet[0], t * 0.93);
    const stroke = curve(
      mix(start, end, 0.07),
      mix(start, end, 0.59 + variation(seed, index + j, 23) * 0.3),
      (variation(seed, index + j, 24) - 0.5) * 2.4 * scale,
    );
    if (stroke.every((p) => pointInPolygon(p, shadow))) shaded.push(stroke);
  }
  for (let j = 1; j <= style.lightHatches; j++) {
    const t = j / (style.lightHatches + 1);
    const start = along(outline.slice(0, summitIndex + 1), 0.12 + t * 0.79);
    const end = mix(feet.at(-1)!, crest.at(-1)!, t);
    const stroke = curve(
      mix(start, end, 0.13),
      mix(start, end, 0.53 + variation(seed, index + j, 25) * 0.1),
      -scale * 0.6,
    );
    if (stroke.every((p) => pointInPolygon(p, light))) lit.push(stroke);
  }
  add('细钢笔排线', 'polygon', ink(shaded, 0.17 * scale), '#756047', 'none', 0, 0.74 * gentle);
  add('细钢笔排线', 'polygon', ink(lit, 0.11 * scale), '#9b805b', 'none', 0, 0.53 * gentle);
  add('峰谷轮廓', 'path', outline.slice(1, -1), 'none', '#6b553c', 0.32 + gentle * 0.2, 0.83);
  add('山脚断续线', 'path', feet.slice(1, 4), 'none', '#a18a65', 0.23, 0.29 * gentle);
  return objects;
}
