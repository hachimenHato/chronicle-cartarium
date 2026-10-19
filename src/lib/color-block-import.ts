import { biomeCatalog, MAP_EDITOR_LIMITS } from '../../shared/cartography';
import type { MapPoint, MapRegion, TerrainBiome } from '../../shared/cartography';
import { makeId } from '../../shared/model';

export const COLOR_BLOCK_RESOLUTIONS = [24, 40, 64] as const;
export type ColorBlockResolution = (typeof COLOR_BLOCK_RESOLUTIONS)[number];
const MAX_IMPORT_POINTS = 16_000;

export interface ColorBlockPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}
export interface ImportedColorBlock {
  biome: TerrainBiome;
  /** Normalized coordinates, independent of the subsequently chosen map size. */
  points: MapPoint[];
  area: number;
}
export interface ColorBlockImportResult {
  blocks: ImportedColorBlock[];
  gridWidth: number;
  gridHeight: number;
  reduced: boolean;
  counts: Partial<Record<TerrainBiome, number>>;
}

export const colorBlockPalette = biomeCatalog.map((biome) => {
  const rgb = [1, 3, 5].map((offset) => Number.parseInt(biome.color.slice(offset, offset + 2), 16));
  return { ...biome, rgb, decimal: Number.parseInt(biome.color.slice(1), 16) };
});

// CIELAB distance separates the very similar muted greens more reliably than
// Euclidean sRGB. This is a palette decoder, not an image recognition service.
function rgbToLab(rgb: readonly number[]) {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value > 0.04045 ? ((value + 0.055) / 1.055) ** 2.4 : value / 12.92;
  });
  const transform = (value: number) =>
    value > 216 / 24389 ? Math.cbrt(value) : (value * (24389 / 27)) / 116 + 16 / 116;
  const x = transform((r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047);
  const y = transform(r * 0.2126729 + g * 0.7151522 + b * 0.072175);
  const z = transform((r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const labPalette = colorBlockPalette.map((biome) => ({ ...biome, lab: rgbToLab(biome.rgb) }));

export function nearestColorBlockBiome(rgb: readonly number[]): TerrainBiome {
  if (
    rgb.length < 3 ||
    rgb.slice(0, 3).some((value) => !Number.isFinite(value) || value < 0 || value > 255)
  )
    throw new Error('颜色必须是 0–255 的 RGB 数值。');
  const lab = rgbToLab(rgb.slice(0, 3));
  let closest = labPalette[0],
    distance = Infinity;
  for (const biome of labPalette) {
    const current = biome.lab.reduce((sum, value, i) => sum + (value - lab[i]) ** 2, 0);
    if (current < distance) {
      closest = biome;
      distance = current;
    }
  }
  return closest.id;
}

function samplePixels(image: ColorBlockPixels, longEdge: number) {
  const factor = Math.min(1, longEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * factor));
  const height = Math.max(1, Math.round(image.height * factor));
  const cells = new Uint8Array(width * height);
  const cache = new Map<number, number>();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(image.width - 1, Math.floor(((x + 0.5) * image.width) / width));
      const sourceY = Math.min(image.height - 1, Math.floor(((y + 0.5) * image.height) / height));
      const offset = (sourceY * image.width + sourceX) * 4;
      if (image.data[offset + 3] < 32) continue;
      const rgb = [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
      const key = rgb[0] * 65536 + rgb[1] * 256 + rgb[2];
      let biome = cache.get(key);
      if (biome === undefined) {
        biome = biomeCatalog.findIndex((entry) => entry.id === nearestColorBlockBiome(rgb));
        cache.set(key, biome);
      }
      cells[y * width + x] = biome;
    }
  return { cells, width, height };
}

type Edge = { from: number; to: number; direction: number };
function traceOuterBoundary(indices: number[], width: number, height: number) {
  const members = new Set(indices),
    stride = width + 1;
  const edges: Edge[] = [];
  for (const index of indices) {
    const x = index % width,
      y = Math.floor(index / width),
      start = y * stride + x;
    if (y === 0 || !members.has(index - width))
      edges.push({ from: start, to: start + 1, direction: 0 });
    if (x === width - 1 || !members.has(index + 1))
      edges.push({ from: start + 1, to: start + 1 + stride, direction: 1 });
    if (y === height - 1 || !members.has(index + width))
      edges.push({ from: start + 1 + stride, to: start + stride, direction: 2 });
    if (x === 0 || !members.has(index - 1))
      edges.push({ from: start + stride, to: start, direction: 3 });
  }
  const outgoing = new Map<number, number[]>();
  edges.forEach((edge, index) =>
    outgoing.set(edge.from, [...(outgoing.get(edge.from) || []), index]),
  );
  const visited = new Uint8Array(edges.length),
    loops: MapPoint[][] = [];
  for (let first = 0; first < edges.length; first++) {
    if (visited[first]) continue;
    const loop: MapPoint[] = [];
    let current = first;
    while (!visited[current]) {
      const edge = edges[current];
      visited[current] = 1;
      loop.push({ x: edge.from % stride, y: Math.floor(edge.from / stride) });
      if (edge.to === edges[first].from) break;
      const candidates = (outgoing.get(edge.to) || []).filter((index) => !visited[index]);
      if (!candidates.length) break;
      // At diagonal contacts, keep the component on the right of its contour.
      candidates.sort((a, b) => {
        const priority = (direction: number) => [1, 0, 3, 2][(direction - edge.direction + 4) % 4];
        return priority(edges[a].direction) - priority(edges[b].direction);
      });
      current = candidates[0];
    }
    const corners = loop.filter((point, i) => {
      const a = loop[(i + loop.length - 1) % loop.length],
        b = loop[(i + 1) % loop.length];
      return (point.x - a.x) * (b.y - point.y) !== (point.y - a.y) * (b.x - point.x);
    });
    if (corners.length >= 3) loops.push(corners);
  }
  const area = (points: MapPoint[]) =>
    Math.abs(
      points.reduce((sum, point, i) => {
        const next = points[(i + 1) % points.length];
        return sum + point.x * next.y - next.x * point.y;
      }, 0),
    ) / 2;
  return loops.sort((a, b) => area(b) - area(a))[0] || [];
}

function gridToBlocks(cells: Uint8Array, width: number, height: number) {
  const seen = new Uint8Array(cells.length),
    blocks: ImportedColorBlock[] = [];
  for (let start = 0; start < cells.length; start++) {
    if (seen[start]) continue;
    const biome = cells[start],
      component = [start];
    seen[start] = 1;
    let touchesEdge = false;
    for (let cursor = 0; cursor < component.length; cursor++) {
      const index = component[cursor],
        x = index % width,
        y = Math.floor(index / width);
      if (!x || !y || x === width - 1 || y === height - 1) touchesEdge = true;
      const neighbors = [
        y > 0 ? index - width : -1,
        x < width - 1 ? index + 1 : -1,
        y < height - 1 ? index + width : -1,
        x > 0 ? index - 1 : -1,
      ];
      for (const next of neighbors)
        if (next >= 0 && !seen[next] && cells[next] === biome) {
          seen[next] = 1;
          component.push(next);
        }
    }
    // The water backdrop already covers edge-connected oceans. Interior lakes
    // are retained and overlaid in area order, preserving holes and islands.
    if (biome === 0 && touchesEdge) continue;
    const points = traceOuterBoundary(component, width, height);
    if (points.length < 3) continue;
    const area =
      Math.abs(
        points.reduce((sum, point, i) => {
          const next = points[(i + 1) % points.length];
          return sum + point.x * next.y - next.x * point.y;
        }, 0),
      ) / 2;
    blocks.push({
      biome: biomeCatalog[biome].id,
      points: points.map((p) => ({ x: p.x / width, y: p.y / height })),
      area,
    });
  }
  blocks.sort((a, b) => b.area - a.area);
  return [
    {
      biome: 'water' as const,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      area: width * height,
    },
    ...blocks,
  ];
}

export function parseColorBlockPixels(
  image: ColorBlockPixels,
  resolution: ColorBlockResolution = 40,
): ColorBlockImportResult {
  if (
    ![image.width, image.height].every((value) => Number.isInteger(value) && value > 0) ||
    image.width * image.height > 64_000_000 ||
    image.data.length !== image.width * image.height * 4
  )
    throw new Error('图片像素尺寸无效或超过 6400 万像素。');
  if (!COLOR_BLOCK_RESOLUTIONS.includes(resolution)) throw new Error('请选择有效的解析精度。');
  let longEdge: number = resolution;
  while (true) {
    const grid = samplePixels(image, longEdge),
      blocks = gridToBlocks(grid.cells, grid.width, grid.height);
    if (
      blocks.length <= MAP_EDITOR_LIMITS.regions &&
      blocks.every((block) => block.points.length <= MAP_EDITOR_LIMITS.points) &&
      blocks.reduce((sum, block) => sum + block.points.length, 0) <= MAX_IMPORT_POINTS
    ) {
      const counts: ColorBlockImportResult['counts'] = {};
      for (const index of grid.cells)
        counts[biomeCatalog[index].id] = (counts[biomeCatalog[index].id] || 0) + 1;
      return {
        blocks,
        gridWidth: grid.width,
        gridHeight: grid.height,
        reduced: longEdge < resolution,
        counts,
      };
    }
    if (longEdge <= 8) throw new Error('图片颜色过于破碎，请使用面积较大的单色色块。');
    longEdge = Math.max(8, Math.floor(longEdge * 0.75));
  }
}

export function colorBlockRegions(
  result: ColorBlockImportResult,
  width: number,
  height: number,
  seed: number,
): MapRegion[] {
  if (![width, height].every((value) => Number.isFinite(value) && value >= 100 && value <= 10000))
    throw new Error('地图宽高应为 100–10000。');
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295)
    throw new Error('种子应为 0–4294967295 的整数。');
  return result.blocks.map((block, index) => ({
    id: makeId('region'),
    name: `${biomeCatalog.find((biome) => biome.id === block.biome)!.label} · 导入 ${index + 1}`,
    biome: block.biome,
    geometry: 'polygon',
    points: block.points.map((point) => ({
      x: Math.round(point.x * width * 1000) / 1000,
      y: Math.round(point.y * height * 1000) / 1000,
    })),
    width: 1,
    seed: (seed + index * 2654435761) >>> 0,
    roughness: 0.2,
    density: 0.55,
    visible: true,
    locked: false,
  }));
}

/** Decode locally; the source image is neither uploaded nor persisted. */
export async function importColorBlockImage(file: File, resolution: ColorBlockResolution) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
    throw new Error('请选择 PNG、JPG 或 WebP 色块图片。');
  if (!file.size || file.size > 8 * 1024 * 1024)
    throw new Error('色块图片应大于 0 且不超过 8 MB。');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 64_000_000
    )
      throw new Error('图片尺寸无效或超过 6400 万像素。');
    const ratio = resolution / Math.max(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * Math.min(1, ratio)));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * Math.min(1, ratio)));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('浏览器无法读取图片颜色，请更换浏览器后重试。');
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return parseColorBlockPixels(
      context.getImageData(0, 0, canvas.width, canvas.height),
      resolution,
    );
  } catch (error) {
    if (error instanceof Error && /^(图片|浏览器)/.test(error.message)) throw error;
    throw new Error('这张图片无法解码，请检查文件后重试。');
  } finally {
    URL.revokeObjectURL(url);
  }
}
