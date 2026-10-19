import { Delaunay } from 'd3-delaunay';
import type { MapPoint } from '../../shared/cartography';
import type {
  GeneratedGeography,
  GeographicCell,
  GeographicDivision,
  GeographicArea,
} from '../../shared/geography';
import { GEOGRAPHY_LIMITS } from '../../shared/geography';
import { pointInPolygon, seededRandom } from './terrain';
import {
  geographicNoise,
  plateMotion,
  type GeographicFields,
  type GeographicFieldContext,
} from './geography-fields';

const round = (n: number) => Math.round(n * 100) / 100;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const colorPalette = [
  '#a76460',
  '#628c7a',
  '#8775a4',
  '#bb914d',
  '#6a8ba6',
  '#a67e53',
  '#718852',
  '#a56c8b',
  '#67999d',
  '#9c8554',
  '#84716a',
  '#659371',
];
const roots = [
  '霜岬',
  '苍桐',
  '月见',
  '赤穗',
  '白露',
  '星落',
  '玉川',
  '青岚',
  '鸣海',
  '琥珀',
  '远霞',
  '雪间',
  '若叶',
  '银杉',
  '日轮',
  '夜汐',
  '绯樱',
  '黑曜',
  '云雀',
  '琉璃',
  '晓枫',
  '风花',
  '松涛',
  '水镜',
];
const keyPoint = (p: MapPoint) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`;
interface SharedEdge {
  a: MapPoint;
  b: MapPoint;
  middle: MapPoint;
  owners: number[];
}

interface RiverSegment {
  a: MapPoint;
  b: MapPoint;
  width: number;
}

/** A small spatial index keeps real channel checks bounded by local geography. */
function riverFeatures(context: GeographicFieldContext) {
  const bucketSize = Math.max(context.width, context.height) / 48,
    buckets = new Map<string, RiverSegment[]>();
  for (const channel of context.riverChannels ?? [])
    for (let i = 1; i < channel.points.length; i++) {
      const segment = {
          a: channel.points[i - 1],
          b: channel.points[i],
          width: ((channel.widths[i - 1] ?? 1) + (channel.widths[i] ?? 1)) / 2,
        },
        { a, b } = segment;
      for (
        let x = Math.floor(Math.min(a.x, b.x) / bucketSize);
        x <= Math.floor(Math.max(a.x, b.x) / bucketSize);
        x++
      )
        for (
          let y = Math.floor(Math.min(a.y, b.y) / bucketSize);
          y <= Math.floor(Math.max(a.y, b.y) / bucketSize);
          y++
        ) {
          const key = `${x}:${y}`;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key)!.push(segment);
        }
    }
  const around = (a: MapPoint, b: MapPoint, margin = 0) => {
    const found = new Set<RiverSegment>();
    for (
      let x = Math.floor((Math.min(a.x, b.x) - margin) / bucketSize);
      x <= Math.floor((Math.max(a.x, b.x) + margin) / bucketSize);
      x++
    )
      for (
        let y = Math.floor((Math.min(a.y, b.y) - margin) / bucketSize);
        y <= Math.floor((Math.max(a.y, b.y) + margin) / bucketSize);
        y++
      )
        for (const segment of buckets.get(`${x}:${y}`) ?? []) found.add(segment);
    return found;
  };
  return {
    nearest(point: MapPoint, radius: number, direction: MapPoint) {
      let best: MapPoint | undefined,
        distance = radius;
      for (const { a, b } of around(point, point, radius)) {
        const dx = b.x - a.x,
          dy = b.y - a.y,
          length = Math.hypot(dx, dy);
        if (!length || Math.abs(dx * direction.x + dy * direction.y) / length < 0.6) continue;
        const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (length * length), 0, 1),
          candidate = { x: a.x + t * dx, y: a.y + t * dy },
          d = Math.hypot(candidate.x - point.x, candidate.y - point.y);
        if (d < distance) {
          best = candidate;
          distance = d;
        }
      }
      return best;
    },
    crossing(a: MapPoint, b: MapPoint) {
      let width = 0;
      const cross = (p: MapPoint, q: MapPoint, r: MapPoint) =>
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      for (const segment of around(a, b))
        if (
          cross(a, b, segment.a) * cross(a, b, segment.b) < 0 &&
          cross(segment.a, segment.b, a) * cross(segment.a, segment.b, b) < 0
        )
          width = Math.max(width, segment.width);
      return width;
    },
  };
}

function fineCellAt(context: GeographicFieldContext, point: MapPoint) {
  const col = clamp(
      Math.floor((point.x / context.width) * context.columns),
      0,
      context.columns - 1,
    ),
    row = clamp(Math.floor((point.y / context.height) * context.rows), 0, context.rows - 1);
  return context.cells[row * context.columns + col];
}

/** A single edge sample is shared by both polygons, including its slight cartographic bend. */
function makeCells(
  context: GeographicFieldContext,
  fields: GeographicFields,
): { cells: GeographicCell[]; edges: SharedEdge[] } {
  const { width, height, kind, settings, columns, rows } = context;
  const density = clamp(settings.geography!.regionDensity, 0.5, 2);
  const target = Math.min(
    GEOGRAPHY_LIMITS.cells,
    Math.round({ world: 1250, region: 850, town: 420 }[kind] * density),
  );
  const gridColumns = Math.max(6, Math.round(Math.sqrt((target * width) / height))),
    gridRows = Math.max(6, Math.round(target / gridColumns));
  const random = seededRandom(settings.seed ^ 0x298764),
    sites: MapPoint[] = [];
  for (let y = 0; y < gridRows; y++)
    for (let x = 0; x < gridColumns; x++)
      sites.push({
        x: ((x + 0.5 + (random() - 0.5) * 0.78) * width) / gridColumns,
        y: ((y + 0.5 + (random() - 0.5) * 0.78) * height) / gridRows,
      });
  if (sites.length > GEOGRAPHY_LIMITS.cells) sites.length = GEOGRAPHY_LIMITS.cells;
  const delaunay = Delaunay.from(
      sites,
      (p) => p.x,
      (p) => p.y,
    ),
    voronoi = delaunay.voronoi([0, 0, width, height]);
  const cells: GeographicCell[] = [],
    edges = new Map<string, SharedEdge>(),
    rivers = riverFeatures(context);
  for (let id = 0; id < sites.length; id++) {
    const raw = voronoi.cellPolygon(id)!;
    const polygon: MapPoint[] = [];
    for (let i = 0; i < raw.length - 1; i++) {
      const a = { x: round(raw[i][0]), y: round(raw[i][1]) },
        b = { x: round(raw[i + 1][0]), y: round(raw[i + 1][1]) };
      const ka = keyPoint(a),
        kb = keyPoint(b),
        key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      let edge = edges.get(key);
      if (!edge) {
        const first = ka < kb ? a : b,
          second = ka < kb ? b : a,
          dx = second.x - first.x,
          dy = second.y - first.y;
        const onFrame =
          (a.x === b.x && (a.x === 0 || a.x === width)) ||
          (a.y === b.y && (a.y === 0 || a.y === height));
        const bend = onFrame
          ? 0
          : (geographicNoise((a.x + b.x) / 31, (a.y + b.y) / 31, settings.seed + 281) - 0.5) *
            0.18 *
            settings.geography!.roughness;
        let middle = {
          x: clamp((a.x + b.x) / 2 - dy * bend, 0, width),
          y: clamp((a.y + b.y) / 2 + dx * bend, 0, height),
        };
        if (!onFrame) {
          const length = Math.hypot(dx, dy),
            direction = { x: dx / (length || 1), y: dy / (length || 1) },
            river = rivers.nearest(middle, length * 0.2, direction);
          if (river) middle = river;
          else if (fineCellAt(context, middle)?.elevation > 0.18) {
            // Shared local relief bends favor ridge crests without changing topology.
            let best = fineCellAt(context, middle).elevation;
            for (const offset of [-0.12, -0.06, 0.06, 0.12]) {
              const candidate = {
                  x: clamp((a.x + b.x) / 2 - dy * offset, 0, width),
                  y: clamp((a.y + b.y) / 2 + dx * offset, 0, height),
                },
                elevation = fineCellAt(context, candidate).elevation;
              if (elevation > best + 0.004) {
                best = elevation;
                middle = candidate;
              }
            }
          }
        }
        edge = {
          a: first,
          b: second,
          middle: {
            x: round(middle.x),
            y: round(middle.y),
          },
          owners: [],
        };
        edges.set(key, edge);
      }
      edge.owners.push(id);
      polygon.push(a, edge.middle);
    }
    let center = { x: round(sites[id].x), y: round(sites[id].y) };
    let index =
      Math.min(rows - 1, Math.floor((center.y / height) * rows)) * columns +
      Math.min(columns - 1, Math.floor((center.x / width) * columns));
    // Center-only classification stranded coastal land outside every territory.
    // A coastal unit includes every fine land sample it covers; the renderer clips
    // its polygon to the authoritative coastline. Its label remains on real land.
    let landIndex = -1,
      nearestLand = Infinity;
    const minX = Math.min(...polygon.map((p) => p.x)),
      maxX = Math.max(...polygon.map((p) => p.x)),
      minY = Math.min(...polygon.map((p) => p.y)),
      maxY = Math.max(...polygon.map((p) => p.y));
    for (
      let y = Math.max(0, Math.floor((minY / height) * rows));
      y <= Math.min(rows - 1, Math.floor((maxY / height) * rows));
      y++
    )
      for (
        let x = Math.max(0, Math.floor((minX / width) * columns));
        x <= Math.min(columns - 1, Math.floor((maxX / width) * columns));
        x++
      ) {
        const sample = y * columns + x,
          fine = context.cells[sample];
        if (!fine.land || !pointInPolygon(fine, polygon)) continue;
        const d = Math.hypot(fine.x - center.x, fine.y - center.y);
        if (d < nearestLand) {
          nearestLand = d;
          landIndex = sample;
        }
      }
    if (landIndex >= 0 && !context.cells[index].land) {
      index = landIndex;
      center = { x: round(context.cells[index].x), y: round(context.cells[index].y) };
    }
    const c = context.cells[index];
    cells.push({
      id,
      center,
      polygon,
      neighbors: [],
      land: landIndex >= 0 || c.land,
      plate: fields.plate[index],
      elevation: round(c.elevation * 6000),
      temperature: round(fields.temperature[index]),
      precipitation: Math.round(fields.precipitation[index]),
      biome: c.biome,
      shelf: Boolean(fields.shelf[index]),
    });
  }
  for (const edge of edges.values())
    if (edge.owners.length === 2) {
      const [a, b] = edge.owners;
      cells[a].neighbors.push(b);
      cells[b].neighbors.push(a);
    }
  for (const cell of cells) cell.neighbors.sort((a, b) => a - b);
  return { cells, edges: [...edges.values()] };
}

function groups(cells: GeographicCell[], match: (cell: GeographicCell) => boolean) {
  const seen = new Uint8Array(cells.length),
    result: number[][] = [];
  for (let start = 0; start < cells.length; start++) {
    if (seen[start] || !match(cells[start])) continue;
    const list = [start];
    seen[start] = 1;
    for (let cursor = 0; cursor < list.length; cursor++)
      for (const next of cells[list[cursor]].neighbors)
        if (!seen[next] && match(cells[next])) {
          seen[next] = 1;
          list.push(next);
        }
    result.push(list);
  }
  return result.sort((a, b) => b.length - a.length || a[0] - b[0]);
}
function groupCenter(cells: GeographicCell[], members: number[]): MapPoint {
  const average = members.reduce(
    (p, i) => ({
      x: p.x + cells[i].center.x / members.length,
      y: p.y + cells[i].center.y / members.length,
    }),
    { x: 0, y: 0 },
  );
  return cells[
    members.reduce(
      (best, i) =>
        Math.hypot(cells[i].center.x - average.x, cells[i].center.y - average.y) <
        Math.hypot(cells[best].center.x - average.x, cells[best].center.y - average.y)
          ? i
          : best,
      members[0],
    )
  ].center;
}

class Heap {
  values: { id: number; cost: number; owner: number }[] = [];
  push(item: { id: number; cost: number; owner: number }) {
    let i = this.values.length;
    this.values.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.values[p].cost <= item.cost) break;
      this.values[i] = this.values[p];
      i = p;
    }
    this.values[i] = item;
  }
  pop() {
    const first = this.values[0],
      last = this.values.pop()!;
    if (this.values.length) {
      let i = 0;
      while (i * 2 + 1 < this.values.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.values.length && this.values[child + 1].cost < this.values[child].cost)
          child++;
        if (last.cost <= this.values[child].cost) break;
        this.values[i] = this.values[child];
        i = child;
      }
      this.values[i] = last;
    }
    return first;
  }
}

/** Overland travel, rather than post-hoc random lines, determines territorial expansion. */
export function geographicTravelCost(
  context: GeographicFieldContext,
  from: GeographicCell,
  to: GeographicCell,
  kind: GeographicDivision['kind'],
  crossingWidth = riverFeatures(context).crossing(from.center, to.center),
) {
  const length = Math.hypot(to.center.x - from.center.x, to.center.y - from.center.y),
    unit = Math.max(context.width, context.height) / 1000,
    spacing = Math.min(context.width / context.columns, context.height / context.rows),
    steps = Math.max(2, Math.ceil(length / spacing));
  let water = 0,
    maximum = 0,
    relief = 0,
    previous = fineCellAt(context, from.center).elevation,
    runoffCrossing = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps,
      point = {
        x: from.center.x + (to.center.x - from.center.x) * t,
        y: from.center.y + (to.center.y - from.center.y) * t,
      },
      fine = fineCellAt(context, point);
    if (!fine.land) water++;
    maximum = Math.max(maximum, fine.elevation * 6000);
    relief += Math.abs(fine.elevation - previous) * 6000;
    previous = fine.elevation;
    if (
      fine.land &&
      fine.downstream >= 0 &&
      fine.accumulation > (65 * context.cells.length) / 24_000
    ) {
      const downstream = context.cells[fine.downstream],
        dx = downstream.x - fine.x,
        dy = downstream.y - fine.y,
        perpendicular =
          Math.abs(dx * (to.center.y - from.center.y) - dy * (to.center.x - from.center.x)) /
          ((Math.hypot(dx, dy) || 1) * (length || 1));
      runoffCrossing = Math.max(runoffCrossing, perpendicular);
    }
  }
  const influence = kind === 'country' ? 1 : kind === 'culture' ? 0.64 : 0.32,
    ridge = Math.max(0, maximum - 950) / 800,
    river =
      crossingWidth > 0
        ? 6 + Math.min(7, crossingWidth / Math.max(unit, 0.001))
        : runoffCrossing * 2.5,
    secondary =
      kind === 'culture' && from.country !== to.country
        ? 0.32
        : kind === 'religion' && from.culture !== to.culture
          ? 0.45
          : 0,
    forest = ['forest', 'rainforest', 'taiga'].includes(to.biome) ? 0.16 : 0,
    hostile = ['desert', 'badlands', 'snow', 'tundra'].includes(to.biome) ? 0.3 : 0;
  return (
    length *
    (1 +
      influence * (relief / 700 + ridge + river) +
      (water / (steps + 1)) * 80 +
      secondary +
      forest +
      hostile)
  );
}

/** Expansion follows relief, drainage, water crossings and real settlement hubs. */
function makeDivisions(
  cells: GeographicCell[],
  context: GeographicFieldContext,
): GeographicDivision[] {
  const settings = context.settings.geography!,
    seed = context.settings.seed,
    rivers = riverFeatures(context);
  const divisions: GeographicDivision[] = [],
    land = cells.filter((c) => c.land),
    components = groups(cells, (c) => c.land);
  const random = seededRandom(seed + 72291);
  for (const kind of ['country', 'culture', 'religion'] as const) {
    const wanted = Math.min(24, Math.round(settings[`${kind}Count`]), land.length);
    if (wanted <= 0) continue;
    const seeds: number[] = [];
    const importance: Record<string, number> =
      kind === 'culture'
        ? { village: 5, town: 4, city: 3, camp: 2, castle: 1 }
        : kind === 'religion'
          ? { city: 5, town: 4, village: 3, castle: 2, camp: 1 }
          : { city: 5, castle: 4, town: 3, village: 2, camp: 1 };
    const hubs = (context.settlements ?? [])
      .map((site) => ({ site, cell: cells.find((c) => c.land && pointInPolygon(site, c.polygon)) }))
      .filter(
        (
          hub,
        ): hub is {
          site: NonNullable<GeographicFieldContext['settlements']>[number];
          cell: GeographicCell;
        } => Boolean(hub.cell),
      )
      .sort(
        (a, b) =>
          (importance[b.site.kind] ?? 1) - (importance[a.site.kind] ?? 1) ||
          a.site.id.localeCompare(b.site.id),
      );
    for (const group of components.slice(0, wanted)) {
      const viable = group.filter((i) => cells[i].elevation < 1500);
      const candidates = viable.length ? viable : group;
      const center = groupCenter(cells, candidates);
      const hub = hubs.find((hub) => group.includes(hub.cell.id));
      seeds.push(
        hub
          ? hub.cell.id
          : candidates.reduce(
              (best, i) =>
                Math.hypot(cells[i].center.x - center.x, cells[i].center.y - center.y) <
                Math.hypot(cells[best].center.x - center.x, cells[best].center.y - center.y)
                  ? i
                  : best,
              candidates[0],
            ),
      );
    }
    while (seeds.length < wanted) {
      let best = -1,
        score = -1;
      for (const c of land) {
        if (seeds.includes(c.id)) continue;
        const separation = Math.min(
          ...seeds.map((i) =>
            Math.hypot(c.center.x - cells[i].center.x, c.center.y - cells[i].center.y),
          ),
        );
        const hub = hubs.find((hub) => hub.cell.id === c.id),
          suitability =
            (c.elevation < 1600 ? 1 : 0.55) * (c.temperature > 0 ? 1 : 0.7) * (hub ? 2.8 : 1);
        const value =
          separation *
          suitability *
          (0.85 +
            geographicNoise(
              c.center.x / 91,
              c.center.y / 91,
              seed + { country: 17, culture: 313, religion: 619 }[kind],
            ) *
              0.3);
        if (value > score) {
          score = value;
          best = c.id;
        }
      }
      if (best < 0) break;
      seeds.push(best);
    }
    const names = [...roots];
    for (let index = names.length - 1; index > 0; index--) {
      const next = Math.floor(random() * (index + 1));
      [names[index], names[next]] = [names[next], names[index]];
    }
    const local: GeographicDivision[] = seeds.map((id, index) => ({
      id: `geo_${kind}_${index}`,
      kind,
      name:
        names[index] +
        (kind === 'country'
          ? index % 3 === 0
            ? '王国'
            : index % 3 === 1
              ? '公国'
              : '领地'
          : kind === 'culture'
            ? '文化'
            : '信仰'),
      color:
        colorPalette[
          (index + (kind === 'culture' ? 3 : kind === 'religion' ? 6 : 0)) % colorPalette.length
        ],
      center: cells[id].center,
    }));
    const costs = new Float64Array(cells.length).fill(Infinity),
      owners = new Int16Array(cells.length).fill(-1),
      heap = new Heap();
    seeds.forEach((id, owner) => {
      costs[id] = 0;
      owners[id] = owner;
      heap.push({ id, cost: 0, owner });
    });
    while (heap.values.length) {
      const current = heap.pop();
      if (current.cost > costs[current.id]) continue;
      const from = cells[current.id];
      for (const next of from.neighbors) {
        const to = cells[next];
        if (!to.land) continue;
        const cost =
          current.cost +
          geographicTravelCost(context, from, to, kind, rivers.crossing(from.center, to.center));
        if (cost < costs[next]) {
          costs[next] = cost;
          owners[next] = current.owner;
          heap.push({ id: next, cost, owner: current.owner });
        }
      }
    }
    for (const c of land) {
      let owner = owners[c.id];
      if (owner < 0)
        owner = seeds.reduce(
          (best, id, index) =>
            Math.hypot(c.center.x - cells[id].center.x, c.center.y - cells[id].center.y) <
            Math.hypot(
              c.center.x - cells[seeds[best]].center.x,
              c.center.y - cells[seeds[best]].center.y,
            )
              ? index
              : best,
          0,
        );
      c[kind] = local[owner].id;
    }
    divisions.push(...local);
  }
  return divisions;
}

function makeAreas(cells: GeographicCell[], context: GeographicFieldContext): GeographicArea[] {
  const areas: GeographicArea[] = [],
    random = seededRandom(context.settings.seed + 66217),
    root = () => roots[Math.floor(random() * roots.length)];
  const land = groups(cells, (c) => c.land),
    water = groups(cells, (c) => !c.land);
  const push = (kind: GeographicArea['kind'], name: string, members: number[]) =>
    areas.push({
      id: `geo_area_${areas.length}`,
      kind,
      name,
      center: groupCenter(cells, members),
      cells: members,
    });
  for (const group of land) {
    if (areas.length >= 80) continue;
    const continent =
      (context.kind === 'world' && group.length > cells.length * 0.12) ||
      group.some((i) =>
        cells[i].polygon.some(
          (p) => p.x === 0 || p.y === 0 || p.x === context.width || p.y === context.height,
        ),
      );
    push(
      continent ? 'continent' : 'island',
      root() + (continent ? '大陆' : context.kind === 'town' ? '台地' : '岛'),
      group,
    );
  }
  for (const group of water) {
    if (areas.length >= 100) continue;
    const ocean = group.some((i) =>
      cells[i].polygon.some(
        (p) => p.x === 0 || p.y === 0 || p.x === context.width || p.y === context.height,
      ),
    );
    push(
      ocean ? 'ocean' : 'lake',
      root() + (ocean ? (group.length > cells.length * 0.2 ? '洋' : '海') : '湖'),
      group,
    );
  }
  // Local regions remain coherent, smaller pieces of a country. Town maps call them districts.
  const owners = [...new Set(cells.filter((c) => c.land).map((c) => c.country ?? ''))];
  for (const owner of owners)
    for (const component of groups(cells, (c) => c.land && (c.country ?? '') === owner)) {
      if (component.length < 4 || areas.length >= GEOGRAPHY_LIMITS.areas) continue;
      const count = Math.min(
        8,
        Math.max(1, Math.ceil(component.length / (context.kind === 'town' ? 30 : 55))),
      );
      const seeds = [component[0]];
      while (seeds.length < count) {
        let best = component[0],
          score = -1;
        for (const id of component) {
          const d = Math.min(
            ...seeds.map((i) =>
              Math.hypot(
                cells[id].center.x - cells[i].center.x,
                cells[id].center.y - cells[i].center.y,
              ),
            ),
          );
          if (d > score) {
            best = id;
            score = d;
          }
        }
        seeds.push(best);
      }
      const buckets = seeds.map(() => [] as number[]);
      const allowed = new Set(component),
        costs = new Map<number, number>(),
        owners = new Map<number, number>(),
        heap = new Heap();
      seeds.forEach((id, owner) => {
        costs.set(id, 0);
        owners.set(id, owner);
        heap.push({ id, cost: 0, owner });
      });
      while (heap.values.length) {
        const current = heap.pop();
        if (current.cost > (costs.get(current.id) ?? Infinity)) continue;
        for (const next of cells[current.id].neighbors) {
          if (!allowed.has(next)) continue;
          const cost =
            current.cost +
            Math.hypot(
              cells[current.id].center.x - cells[next].center.x,
              cells[current.id].center.y - cells[next].center.y,
            ) *
              (1 + Math.abs(cells[current.id].elevation - cells[next].elevation) / 1800);
          if (cost < (costs.get(next) ?? Infinity)) {
            costs.set(next, cost);
            owners.set(next, current.owner);
            heap.push({ id: next, cost, owner: current.owner });
          }
        }
      }
      for (const id of component) buckets[owners.get(id) ?? 0].push(id);
      for (const members of buckets)
        if (members.length && areas.length < GEOGRAPHY_LIMITS.areas)
          push(
            context.kind === 'town' ? 'district' : 'province',
            root() + (context.kind === 'town' ? '街区' : context.kind === 'region' ? '地区' : '省'),
            members,
          );
    }
  return areas;
}

export function buildGeographicMesh(
  context: GeographicFieldContext,
  fields: GeographicFields,
): GeneratedGeography {
  const { cells, edges } = makeCells(context, fields),
    divisions = makeDivisions(cells, context),
    areas = makeAreas(cells, context);
  const borders: GeneratedGeography['borders'] = [];
  for (const edge of edges) {
    if (edge.owners.length !== 2) continue;
    const pair = [...edge.owners].sort((a, b) => a - b) as [number, number],
      a = cells[pair[0]],
      b = cells[pair[1]],
      points = [edge.a, edge.middle, edge.b];
    if (a.land && b.land) {
      borders.push({ id: `geo_edge_${pair[0]}_${pair[1]}`, kind: 'cell', cells: pair, points });
      for (const kind of ['country', 'culture', 'religion'] as const)
        if (a[kind] && b[kind] && a[kind] !== b[kind])
          borders.push({ id: `geo_${kind}_edge_${pair[0]}_${pair[1]}`, kind, cells: pair, points });
    }
    if (a.plate !== b.plate)
      borders.push({
        id: `geo_plate_edge_${pair[0]}_${pair[1]}`,
        kind: 'plate',
        cells: pair,
        points,
        motion: plateMotion(fields.plates[a.plate], fields.plates[b.plate]),
      });
  }
  if (borders.length > GEOGRAPHY_LIMITS.borders)
    throw new Error('地图区域边界超过容量，请减少区域密度。');
  return {
    version: 1,
    seed: context.settings.seed >>> 0,
    width: context.width,
    height: context.height,
    cells,
    plates: fields.plates,
    divisions,
    areas,
    borders,
    ports: [],
    seaRoutes: [],
  };
}
