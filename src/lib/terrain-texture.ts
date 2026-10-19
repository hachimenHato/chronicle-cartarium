import type {
  GeneratedSettlement,
  MapObject,
  MapPoint,
  TerrainBiome,
} from '../../shared/cartography';
import type { GeneratedGeography, GeographicCell } from '../../shared/geography';
import type { GeneratedMapSnapshot } from '../../shared/generated-map';
import type { AtlasMap } from '../../shared/model';
import { distanceToSegment, pointInPolygon } from './terrain';
import { drawTerrainMotif, TerrainPen } from './terrain-motifs';

export interface TerrainInk {
  biome: TerrainBiome;
  line: string;
  shade: string;
  light: string;
  marks: number;
}
export interface TerrainTexture {
  biomes: TerrainInk[];
  slope: string;
  slopeLight: string;
  marks: number;
}
export interface TerrainTextureObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface TerrainTextureOptions {
  mapKind?: AtlasMap['kind'];
  /** Visible objects only: hidden roads and labels do not leave ghost clearings. */
  objects?: readonly MapObject[];
  sites?: readonly GeneratedSettlement[];
  obstacles?: readonly TerrainTextureObstacle[];
}
type Grid = GeneratedMapSnapshot['elevation'];
export const TERRAIN_TEXTURE_LIMITS = {
  marks: 6400,
  samples: 12000,
  pathCharacters: 2_800_000,
  spatialReferences: 200_000,
  polygonChecks: 240_000,
} as const;
function hash(a: number, b: number, seed: number) {
  let value = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}
function patchNoise(x: number, y: number, seed: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    tx = x - ix,
    ty = y - iy,
    sx = tx * tx * (3 - 2 * tx),
    sy = ty * ty * (3 - 2 * ty);
  return (
    (hash(ix, iy, seed) * (1 - sx) + hash(ix + 1, iy, seed) * sx) * (1 - sy) +
    (hash(ix, iy + 1, seed) * (1 - sx) + hash(ix + 1, iy + 1, seed) * sx) * sy
  );
}
function coprimeStride(total: number) {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  let stride = Math.floor(total * 0.61803398875) | 1;
  while (gcd(stride, total) !== 1) stride += 2;
  return stride;
}
function bounds(points: readonly MapPoint[]): TerrainTextureObstacle {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
/** Index once; the global stencil never uses administrative cell edges as clipping edges. */
function cellSampler(g: GeneratedGeography, unit: number) {
  const size = Math.max(unit * 24, Math.sqrt((g.width * g.height) / Math.max(1, g.cells.length)));
  const bins = new Map<string, GeographicCell[]>();
  let references = 0,
    checks = 0;
  cells: for (const cell of g.cells) {
    if (cell.polygon.length < 3) continue;
    const b = bounds(cell.polygon);
    for (let row = Math.floor(b.y / size); row <= Math.floor((b.y + b.height) / size); row++)
      for (let col = Math.floor(b.x / size); col <= Math.floor((b.x + b.width) / size); col++) {
        if (++references > TERRAIN_TEXTURE_LIMITS.spatialReferences) break cells;
        const key = `${col}:${row}`,
          items = bins.get(key);
        if (items) items.push(cell);
        else bins.set(key, [cell]);
      }
  }
  return (p: MapPoint) => {
    for (const cell of bins.get(`${Math.floor(p.x / size)}:${Math.floor(p.y / size)}`) ?? []) {
      if (++checks > TERRAIN_TEXTURE_LIMITS.polygonChecks) return undefined;
      if (pointInPolygon(p, cell.polygon)) return cell;
    }
    return undefined;
  };
}
type Obstacle =
  | { kind: 'box'; bounds: TerrainTextureObstacle }
  | { kind: 'line'; a: MapPoint; b: MapPoint; width: number };
/** Leave quiet paper around routes, built areas and lettering without adding SVG masks. */
function obstacleSampler(options: TerrainTextureOptions, unit: number) {
  const size = unit * 36,
    reach = unit * 20,
    bins = new Map<string, Obstacle[]>();
  let references = 0;
  const add = (item: Obstacle, b: TerrainTextureObstacle) => {
    if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) return;
    for (
      let row = Math.floor((b.y - reach) / size);
      row <= Math.floor((b.y + b.height + reach) / size);
      row++
    )
      for (
        let col = Math.floor((b.x - reach) / size);
        col <= Math.floor((b.x + b.width + reach) / size);
        col++
      ) {
        if (++references > TERRAIN_TEXTURE_LIMITS.spatialReferences) return;
        const key = `${col}:${row}`,
          items = bins.get(key);
        if (items) items.push(item);
        else bins.set(key, [item]);
      }
  };
  const box = (b: TerrainTextureObstacle) => add({ kind: 'box', bounds: b }, b);
  for (const b of options.obstacles ?? []) box(b);
  for (const site of options.sites ?? []) {
    const radius = unit * (site.kind === 'city' || site.kind === 'castle' ? 10 : 7);
    box({ x: site.x - radius, y: site.y - radius, width: radius * 2, height: radius * 2 });
  }
  for (const object of options.objects ?? []) {
    if (!object.visible || !object.points.length) continue;
    const p = object.points[0];
    if (object.kind === 'text' && object.text) {
      const unrotatedWidth = [...object.text].length * object.size,
        unrotatedHeight = object.size * 1.3,
        angle = (object.rotation * Math.PI) / 180,
        c = Math.abs(Math.cos(angle)),
        s = Math.abs(Math.sin(angle)),
        width = unrotatedWidth * c + unrotatedHeight * s,
        height = unrotatedWidth * s + unrotatedHeight * c;
      box({ x: p.x - width / 2, y: p.y - height / 2, width, height });
    } else if (
      object.kind === 'symbol' &&
      object.symbol &&
      ![
        'tree',
        'pine',
        'mountain',
        'hill',
        'dune',
        'reeds',
        'rock',
        'dead-tree',
        'glacier',
      ].includes(object.symbol)
    ) {
      box({
        x: p.x - object.size * 0.65,
        y: p.y - object.size * 0.65,
        width: object.size * 1.3,
        height: object.size * 1.3,
      });
    } else if (
      ['path', 'polygon'].includes(object.kind) &&
      /河流|河道|道路/.test(object.name) &&
      !/[岸]|· (水面|边缘|路基)/.test(object.name)
    ) {
      const width = (object.kind === 'path' ? object.strokeWidth / 2 : 0) + unit * 1.1;
      const count = object.points.length - (object.kind === 'path' ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const a = object.points[i],
          b = object.points[(i + 1) % object.points.length],
          edge = bounds([a, b]);
        add(
          { kind: 'line', a, b, width },
          {
            x: edge.x - width,
            y: edge.y - width,
            width: edge.width + width * 2,
            height: edge.height + width * 2,
          },
        );
      }
    }
  }
  return (p: MapPoint, radius: number) => {
    for (const item of bins.get(`${Math.floor(p.x / size)}:${Math.floor(p.y / size)}`) ?? []) {
      if (item.kind === 'line') {
        if (distanceToSegment(p, item.a, item.b) < item.width + radius * 0.42) return false;
      } else {
        const b = item.bounds;
        if (
          p.x >= b.x - radius &&
          p.x <= b.x + b.width + radius &&
          p.y >= b.y - radius &&
          p.y <= b.y + b.height + radius
        )
          return false;
      }
    }
    return true;
  };
}
function heightSampler(grid: Grid) {
  if (!grid) return undefined;
  return (x: number, y: number) => {
    const gx = Math.max(0, Math.min(grid.columns - 1, (x / grid.width) * grid.columns - 0.5)),
      gy = Math.max(0, Math.min(grid.rows - 1, (y / grid.height) * grid.rows - 0.5)),
      ix = Math.floor(gx),
      iy = Math.floor(gy),
      tx = gx - ix,
      ty = gy - iy,
      at = (dx: number, dy: number) =>
        grid.values[
          Math.min(grid.rows - 1, iy + dy) * grid.columns + Math.min(grid.columns - 1, ix + dx)
        ];
    return (
      (at(0, 0) * (1 - tx) + at(1, 0) * tx) * (1 - ty) + (at(0, 1) * (1 - tx) + at(1, 1) * tx) * ty
    );
  };
}
const densities: Record<TerrainBiome, number> = {
  water: 0,
  grass: 0.5,
  forest: 0.8,
  rainforest: 0.88,
  taiga: 0.78,
  mountain: 0.65,
  hill: 0.63,
  plateau: 0.6,
  desert: 0.56,
  swamp: 0.69,
  snow: 0.45,
  badlands: 0.67,
  tundra: 0.51,
  savanna: 0.6,
};
/** Deterministic display-only paths. Pan/zoom do not participate in this calculation. */
export function buildTerrainTexture(
  g: GeneratedGeography,
  elevation?: Grid,
  options: TerrainTextureOptions = {},
): TerrainTexture {
  const unit = Math.max(g.width, g.height) / 1000,
    kind = options.mapKind ?? 'world',
    step = unit * (kind === 'world' ? 10.2 : kind === 'region' ? 12 : 14.4),
    scale = kind === 'world' ? 0.84 : kind === 'region' ? 1 : 1.2,
    grouped = new Map<TerrainBiome, TerrainInk>(),
    height = heightSampler(elevation),
    cellAt = cellSampler(g, unit),
    clear = obstacleSampler(options, unit);
  let slope = '',
    slopeLight = '',
    marks = 0,
    characters = 0,
    samples = 0;
  const columns = Math.ceil(g.width / step),
    rows = Math.ceil(g.height / step),
    total = columns * rows,
    stride = coprimeStride(total),
    offset = Math.floor(hash(1, 1, g.seed + 91) * total);
  // Permuting the complete stencil distributes a bounded budget over the whole map,
  // rather than leaving an empty strip at the bottom of especially dense forests.
  for (let sample = 0; sample < total; sample++) {
    if (marks >= TERRAIN_TEXTURE_LIMITS.marks || samples++ >= TERRAIN_TEXTURE_LIMITS.samples) break;
    const index = (offset + sample * stride) % total,
      col = index % columns,
      row = Math.floor(index / columns);
    const position = {
      x: (col + 0.14 + hash(col, row, g.seed + 7) * 0.72) * step,
      y: (row + 0.14 + hash(col, row, g.seed + 9) * 0.72) * step,
    };
    if (
      position.x >= g.width ||
      position.y >= g.height ||
      (height && height(position.x, position.y) < 0)
    )
      continue;
    const cell = cellAt(position);
    if (!cell?.land || cell.biome === 'water') continue;
    // Slow variation creates connected copses and quiet openings across cell boundaries.
    const patch = patchNoise(position.x / (unit * 78), position.y / (unit * 78), g.seed + 21),
      density = Math.min(0.98, densities[cell.biome] + (patch - 0.35) * 0.55);
    if (hash(col, row, g.seed + 13) > density) continue;
    const size = unit * scale * (0.66 + hash(col, row, g.seed + 1) * 0.5 + patch * 0.19);
    if (!clear(position, size * 10.8)) continue;
    const angle =
        (patchNoise(position.x / (unit * 110), position.y / (unit * 110), g.seed + 31) - 0.5) *
          0.48 +
        (hash(col, row, g.seed + 2) - 0.5) * 0.25,
      stretch = 0.8 + hash(col, row, g.seed + 4) * 0.38,
      line = new TerrainPen(position.x, position.y, size, angle, stretch),
      shade = new TerrainPen(position.x, position.y, size, angle, stretch),
      light = new TerrainPen(position.x, position.y, size, angle, stretch);
    drawTerrainMotif(
      cell.biome,
      line,
      shade,
      light,
      hash(col, row, g.seed + 3),
      hash(col, row, g.seed + 5),
    );
    let darkSlope = '',
      brightSlope = '';
    if (height && height(position.x, position.y) > 0) {
      const reach = unit * 5,
        dx = height(position.x + reach, position.y) - height(position.x - reach, position.y),
        dy = height(position.x, position.y + reach) - height(position.x, position.y - reach),
        magnitude = Math.hypot(dx, dy);
      if (magnitude > 120) {
        const aspect = Math.atan2(dy, dx),
          pen = new TerrainPen(position.x, position.y, size, aspect);
        pen.m(-5, -2).q(-1, -1, 3, 0).m(-3, 0).q(0, 1, 4, 2);
        if ((dx + dy) / magnitude > 0) brightSlope = pen.value;
        else darkSlope = pen.value;
      }
    }
    const length =
      line.value.length +
      shade.value.length +
      light.value.length +
      darkSlope.length +
      brightSlope.length;
    if (!length) continue;
    if (characters + length > TERRAIN_TEXTURE_LIMITS.pathCharacters) break;
    characters += length;
    const ink = grouped.get(cell.biome) ?? {
      biome: cell.biome,
      line: '',
      shade: '',
      light: '',
      marks: 0,
    };
    ink.line += line.value;
    ink.shade += shade.value;
    ink.light += light.value;
    ink.marks++;
    grouped.set(cell.biome, ink);
    marks++;
    slope += darkSlope;
    slopeLight += brightSlope;
  }
  return { biomes: [...grouped.values()], slope, slopeLight, marks };
}
