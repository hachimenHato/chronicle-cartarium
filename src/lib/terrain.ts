/** Seeded, resolution-independent cartography. All geometry is stored in map units. */
export interface Point {
  x: number;
  y: number;
}
export interface Landmass {
  points: Point[];
  path: string;
  elevation: string[];
}
export interface MapSymbol extends Point {
  size: number;
  kind: 'mountain' | 'tree';
  shade: number;
}
export interface TownBlock {
  points: Point[];
  path: string;
  shade: number;
}
export interface Terrain {
  land: Landmass[];
  symbols: MapSymbol[];
  rivers: Point[][];
  roads: Point[][];
  blocks: TownBlock[];
  wall: Point[];
}

export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const n = (value: number) => Number(value.toFixed(2));
export function linePath(points: Point[], close = false): string {
  return points.length
    ? points.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)},${n(p.y)}`).join(' ') + (close ? ' Z' : '')
    : '';
}
export function smoothPath(points: Point[], closed = false): string {
  if (points.length < 3) return linePath(points, closed);
  let path = `M${n(points[0].x)},${n(points[0].y)}`;
  const len = points.length;
  for (let i = 0; i < (closed ? len : len - 1); i++) {
    const p0 = points[closed ? (i - 1 + len) % len : Math.max(0, i - 1)],
      p1 = points[i],
      p2 = points[(i + 1) % len],
      p3 = points[closed ? (i + 2) % len : Math.min(len - 1, i + 2)];
    path += ` C${n(p1.x + (p2.x - p0.x) / 6)},${n(p1.y + (p2.y - p0.y) / 6)} ${n(p2.x - (p3.x - p1.x) / 6)},${n(p2.y - (p3.y - p1.y) / 6)} ${n(p2.x)},${n(p2.y)}`;
  }
  return path + (closed ? ' Z' : '');
}
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t =
    dx === 0 && dy === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Seed 0 intentionally produces a blank canvas. This is part of the save format. */
export function generateTerrain(
  seed: number,
  width = 1000,
  height = 640,
  kind: 'world' | 'region' | 'town' = 'world',
  scaleKm?: number,
): Terrain {
  const result: Terrain = { land: [], symbols: [], rivers: [], roads: [], blocks: [], wall: [] };
  if (seed === 0) return result;
  const random = seededRandom(seed);
  const sx = width / 1000,
    sy = height / 640;
  const localScale =
    kind === 'town' && scaleKm !== undefined && scaleKm > 0
      ? Math.max(0.35, Math.min(1.1, (10 / scaleKm) ** 0.18))
      : 1;
  const scale = (p: Point): Point => ({
    x: n((490 + (p.x - 490) * localScale) * sx),
    y: n((320 + (p.y - 320) * localScale) * sy),
  });
  if (kind === 'town') {
    const bend = random() * 60;
    const river = Array.from({ length: 15 }, (_, i) => ({
      x: 640 + Math.sin(i * 0.45) * 65 + bend,
      y: (i * 640) / 14,
    }));
    result.rivers.push(river.map(scale));
    const center = { x: 450, y: 315 };
    const streetsY = [155, 235, 315, 395, 475];
    const streetsX = [210, 305, 400, 495, 590, 770];
    for (const y of streetsY)
      result.roads.push(
        [
          { x: 155, y: y + 12 },
          { x: 450, y },
          { x: 845, y: y - 15 },
        ].map(scale),
      );
    for (const x of streetsX)
      result.roads.push(
        [
          { x: x + 15, y: 125 },
          { x, y: 315 },
          { x: x - 18, y: 515 },
        ].map(scale),
      );
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 8; col++) {
        const x = 180 + col * 82 + (random() - 0.5) * 12,
          y = 155 + row * 70 + (random() - 0.5) * 10;
        if (
          Math.abs(x - (640 + Math.sin((y / 640) * 14 * 0.45) * 65 + bend)) < 45 ||
          Math.hypot(x - center.x, y - center.y) < 52
        )
          continue;
        const bw = 35 + random() * 28,
          bh = 30 + random() * 22;
        const points = [
          { x, y },
          { x: x + bw, y: y + random() * 6 },
          { x: x + bw - 3, y: y + bh },
          { x: x - 3, y: y + bh - 2 },
        ].map(scale);
        result.blocks.push({ points, path: linePath(points, true), shade: random() });
        if (random() > 0.38) {
          const small = [
            { x: x + 5, y: y + bh + 7 },
            { x: x + bw - 6, y: y + bh + 7 },
            { x: x + bw - 6, y: y + bh + 19 },
            { x: x + 5, y: y + bh + 19 },
          ].map(scale);
          result.blocks.push({ points: small, path: linePath(small, true), shade: random() });
        }
      }
    result.wall = Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      const factor = 1 + Math.sin(a * 5) * 0.035;
      return scale({ x: 490 + 355 * Math.cos(a) * factor, y: 320 + 233 * Math.sin(a) * factor });
    });
    for (let i = 0; i < 65; i++) {
      const x = 65 + random() * 860,
        y = 65 + random() * 510;
      if (Math.hypot((x - 490) / 1.5, y - 320) < 260) continue;
      result.symbols.push({
        ...scale({ x, y }),
        size: (6 + random() * 4) * sx,
        kind: 'tree',
        shade: random(),
      });
    }
    return result;
  }
  const phase = random() * Math.PI * 2;
  const blobs =
    kind === 'world'
      ? [
          { cx: 475, cy: 310, rx: 325, ry: 217 },
          { cx: 844, cy: 180, rx: 57, ry: 70 },
          { cx: 815, cy: 485, rx: 86, ry: 52 },
          { cx: 169, cy: 518, rx: 49, ry: 28 },
        ]
      : [
          { cx: 500, cy: 320, rx: 390, ry: 248 },
          { cx: 87, cy: 91, rx: 35, ry: 27 },
        ];
  for (const [index, blob] of blobs.entries()) {
    const local = phase + index * 1.63;
    const points = Array.from({ length: index === 0 ? 112 : 48 }, (_, i) => {
      const a = (i / (index === 0 ? 112 : 48)) * Math.PI * 2;
      const radius =
        1 +
        0.105 * Math.sin(a * 3 + local) +
        0.082 * Math.sin(a * 5 + local * 0.7) +
        0.042 * Math.sin(a * 11 + local) +
        0.02 * (random() - 0.5);
      return scale({
        x: blob.cx + Math.cos(a) * blob.rx * radius,
        y: blob.cy + Math.sin(a) * blob.ry * radius,
      });
    });
    const elevation = [0.82, 0.61].map((inset) =>
      smoothPath(
        points.map((p) => ({
          x: blob.cx * sx + (p.x - blob.cx * sx) * inset,
          y: blob.cy * sy + (p.y - blob.cy * sy) * inset,
        })),
        true,
      ),
    );
    result.land.push({ points, path: smoothPath(points, true), elevation });
  }
  const main = result.land[0].points;
  for (let y = 95; y < 560; y += 18)
    for (let x = 100; x < 920; x += 18) {
      const p = scale({ x: x + (random() - 0.5) * 13, y: y + (random() - 0.5) * 11 });
      if (!result.land.some((l) => pointInPolygon(p, l.points))) continue;
      const chainY = 225 + Math.sin(x / 120 + phase) * 47;
      const forest = Math.sin(x / 72 + phase) + Math.cos(y / 60) + Math.sin((x + y) / 105);
      if (Math.abs(y - chainY) < 26 && x > 290 && x < 715 && random() > 0.22)
        result.symbols.push({
          ...p,
          size: (10 + random() * 10) * sx,
          kind: 'mountain',
          shade: random(),
        });
      else if (forest > 0.62 && random() > 0.3 && Math.abs(y - chainY) > 35)
        result.symbols.push({ ...p, size: (4 + random() * 5) * sx, kind: 'tree', shade: random() });
    }
  for (let i = 0; i < 3; i++) {
    const startX = 340 + i * 132;
    const startY = 250 + Math.sin(startX / 120 + phase) * 47;
    const points: Point[] = [];
    for (let j = 0; j < 24; j++) {
      const p = scale({
        x: startX + Math.sin(j * 0.49 + phase) * 12 + j * (i === 1 ? -1 : 1) * 2.1,
        y: startY + j * 12,
      });
      points.push(p);
      if (j > 2 && !pointInPolygon(p, main)) break;
    }
    result.rivers.push(points);
  }
  result.symbols.sort((a, b) => a.y - b.y);
  return result;
}
