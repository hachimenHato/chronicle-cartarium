import type { MapPoint, MapRegion, TerrainBiome } from '../../shared/cartography';
import type { SketchShapeMode } from '../../shared/geography';
import { distanceToSegment, pointInPolygon, seededRandom } from './terrain';

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
function noise(x: number, y: number, seed: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    tx = smooth(x - ix),
    ty = smooth(y - iy);
  const hash = (a: number, b: number) => {
    let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ seed;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  return (
    (hash(ix, iy) * (1 - tx) + hash(ix + 1, iy) * tx) * (1 - ty) +
    (hash(ix, iy + 1) * (1 - tx) + hash(ix + 1, iy + 1) * tx) * ty
  );
}

export interface SketchLandSeed {
  center: MapPoint;
  area: number;
}
interface Feature extends SketchLandSeed {
  biome: TerrainBiome;
  owner: number;
  pixels: number[];
}
export interface SketchShapeField {
  field: Float64Array;
  intent: Int16Array;
  uplift: Float64Array;
  plateau: Float64Array;
  wetland: Float64Array;
  cold: Float64Array;
  landSeeds: SketchLandSeed[];
}

/** The random silhouette reads only centroid and area, never input perimeter or aspect ratio. */
export function randomizedIsland(seed: SketchLandSeed, randomSeed: number) {
  const random = seededRandom(randomSeed),
    radius = Math.sqrt(seed.area / Math.PI);
  const aspect = 0.46 + random() * 1.85,
    angle = random() * Math.PI * 2;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const bayDirection = random() * Math.PI * 2,
    bayWidth = 0.24 + random() * 0.5,
    bayDepth = 0.25 + random() * 0.42;
  const harmonics = [2, 3, 5, 7, 11].map((frequency, i) => ({
    frequency,
    phase: random() * Math.PI * 2,
    amplitude: (0.24 / (1 + i * 0.65)) * (0.65 + random() * 0.7),
  }));
  const shoreline = (theta: number) =>
    Math.max(
      0.22,
      1 +
        harmonics.reduce((n, h) => n + Math.sin(theta * h.frequency + h.phase) * h.amplitude, 0) -
        bayDepth *
          Math.exp(
            -(
              (Math.atan2(Math.sin(theta - bayDirection), Math.cos(theta - bayDirection)) /
                bayWidth) **
              2
            ),
          ),
    );
  let average = 0;
  for (let i = 0; i < 128; i++) average += shoreline((i * Math.PI) / 64) ** 2 / 128;
  const normalization = Math.sqrt(average);
  return (p: MapPoint) => {
    const centerDistance = Math.hypot(p.x - seed.center.x, p.y - seed.center.y);
    // Most small seed islands are far from a sample. Their negative exterior
    // approximation avoids evaluating several noise octaves for every island.
    if (centerDistance > radius * 3) return radius * 1.5 - centerDistance;
    const wx =
      p.x + (noise((p.x / radius) * 3, (p.y / radius) * 3, randomSeed + 871) - 0.5) * radius * 0.12;
    const wy =
      p.y + (noise((p.x / radius) * 3, (p.y / radius) * 3, randomSeed + 313) - 0.5) * radius * 0.12;
    const dx = wx - seed.center.x,
      dy = wy - seed.center.y;
    const x = (dx * cos + dy * sin) / Math.sqrt(aspect);
    const y = (-dx * sin + dy * cos) * Math.sqrt(aspect);
    return (radius * shoreline(Math.atan2(y, x))) / normalization - Math.hypot(x, y);
  };
}

/** A treats marks as loose anchors. Neither radius, brush width nor painted area is read. */
function maximalRandomLand(
  regions: MapRegion[],
  width: number,
  height: number,
  seed: number,
): Feature[] {
  const span = Math.min(width, height);
  const anchors = regions
    .flatMap((r, owner) => {
      if (!r.visible || r.biome === 'water' || !r.points.length) return [];
      const center = r.points.reduce(
        (a, p) => ({ x: a.x + p.x / r.points.length, y: a.y + p.y / r.points.length }),
        { x: 0, y: 0 },
      );
      return [
        {
          center: {
            x: (Math.round((center.x * 1000) / width) * width) / 1000,
            y: (Math.round((center.y * 1000) / height) * height) / 1000,
          },
          owner,
          biome: r.biome,
        },
      ];
    })
    .sort((a, b) => a.center.x - b.center.x || a.center.y - b.center.y);
  const merged: typeof anchors = [];
  for (const anchor of anchors)
    if (
      !merged.some(
        (a) =>
          Math.hypot(a.center.x - anchor.center.x, a.center.y - anchor.center.y) < span * 0.055,
      )
    )
      merged.push(anchor);
  const random = seededRandom(seed + 752193),
    features: Feature[] = [];
  const divisor = Math.sqrt(Math.max(1, merged.length));
  for (const anchor of merged) {
    const center = {
      x: clamp(anchor.center.x + (random() - 0.5) * width * 0.24, width * 0.08, width * 0.92),
      y: clamp(anchor.center.y + (random() - 0.5) * height * 0.24, height * 0.08, height * 0.92),
    };
    const fraction = random() < 0.38 ? 0.26 + random() * 0.32 : 0.012 + random() ** 1.5 * 0.22;
    features.push({ ...anchor, center, area: (width * height * fraction) / divisor, pixels: [] });
    const satellites = Math.floor(random() * 4);
    for (let j = 0; j < satellites && features.length < 80; j++) {
      const angle = random() * Math.PI * 2,
        distance = span * (0.13 + random() * 0.27);
      features.push({
        ...anchor,
        center: {
          x: clamp(center.x + Math.cos(angle) * distance, width * 0.04, width * 0.96),
          y: clamp(center.y + Math.sin(angle) * distance, height * 0.04, height * 0.96),
        },
        area: (width * height * (0.0008 + random() ** 2 * 0.018)) / divisor,
        pixels: [],
      });
    }
  }
  return features;
}

function regionDistance(p: MapPoint, r: MapRegion) {
  let d = Math.hypot(p.x - r.points[0].x, p.y - r.points[0].y);
  const n = r.geometry === 'polygon' ? r.points.length : r.points.length - 1;
  for (let j = 0; j < n; j++)
    d = Math.min(d, distanceToSegment(p, r.points[j], r.points[(j + 1) % r.points.length]));
  return r.geometry === 'brush' ? r.width / 2 - d : pointInPolygon(p, r.points) ? d : -d;
}

function signedRasterDistance(
  mask: Uint8Array,
  columns: number,
  rows: number,
  dx: number,
  dy: number,
) {
  const distance = new Float64Array(mask.length).fill(Math.hypot(columns * dx, rows * dy));
  for (let i = 0; i < mask.length; i++) {
    const x = i % columns,
      y = Math.floor(i / columns);
    for (const [ox, oy, length] of [
      [-1, 0, dx],
      [1, 0, dx],
      [0, -1, dy],
      [0, 1, dy],
    ]) {
      const xx = x + ox,
        yy = y + oy;
      if (xx >= 0 && yy >= 0 && xx < columns && yy < rows && mask[i] !== mask[yy * columns + xx])
        distance[i] = Math.min(distance[i], length / 2);
    }
  }
  for (const direction of [1, -1])
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < columns; col++) {
        const x = direction === 1 ? col : columns - col - 1,
          y = direction === 1 ? row : rows - row - 1;
        const i = y * columns + x;
        for (const [ox, oy] of [
          [-direction, 0],
          [0, -direction],
          [-direction, -direction],
          [direction, -direction],
        ]) {
          const xx = x + ox,
            yy = y + oy;
          if (xx >= 0 && yy >= 0 && xx < columns && yy < rows) {
            const j = yy * columns + xx;
            if (mask[i] === mask[j])
              distance[i] = Math.min(distance[i], distance[j] + Math.hypot(ox * dx, oy * dy));
          }
        }
      }
  return Float64Array.from(distance, (d, i) => (mask[i] ? 1 : -1) * d);
}

/** Interpret once, before tectonics, climate, drainage, coasts and political cells consume the surface. */
export function buildSketchShapeField(
  regions: MapRegion[],
  columns: number,
  rows: number,
  width: number,
  height: number,
  seed: number,
  mode: SketchShapeMode,
  roughness = 0.75,
): SketchShapeField {
  const n = columns * rows,
    dx = width / columns,
    dy = height / rows,
    pixelArea = dx * dy;
  const raw = new Uint8Array(n),
    owners = new Int16Array(n).fill(-1);
  const prepared = regions.map((r) => ({
    r,
    left: Math.min(...r.points.map((p) => p.x)) - r.width / 2,
    right: Math.max(...r.points.map((p) => p.x)) + r.width / 2,
    top: Math.min(...r.points.map((p) => p.y)) - r.width / 2,
    bottom: Math.max(...r.points.map((p) => p.y)) + r.width / 2,
  }));
  for (let i = 0; i < n; i++) {
    const p = { x: ((i % columns) + 0.5) * dx, y: (Math.floor(i / columns) + 0.5) * dy };
    prepared.forEach(({ r, left, right, top, bottom }, j) => {
      if (!r.visible || p.x < left || p.x > right || p.y < top || p.y > bottom) return;
      if (regionDistance(p, r) >= 0) {
        raw[i] = Number(r.biome !== 'water');
        owners[i] = j;
      }
    });
  }
  const neighbors = (i: number) => {
    const x = i % columns,
      y = Math.floor(i / columns),
      ids: number[] = [];
    if (x) ids.push(i - 1);
    if (x + 1 < columns) ids.push(i + 1);
    if (y) ids.push(i - columns);
    if (y + 1 < rows) ids.push(i + columns);
    return ids;
  };
  function components(byBiome: boolean, water = false) {
    const seen = new Uint8Array(n),
      features: Feature[] = [];
    for (let i = 0; i < n; i++) {
      if (seen[i] || Boolean(raw[i]) === water) continue;
      const biome = owners[i] >= 0 ? regions[owners[i]].biome : 'water';
      const pixels = [i];
      seen[i] = 1;
      let x = 0,
        y = 0,
        boundary = false;
      const counts = new Map<number, number>();
      for (let at = 0; at < pixels.length; at++) {
        const id = pixels[at],
          cx = id % columns,
          cy = Math.floor(id / columns);
        x += (cx + 0.5) * dx;
        y += (cy + 0.5) * dy;
        boundary ||= cx === 0 || cy === 0 || cx === columns - 1 || cy === rows - 1;
        counts.set(owners[id], (counts.get(owners[id]) ?? 0) + 1);
        for (const next of neighbors(id))
          if (
            !seen[next] &&
            Boolean(raw[next]) !== water &&
            (!byBiome || regions[owners[next]]?.biome === biome)
          ) {
            seen[next] = 1;
            pixels.push(next);
          }
      }
      // Open ocean is implicit; only closed painted lakes become independent water seeds.
      if (water && boundary) continue;
      const owner = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      features.push({
        center: { x: x / pixels.length, y: y / pixels.length },
        area: pixels.length * pixelArea,
        owner,
        biome: owner >= 0 ? regions[owner].biome : 'water',
        pixels,
      });
    }
    return features.sort((a, b) => a.center.x - b.center.x || a.center.y - b.center.y);
  }
  const lands =
      mode === 'randomized' ? maximalRandomLand(regions, width, height, seed) : components(false),
    patches = components(true).filter((f) => f.biome !== 'grass'),
    lakes = components(false, true);
  const original = signedRasterDistance(raw, columns, rows, dx, dy);
  const biomeDistances = new Map<TerrainBiome, Float64Array>();
  if (mode !== 'randomized')
    for (const biome of new Set(patches.map((patch) => patch.biome))) {
      const mask = Uint8Array.from(owners, (owner, i) =>
        Number(Boolean(raw[i]) && regions[owner]?.biome === biome),
      );
      biomeDistances.set(biome, signedRasterDistance(mask, columns, rows, dx, dy));
    }
  const field = new Float64Array(n),
    intent = new Int16Array(owners),
    uplift = new Float64Array(n),
    plateau = new Float64Array(n),
    wetland = new Float64Array(n),
    cold = new Float64Array(n);
  const landShapes = lands.map((f, i) => ({
    ...f,
    distance: randomizedIsland(f, seed + i * 14281 + 87131),
  }));
  const lakeShapes =
    mode === 'randomized' ? [] : lakes.map((f, i) => randomizedIsland(f, seed + i * 7817 + 91931));
  const patchShapes = (
    mode === 'randomized' ? lands.filter((f) => f.biome !== 'grass') : patches
  ).map((f, i) => ({
    ...f,
    distance: randomizedIsland(f, seed + i * 7193 + 3211),
  }));
  const sourceWeight = mode === 'balanced' ? 0.38 : mode === 'strict' ? 1 : 0;
  for (let i = 0; i < n; i++) {
    const p = { x: ((i % columns) + 0.5) * dx, y: (Math.floor(i / columns) + 0.5) * dy };
    let generated = -Math.hypot(width, height),
      owner = -1;
    for (const f of landShapes) {
      const d = f.distance(p);
      if (d > generated) {
        generated = d;
        owner = f.owner;
      }
    }
    for (const water of lakeShapes) generated = Math.min(generated, -water(p));
    const grain =
      noise(
        p.x / Math.max(dx * 5, width * 0.027),
        p.y / Math.max(dy * 5, height * 0.027),
        seed + 1923,
      ) - 0.5;
    field[i] =
      original[i] * sourceWeight +
      generated * (1 - sourceWeight) +
      grain *
        Math.min(width, height) *
        (mode === 'balanced' ? 0.025 * roughness : mode === 'strict' ? 0 : 0.004 * roughness);
    if (!lands.length) field[i] = original[i];
    if (
      mode === 'randomized' ||
      (mode === 'balanced' && (owners[i] < 0 || regions[owners[i]].biome === 'water'))
    )
      intent[i] = owner;
    const active: { biome: TerrainBiome; weight: number }[] = [];
    if (mode !== 'randomized' && owners[i] >= 0) {
      const biome = regions[owners[i]].biome,
        distance = biomeDistances.get(biome)?.[i];
      active.push({
        biome,
        weight:
          distance === undefined
            ? 1
            : smooth(distance / Math.max(Math.min(dx, dy) * 2, Math.min(width, height) * 0.018)),
      });
    }
    for (const patch of patchShapes) {
      const d = patch.distance(p),
        radius = Math.sqrt(patch.area / Math.PI);
      const weight = smooth((d + radius * 0.14) / Math.max(Math.min(dx, dy) * 2, radius * 0.45));
      if (weight > 0)
        active.push({
          biome: patch.biome,
          weight: weight * (mode === 'balanced' ? 0.75 : mode === 'strict' ? 0 : 1),
        });
      if (mode === 'randomized' && d >= 0) intent[i] = patch.owner;
    }
    if (field[i] <= 0) {
      intent[i] = -1;
      continue;
    }
    // A land component dominated by a mountain/forest still carries that broad intention.
    if (!active.length && owner >= 0) active.push({ biome: regions[owner].biome, weight: 0.7 });
    for (const { biome, weight } of active) {
      const high =
        biome === 'mountain'
          ? 1
          : biome === 'plateau'
            ? 0.68
            : biome === 'hill'
              ? 0.35
              : biome === 'badlands'
                ? 0.48
                : 0;
      uplift[i] = Math.max(uplift[i], high * weight);
      if (biome === 'plateau') plateau[i] = Math.max(plateau[i], weight);
      if (biome === 'swamp') wetland[i] = Math.max(wetland[i], weight);
      if (biome === 'snow' || biome === 'tundra')
        cold[i] = Math.max(cold[i], weight * (biome === 'snow' ? 0.16 : 0.07));
    }
  }
  return {
    field,
    intent,
    uplift,
    plateau,
    wetland,
    cold,
    landSeeds: lands.map(({ center, area }) => ({ center, area })),
  };
}
