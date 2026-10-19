import { z } from 'zod';
import type { AtlasMap } from '../shared/model';
import type { MapObject, MapPoint } from '../shared/cartography';
import { GEOGRAPHY_LIMITS } from '../shared/geography';
import { isWaterPoint, isWaterSegment } from '../shared/map-surface';

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/);
const name = z.string().trim().min(1).max(240);
const finite = z.number().finite();
const point = z.object({ x: finite.min(0).max(10_000), y: finite.min(0).max(10_000) }).strict();
const color = z.string().regex(/^#[\da-fA-F]{6}$/);
const cellId = z
  .number()
  .int()
  .min(0)
  .max(GEOGRAPHY_LIMITS.cells - 1);
const seed = z.number().int().min(0).max(4_294_967_295);
const dimension = z.number().int().min(100).max(10_000);
const ownership = ['country', 'culture', 'religion'] as const;
const biome = z.enum([
  'water',
  'grass',
  'forest',
  'mountain',
  'desert',
  'swamp',
  'snow',
  'hill',
  'plateau',
  'taiga',
  'rainforest',
  'savanna',
  'tundra',
  'badlands',
]);

export const geographicSettingsSchema = z
  .object({
    version: z.literal(1),
    source: z.enum(['random', 'sketch']),
    sketchMode: z.enum(['randomized', 'balanced', 'strict']).optional(),
    plateCount: z.number().int().min(3).max(GEOGRAPHY_LIMITS.plates),
    countryCount: z.number().int().min(0).max(24),
    cultureCount: z.number().int().min(0).max(24),
    religionCount: z.number().int().min(0).max(24),
    latitudeNorth: finite.min(-90).max(90),
    latitudeSouth: finite.min(-90).max(90),
    longitudeWest: finite.min(-180).max(180).optional(),
    longitudeEast: finite.min(-180).max(180).optional(),
    meanSeaTemperature: finite.min(-20).max(45),
    rainfall: finite.min(0.2).max(3),
    windAngle: finite.min(0).max(360),
    roughness: finite.min(0).max(1),
    regionDensity: finite.min(0.5).max(2),
    ports: z.boolean(),
  })
  .strict()
  .refine((v) => v.latitudeNorth >= v.latitudeSouth, {
    path: ['latitudeSouth'],
    message: '南纬度不能高于北纬度。',
  })
  .refine(
    (v) =>
      (v.longitudeWest === undefined && v.longitudeEast === undefined) ||
      (v.longitudeWest !== undefined &&
        v.longitudeEast !== undefined &&
        v.longitudeWest !== v.longitudeEast &&
        v.longitudeEast - v.longitudeWest > -360),
    {
      path: ['longitudeEast'],
      message: '经度范围需完整且不能为零宽度。',
    },
  );

const geography = z
  .object({
    version: z.literal(1),
    seed,
    width: dimension,
    height: dimension,
    cells: z
      .array(
        z
          .object({
            id: cellId,
            center: point,
            polygon: z.array(point).min(3).max(GEOGRAPHY_LIMITS.polygonPoints),
            neighbors: z.array(cellId).max(32),
            land: z.boolean(),
            plate: z
              .number()
              .int()
              .min(0)
              .max(GEOGRAPHY_LIMITS.plates - 1),
            elevation: finite.min(-20_000).max(20_000),
            temperature: finite.min(-150).max(100),
            precipitation: finite.min(0).max(100_000),
            biome,
            shelf: z.boolean(),
            country: id.optional(),
            culture: id.optional(),
            religion: id.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(GEOGRAPHY_LIMITS.cells),
    plates: z
      .array(
        z
          .object({
            id: z
              .number()
              .int()
              .min(0)
              .max(GEOGRAPHY_LIMITS.plates - 1),
            name,
            center: point,
            velocity: z.object({ x: finite.min(-10).max(10), y: finite.min(-10).max(10) }).strict(),
            kind: z.enum(['continental', 'oceanic']),
            color,
          })
          .strict(),
      )
      .min(1)
      .max(GEOGRAPHY_LIMITS.plates),
    divisions: z
      .array(
        z
          .object({
            id,
            kind: z.enum(ownership),
            name,
            color,
            center: point,
            entityId: id.optional(),
          })
          .strict(),
      )
      .max(GEOGRAPHY_LIMITS.divisions),
    areas: z
      .array(
        z
          .object({
            id,
            kind: z.enum(['continent', 'island', 'ocean', 'lake', 'province', 'district']),
            name,
            center: point,
            cells: z.array(cellId).min(1).max(GEOGRAPHY_LIMITS.cells),
            entityId: id.optional(),
          })
          .strict(),
      )
      .max(GEOGRAPHY_LIMITS.areas),
    borders: z
      .array(
        z
          .object({
            id,
            kind: z.enum(['country', 'culture', 'religion', 'plate', 'cell']),
            cells: z.tuple([cellId, cellId]),
            points: z.array(point).min(2).max(GEOGRAPHY_LIMITS.polygonPoints),
            motion: z.enum(['convergent', 'divergent', 'transform']).optional(),
          })
          .strict(),
      )
      .max(GEOGRAPHY_LIMITS.borders),
    ports: z
      .array(
        z
          .object({
            id,
            settlementId: id.optional(),
            entityId: id.optional(),
            name,
            center: point,
            harbor: point,
            cell: cellId,
          })
          .strict(),
      )
      .max(GEOGRAPHY_LIMITS.ports),
    seaRoutes: z
      .array(
        z
          .object({
            id,
            name,
            from: id,
            to: id,
            points: z.array(point).min(2).max(GEOGRAPHY_LIMITS.routePoints),
          })
          .strict(),
      )
      .max(GEOGRAPHY_LIMITS.seaRoutes),
  })
  .strict()
  .superRefine((value, ctx) => {
    const fail = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: 'custom', message, path });
    const unique = (items: { id: string | number }[], key: string) => {
      if (new Set(items.map((item) => item.id)).size !== items.length)
        fail(`重复的地理图层 ID：${key}`, [key]);
    };
    for (const key of [
      'cells',
      'plates',
      'divisions',
      'areas',
      'borders',
      'ports',
      'seaRoutes',
    ] as const)
      unique(value[key], key);
    const cells = new Map(value.cells.map((cell) => [cell.id, cell]));
    const plates = new Set(value.plates.map((plate) => plate.id));
    const divisions = new Map(value.divisions.map((division) => [division.id, division]));
    for (const [index, cell] of value.cells.entries()) {
      if (cell.id !== index) fail('地理单元 ID 必须连续排列。', ['cells', index, 'id']);
      if (!plates.has(cell.plate)) fail('地理单元引用未知板块。', ['cells', index, 'plate']);
      if (new Set(cell.neighbors).size !== cell.neighbors.length)
        fail('地理邻接单元重复。', ['cells', index, 'neighbors']);
      for (const adjacent of cell.neighbors)
        if (adjacent === cell.id || !cells.get(adjacent)?.neighbors.includes(cell.id))
          fail('地理邻接必须存在且互相连接。', ['cells', index, 'neighbors']);
      for (const kind of ownership)
        if (cell[kind] && (!cell.land || divisions.get(cell[kind]!)?.kind !== kind))
          fail('地理单元的疆域归属无效。', ['cells', index, kind]);
    }
    for (const kind of ownership)
      if (value.divisions.filter((division) => division.kind === kind).length > 24)
        fail('每类自动疆域最多 24 个。', ['divisions']);
    for (const area of value.areas)
      if (new Set(area.cells).size !== area.cells.length || area.cells.some((id) => !cells.has(id)))
        fail('地名区域包含重复或未知地理单元。', ['areas']);
    for (const border of value.borders) {
      const [left, right] = border.cells.map((id) => cells.get(id));
      if (!left || !right || left.id >= right.id || !left.neighbors.includes(right.id))
        fail('区域边界必须引用按序排列的相邻地理单元。', ['borders']);
      if (border.motion && border.kind !== 'plate') fail('仅板块边界可设定相对运动。', ['borders']);
      if (left && right) {
        const tolerance = Math.max(0.06, (Math.max(value.width, value.height) / 1000) * 0.06);
        const onPolygon = (point: MapPoint, polygon: MapPoint[]) =>
          polygon.some(
            (start, index) =>
              distanceToSegment(point, start, polygon[(index + 1) % polygon.length]) <= tolerance,
          );
        if (
          border.points.some(
            (point) => !onPolygon(point, left.polygon) || !onPolygon(point, right.polygon),
          ) ||
          border.points.some(
            (point, index) =>
              index > 0 &&
              [0.25, 0.5, 0.75].some((t) => {
                const previous = border.points[index - 1];
                const sample = {
                  x: previous.x + (point.x - previous.x) * t,
                  y: previous.y + (point.y - previous.y) * t,
                };
                return !onPolygon(sample, left.polygon) || !onPolygon(sample, right.polygon);
              }),
          )
        )
          fail('区域边界必须沿两个地理单元共享的多边形边缘。', ['borders']);
      }
    }
    const ports = new Set(value.ports.map((port) => port.id));
    for (const port of value.ports)
      if (!cells.get(port.cell)?.land) fail('港口必须位于陆地单元。', ['ports']);
    for (const route of value.seaRoutes)
      if (!ports.has(route.from) || !ports.has(route.to) || route.from === route.to)
        fail('航路必须连接两个有效港口。', ['seaRoutes']);
    const geometryPoints =
      value.cells.reduce((sum, cell) => sum + cell.polygon.length, 0) +
      value.borders.reduce((sum, border) => sum + border.points.length, 0) +
      value.seaRoutes.reduce((sum, route) => sum + route.points.length, 0);
    if (geometryPoints > 180_000) fail('地理图层控制点总量超过 180000。');
  });

export function generatedSnapshotSchema(object: z.ZodType<MapObject>) {
  return z
    .object({
      version: z.literal(1),
      signature: z.string().regex(/^[0-9a-f]{16}-[0-9a-f]{1,8}$/),
      objects: z.array(object).max(8000),
      stats: z
        .object({
          landCells: z.number().int().min(0).max(262_144),
          rivers: z.number().int().min(0).max(8000),
          settlements: z.number().int().min(0).max(60),
          roads: z.number().int().min(0).max(8000),
        })
        .strict()
        .optional(),
      sites: z
        .array(
          z
            .object({
              id,
              kind: z.enum(['village', 'town', 'city', 'castle', 'camp']),
              name,
              x: finite.min(0).max(10_000),
              y: finite.min(0).max(10_000),
              entityId: id.optional(),
            })
            .strict(),
        )
        .max(60)
        .optional(),
      elevation: z
        .object({
          columns: z.number().int().min(2).max(512),
          rows: z.number().int().min(2).max(512),
          width: dimension,
          height: dimension,
          values: z.array(finite.min(-20_000).max(20_000)).max(262_144),
          min: finite.min(-20_000).max(20_000),
          max: finite.min(-20_000).max(20_000),
        })
        .strict()
        .superRefine((value, ctx) => {
          if (
            value.columns * value.rows !== value.values.length ||
            value.min > value.max ||
            value.values.some((height) => height < value.min - 0.1 || height > value.max + 0.1)
          )
            ctx.addIssue({ code: 'custom', message: '持久化高程图网格或高程范围无效。' });
        })
        .optional(),
      geography: geography.optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      for (const key of ['objects', 'sites'] as const) {
        const items = value[key] ?? [];
        if (new Set(items.map((item) => item.id)).size !== items.length)
          ctx.addIssue({ code: 'custom', path: [key], message: '生成快照内部 ID 重复。' });
      }
      if (value.objects.reduce((sum, item) => sum + item.points.length, 0) > 250_000)
        ctx.addIssue({
          code: 'custom',
          path: ['objects'],
          message: '生成对象控制点总量超过 250000。',
        });
      const sites = new Set((value.sites ?? []).map((site) => site.id));
      if (value.geography?.ports.some((port) => port.settlementId && !sites.has(port.settlementId)))
        ctx.addIssue({
          code: 'custom',
          path: ['geography', 'ports'],
          message: '港口引用未知聚落。',
        });
      if (value.geography?.ports.some((port) => port.settlementId && port.entityId))
        ctx.addIssue({
          code: 'custom',
          path: ['geography', 'ports'],
          message: '聚落港口共用所属聚落的关联，独立港口才可单独关联设定条目。',
        });
    });
}

export const militaryLineSchema = z
  .object({
    id,
    name,
    kind: z.enum(['front', 'advance', 'retreat', 'defense']),
    points: z.array(point).min(2).max(2000),
    color,
    width: finite.min(0.5).max(20),
    visible: z.boolean(),
  })
  .strict();

type Fail = (message: string, path?: (string | number)[]) => void;

function distanceToSegment(point: MapPoint, start: MapPoint, end: MapPoint): number {
  const dx = end.x - start.x,
    dy = end.y - start.y;
  const length2 = dx * dx + dy * dy;
  const t = length2
    ? Math.min(1, Math.max(0, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length2))
    : 0;
  return Math.hypot(point.x - start.x - dx * t, point.y - start.y - dy * t);
}

/** Cross-aggregate dimensions and front-line restrictions, using a bounded spatial index. */
export function validateGeneratedMapGeometry(map: AtlasMap, fail: Fail) {
  const snapshot = map.editor?.generated;
  const military = map.editor?.military ?? [];
  const outside = (point: MapPoint) =>
    point.x < 0 || point.y < 0 || point.x > map.width || point.y > map.height;
  const sameSize = (grid: { width: number; height: number }) =>
    grid.width === map.width && grid.height === map.height;
  if (snapshot) {
    if (
      (snapshot.elevation && !sameSize(snapshot.elevation)) ||
      (snapshot.geography && !sameSize(snapshot.geography))
    )
      fail(`生成图层尺寸与地图不一致：${map.id}`);
    if (
      snapshot.objects.some((object) => object.points.some(outside)) ||
      snapshot.sites?.some((site) => outside(site))
    )
      fail(`生成对象位于地图之外：${map.id}`);
    const geo = snapshot.geography;
    if (
      geo &&
      (geo.cells.some((cell) => outside(cell.center) || cell.polygon.some(outside)) ||
        [...geo.plates, ...geo.divisions, ...geo.areas].some((item) => outside(item.center)) ||
        geo.borders.some((border) => border.points.some(outside)) ||
        geo.ports.some((port) => outside(port.center) || outside(port.harbor)) ||
        geo.seaRoutes.some((route) => route.points.some(outside)))
    )
      fail(`地理图层位于地图之外：${map.id}`);
    if (geo && (geo.ports.length || geo.seaRoutes.length)) {
      const surface = snapshot.elevation;
      if (!surface) fail(`港口和航路需要已保存的高程图：${map.id}`);
      else {
        for (const port of geo.ports)
          if (!isWaterPoint(surface, port.harbor)) fail(`港湾必须位于实际水域：${port.id}`);
        const ports = new Map(geo.ports.map((port) => [port.id, port]));
        for (const route of geo.seaRoutes) {
          if (
            route.points.some(
              (point, index) =>
                index > 0 && !isWaterSegment(surface, route.points[index - 1], point),
            )
          )
            fail(`航路必须完全沿实际水域，不能穿过陆地：${route.id}`);
          const from = ports.get(route.from),
            to = ports.get(route.to),
            tolerance = Math.max(0.02, (Math.max(map.width, map.height) / 1000) * 0.02),
            meets = (point: MapPoint, harbor: MapPoint) =>
              Math.hypot(point.x - harbor.x, point.y - harbor.y) <= tolerance;
          if (
            from &&
            to &&
            (!meets(route.points[0], from.harbor) ||
              !meets(route.points[route.points.length - 1], to.harbor))
          )
            fail(`航路端点必须连接对应港湾：${route.id}`);
        }
      }
    }
  }
  if (
    new Set(military.map((line) => line.id)).size !== military.length ||
    military.reduce((sum, line) => sum + line.points.length, 0) > 32768
  )
    fail(`兵棋线 ID 重复或控制点超过 32768：${map.id}`);
  if (military.some((line) => line.points.some(outside))) fail(`兵棋线位于地图之外：${map.id}`);
  const fronts = military.filter((line) => line.kind === 'front');
  if (!fronts.length) return;
  const geo = snapshot?.geography;
  if (!geo) {
    fail(`前线需要已保存的地理单元边界：${map.id}`);
    return;
  }
  const cells = new Map(geo.cells.map((cell) => [cell.id, cell]));
  const step = Math.max(map.width, map.height) / 64;
  const tolerance = Math.max(0.05, (Math.max(map.width, map.height) / 1000) * 0.05);
  type Edge = [MapPoint, MapPoint];
  const buckets = new Map<string, Edge[]>();
  for (const border of geo.borders) {
    if (
      !['country', 'cell'].includes(border.kind) ||
      border.cells.some((id) => !cells.get(id)?.land)
    )
      continue;
    for (let index = 1; index < border.points.length; index++) {
      const edge: Edge = [border.points[index - 1], border.points[index]];
      const [a, b] = edge;
      for (
        let x = Math.floor((Math.min(a.x, b.x) - tolerance) / step);
        x <= Math.floor((Math.max(a.x, b.x) + tolerance) / step);
        x++
      )
        for (
          let y = Math.floor((Math.min(a.y, b.y) - tolerance) / step);
          y <= Math.floor((Math.max(a.y, b.y) + tolerance) / step);
          y++
        ) {
          const key = `${x}:${y}`;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key)!.push(edge);
        }
    }
  }
  const onBoundary = (point: MapPoint) =>
    (buckets.get(`${Math.floor(point.x / step)}:${Math.floor(point.y / step)}`) ?? []).some(
      ([a, b]) => distanceToSegment(point, a, b) <= tolerance,
    );
  for (const front of fronts)
    if (
      front.points.some((point) => !onBoundary(point)) ||
      front.points.some(
        (point, index) =>
          index > 0 &&
          [0.25, 0.5, 0.75].some(
            (t) =>
              !onBoundary({
                x: front.points[index - 1].x + (point.x - front.points[index - 1].x) * t,
                y: front.points[index - 1].y + (point.y - front.points[index - 1].y) * t,
              }),
          ),
      )
    )
      fail(`前线必须沿陆地国界或区域边界绘制：${front.id}`);
}
