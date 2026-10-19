import { z } from 'zod';
import { type EntityType, type Workspace } from '../shared/model';
import { TEMPLATE_FIELD_LIMIT, validTemplateFieldName } from '../shared/entity-templates';
import { getEntityTypes, isEntityType } from '../shared/entity-types';
import { isPresetCover } from '../shared/cover-presets';
import {
  geographicSettingsSchema,
  generatedSnapshotSchema,
  militaryLineSchema,
  validateGeneratedMapGeometry,
} from './geographic-validation';
import {
  MAP_EDITOR_LIMITS,
  MAP_ELEVATION_LIMITS,
  legacyBiomeIds,
  DIVISION_LIMITS,
  divisionEntityTypes,
  mapSymbolIds,
} from '../shared/cartography';

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/);
const text = z.string().max(200_000);
const short = z.string().max(2_000);
const title = z.string().trim().min(1).max(240);
const timestamp = z.iso.datetime({ offset: true });
const entityType = z
  .string()
  .refine(isEntityType, 'Invalid entity type')
  .transform((value) => value as EntityType);
const authorship = { createdBy: id.optional() };
const publication = { ...authorship, visibility: z.enum(['public', 'gm']).optional() };
const templateFields = z
  .array(z.string().refine(validTemplateFieldName, 'Invalid template field name'))
  .max(TEMPLATE_FIELD_LIMIT)
  .refine((fields) => new Set(fields).size === fields.length, 'Duplicate template fields');
const coordinate = z.number().finite().min(-100_000).max(100_000);
const point = z.object({ x: coordinate, y: coordinate }).strict();
const mapColor = z.string().regex(/^(?:none|#[\da-fA-F]{3}|#[\da-fA-F]{6}|#[\da-fA-F]{8})$/);
const mapPoints = z.array(point).min(1).max(MAP_EDITOR_LIMITS.points);
const elevation = z
  .object({
    version: z.literal(1),
    preset: z.enum(['sketch', 'continent', 'archipelago', 'highlands']),
    seed: z.number().int().min(0).max(4_294_967_295),
    relief: z.number().finite().min(0.25).max(2),
    seaLevel: z.number().finite().min(-1000).max(1000),
    strokes: z
      .array(
        z
          .object({
            id,
            operation: z.enum(['raise', 'lower', 'flatten', 'smooth']),
            points: z.array(point).min(1).max(MAP_ELEVATION_LIMITS.points),
            width: z.number().finite().min(5).max(500),
            strength: z.number().finite().min(0).max(1),
            target: z.number().finite().min(-2000).max(6000),
          })
          .strict(),
      )
      .max(MAP_ELEVATION_LIMITS.strokes),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.strokes.reduce((total, stroke) => total + stroke.points.length, 0) >
      MAP_ELEVATION_LIMITS.totalPoints
    )
      ctx.addIssue({
        code: 'custom',
        path: ['strokes'],
        message: `Elevation edits exceed ${MAP_ELEVATION_LIMITS.totalPoints} total points`,
      });
  });
const generationCommon = {
  seed: z.number().int().min(0).max(4_294_967_295),
  climate: z.enum(['temperate', 'dry', 'cold']),
  settlements: z.number().int().min(0).max(12),
  rivers: z.boolean(),
  routes: z.boolean(),
};
const mapObject = z
  .object({
    id,
    name: title,
    kind: z.enum(['symbol', 'path', 'polygon', 'text', 'image']),
    points: mapPoints,
    symbol: z.enum(mapSymbolIds).optional(),
    imageUrl: z
      .string()
      .regex(/^\/uploads\/[A-Za-z0-9_-]+\.(png|jpg|webp)$/)
      .optional(),
    text: short,
    color: mapColor,
    stroke: mapColor,
    strokeWidth: z.number().finite().min(0).max(200),
    layer: z.enum(['base', 'detail']).optional(),
    size: z.number().finite().min(1).max(2000),
    rotation: z.number().finite().min(-360).max(360),
    opacity: z.number().finite().min(0).max(1),
    blur: z.number().finite().min(0).max(40).optional(),
    visible: z.boolean(),
    locked: z.boolean(),
  })
  .strict()
  .superRefine((object, ctx) => {
    const minimum =
      object.kind === 'polygon' ? 3 : object.kind === 'path' || object.kind === 'image' ? 2 : 1;
    if (object.points.length < minimum || (minimum === 1 && object.points.length !== 1))
      ctx.addIssue({
        code: 'custom',
        path: ['points'],
        message: `Invalid point count for ${object.kind}`,
      });
    if (object.kind === 'symbol' && !object.symbol)
      ctx.addIssue({
        code: 'custom',
        path: ['symbol'],
        message: 'Symbol objects require a known symbol',
      });
    if (object.kind !== 'symbol' && object.symbol)
      ctx.addIssue({
        code: 'custom',
        path: ['symbol'],
        message: 'Only symbol objects may carry a symbol',
      });
    if (
      object.kind === 'image' &&
      (!object.imageUrl ||
        object.points.length !== 2 ||
        object.points[1].x <= object.points[0].x ||
        object.points[1].y <= object.points[0].y)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['imageUrl'],
        message: 'Images require an uploaded URL and two ordered positive corners',
      });
    if (object.kind !== 'image' && object.imageUrl)
      ctx.addIssue({
        code: 'custom',
        path: ['imageUrl'],
        message: 'Only image objects may carry imageUrl',
      });
  });
const editor = z
  .object({
    version: z.literal(1),
    mode: z.enum(['sketch', 'sculpt', 'detail']),
    baseVisible: z.boolean(),
    hiddenFeatures: z
      .object({
        // Authored symbols, legacy pins/strokes and generated features share these display lists.
        settlements: z.array(id).max(11_000).optional(),
        ports: z.array(id).max(9_000).optional(),
        roads: z.array(id).max(22_000).optional(),
        seaRoutes: z.array(id).max(512).optional(),
      })
      .strict()
      .refine(
        (v) => Object.values(v).every((ids) => new Set(ids).size === ids.length),
        '隐藏项不能重复。',
      )
      .optional(),
    divisions: z
      .array(
        z
          .object({
            id,
            kind: z.enum(['country', 'culture', 'religion']),
            name: title,
            entityId: id.optional(),
            color: z.string().regex(/^#[\da-fA-F]{6}$/),
            visible: z.boolean(),
          })
          .strict(),
      )
      .max(DIVISION_LIMITS.divisions)
      .optional(),
    divisionPaint: z
      .array(
        z
          .object({
            id,
            divisionId: id,
            operation: z.enum(['paint', 'erase']),
            geometry: z.enum(['brush', 'polygon']),
            points: z.array(point).min(1).max(DIVISION_LIMITS.points),
            width: z.number().finite().min(1).max(2000),
            roughness: z.number().finite().min(0).max(1),
            seed: z.number().int().min(0).max(4_294_967_295),
          })
          .strict()
          .superRefine((s, ctx) => {
            if (s.geometry === 'polygon' && s.points.length < 3)
              ctx.addIssue({
                code: 'custom',
                path: ['points'],
                message: 'A division polygon requires three points',
              });
          }),
      )
      .max(DIVISION_LIMITS.strokes)
      .optional(),
    generation: z
      .discriminatedUnion('version', [
        z.object({ version: z.literal(1), ...generationCommon }).strict(),
        z
          .object({
            version: z.literal(2),
            ...generationCommon,
            detail: z.enum(['standard', 'high', 'ultra']),
            linework: z.literal('organic').optional(),
            elevation: elevation.optional(),
            geography: geographicSettingsSchema.optional(),
            settlementCounts: z
              .object({
                village: z.number().int().min(0).max(24),
                town: z.number().int().min(0).max(24),
                city: z.number().int().min(0).max(24),
                castle: z.number().int().min(0).max(24),
                camp: z.number().int().min(0).max(24),
              })
              .strict()
              .refine(
                (v) => Object.values(v).reduce((sum, count) => sum + count, 0) <= 60,
                'At most 60 settlements',
              )
              .optional(),
            settlementNames: z
              .record(
                z.string().regex(/^(?:village|town|city|castle|camp)_\d{1,2}$/),
                title.refine((v) => !/[\u0000-\u001f\u007f]/.test(v)),
              )
              .refine((v) => Object.keys(v).length <= 120, 'At most 120 authored names')
              .optional(),
            settlementLinks: z
              .record(z.string().regex(/^(?:village|town|city|castle|camp)_\d{1,2}$/), id)
              .refine((v) => Object.keys(v).length <= 120, 'At most 120 location links')
              .optional(),
          })
          .strict(),
      ])
      .optional(),
    regions: z
      .array(
        z
          .object({
            id,
            name: title,
            biome: z.enum([
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
            ]),
            geometry: z.enum(['brush', 'polygon']),
            points: mapPoints,
            width: z.number().finite().min(1).max(2000),
            seed: z.number().int().min(0).max(4_294_967_295),
            roughness: z.number().finite().min(0).max(1),
            density: z.number().finite().min(0).max(1),
            visible: z.boolean(),
            locked: z.boolean(),
          })
          .strict()
          .superRefine((region, ctx) => {
            if (region.geometry === 'polygon' && region.points.length < 3)
              ctx.addIssue({
                code: 'custom',
                path: ['points'],
                message: 'Polygon requires at least 3 points',
              });
          }),
      )
      .max(MAP_EDITOR_LIMITS.regions),
    objects: z.array(mapObject).max(MAP_EDITOR_LIMITS.objects),
    generated: generatedSnapshotSchema(mapObject).optional(),
    military: z.array(militaryLineSchema).max(128).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.divisionPaint ?? []).reduce((n, s) => n + s.points.length, 0) >
      DIVISION_LIMITS.totalPoints
    )
      ctx.addIssue({
        code: 'custom',
        path: ['divisionPaint'],
        message: 'Division point capacity exceeded',
      });
    if (value.generation?.version !== 1) return;
    value.regions.forEach((region, index) => {
      if (!legacyBiomeIds.some((biome) => biome === region.biome))
        ctx.addIssue({
          code: 'custom',
          path: ['regions', index, 'biome'],
          message:
            'New biomes require generation version 2; upgrade or stop the legacy generator first',
        });
    });
  });
const condition = z
  .object({
    variable: title,
    operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains']),
    value: short,
  })
  .strict();
const entity = z
  .object({
    ...authorship,
    id,
    worldId: id,
    type: entityType,
    name: title,
    summary: short,
    content: text,
    tags: z.array(z.string().max(100)).max(100),
    visibility: z.enum(['public', 'gm']),
    status: z.enum(['draft', 'complete']),
    attributes: z
      .record(z.string().min(1).max(200), z.string().max(20_000))
      .refine((v) => Object.keys(v).length <= 100, 'At most 100 attributes'),
    portrait: z
      .string()
      .max(2_000)
      .refine(
        (v) =>
          (/^\/(?:uploads|portraits)\/[A-Za-z0-9_./-]+$/.test(v) && !v.includes('..')) ||
          /^https:\/\/[^\s]+$/.test(v),
        'Use an uploaded image or HTTPS image URL',
      )
      .optional(),
    updatedAt: timestamp,
    cover: z
      .string()
      .refine(
        (url) => /^\/uploads\/[A-Za-z0-9_-]+\.(png|jpg|webp)$/.test(url) || isPresetCover(url),
        'Use an uploaded image or a bundled cover preset',
      )
      .optional(),
    graphPosition: point.optional(),
  })
  .strict();
const map = z
  .object({
    ...publication,
    id,
    worldId: id,
    name: title,
    summary: short,
    kind: z.enum(['world', 'region', 'town']),
    parentId: id.optional(),
    seed: z.number().int().min(-2_147_483_648).max(4_294_967_295),
    width: z.number().int().min(100).max(10_000),
    height: z.number().int().min(100).max(10_000),
    scaleKm: z.number().finite().min(0.01).max(1_000_000).optional(),
    pins: z
      .array(
        z
          .object({
            id,
            x: coordinate,
            y: coordinate,
            label: title,
            description: text,
            kind: z.enum(['city', 'landmark', 'danger', 'note']),
            entityId: id.optional(),
            childMapId: id.optional(),
          })
          .strict(),
      )
      .max(2_000),
    strokes: z
      .array(
        z
          .object({
            id,
            points: z.array(point).min(1).max(20_000),
            color: z.string().regex(/^#[\da-fA-F]{3}(?:[\da-fA-F]{3})?(?:[\da-fA-F]{2})?$/),
            width: z.number().min(0.1).max(200),
            tool: z.enum(['brush', 'road', 'river']),
          })
          .strict(),
      )
      .max(5_000),
    editor: editor.optional(),
  })
  .strict();
const plot = z
  .object({
    ...publication,
    layoutVersion: z.literal(1).optional(),
    id,
    worldId: id,
    name: title,
    summary: short,
    nodes: z
      .array(
        z
          .object({
            id,
            title,
            summary: text,
            entityIds: z.array(id).max(200),
            x: coordinate,
            y: coordinate,
            kind: z.enum(['start', 'scene', 'choice', 'ending']),
            status: z.enum(['locked', 'available', 'completed']),
            conditions: z.array(condition).max(100),
            conditionMode: z.enum(['all', 'any']),
            effects: z.array(z.object({ variable: title, value: short }).strict()).max(100),
          })
          .strict(),
      )
      .max(2_000),
    edges: z.array(z.object({ id, source: id, target: id, label: short }).strict()).max(10_000),
  })
  .strict();

export const workspaceDataSchema = z
  .object({
    worlds: z
      .array(
        z
          .object({
            id,
            name: title,
            subtitle: short,
            description: text,
            system: short,
            createdAt: timestamp,
            entityTemplates: z.record(entityType, templateFields).optional(),
            entityTypes: z
              .array(
                z
                  .object({
                    id: entityType,
                    name: z.string().trim().min(1).max(60),
                    description: short,
                  })
                  .strict(),
              )
              .min(1)
              .max(60)
              .optional(),
          })
          .strict(),
      )
      .max(100),
    entities: z.array(entity).max(20_000),
    maps: z.array(map).max(1_000),
    relations: z
      .array(
        z
          .object({
            ...publication,
            id,
            worldId: id,
            sourceId: id,
            targetId: id,
            label: title,
            description: text,
            kind: z.enum(['ally', 'enemy', 'family', 'neutral']),
          })
          .strict(),
      )
      .max(50_000),
    plots: z.array(plot).max(1_000),
    sessions: z
      .array(
        z
          .object({
            ...publication,
            id,
            worldId: id,
            title,
            date: z.iso.date(),
            content: text,
            status: z.enum(['planned', 'completed']),
          })
          .strict(),
      )
      .max(20_000),
    variables: z
      .array(z.object({ ...publication, id, worldId: id, name: title, value: short }).strict())
      .max(10_000),
  })
  .strict();
export const workspaceSchema = workspaceDataSchema.superRefine((data, ctx) => {
  const fail = (message: string, path: (string | number)[] = []) =>
    ctx.addIssue({ code: 'custom', message, path });
  const allIds = new Set<string>();
  const register = (items: { id: string }[], label: string) =>
    items.forEach((item, i) => {
      if (allIds.has(item.id)) fail(`Duplicate ID: ${item.id}`, [label, i, 'id']);
      allIds.add(item.id);
    });
  for (const [key, items] of Object.entries(data)) register(items, key);
  for (const m of data.maps) {
    register(m.pins, 'pins');
    register(m.strokes, 'strokes');
    if (m.editor) {
      register(m.editor.regions, 'regions');
      register(m.editor.objects, 'objects');
      register(m.editor.divisions ?? [], 'divisions');
      register(m.editor.divisionPaint ?? [], 'division paints');
      register(m.editor.military ?? [], 'military lines');
      if (m.editor.generation?.version === 2 && m.editor.generation.elevation)
        register(m.editor.generation.elevation.strokes, 'elevation strokes');
    }
  }
  for (const p of data.plots) {
    register(p.nodes, 'nodes');
    register(p.edges, 'edges');
  }
  const worlds = new Set(data.worlds.map((w) => w.id));
  for (const w of data.worlds) {
    const types = getEntityTypes(w);
    const ids = new Set(types.map((t) => t.id));
    if (
      ids.size !== types.length ||
      new Set(types.map((t) => t.name)).size !== types.length ||
      !ids.has('character')
    )
      fail(`Invalid type catalogue: ${w.id}`);
    if (Object.keys(w.entityTemplates ?? {}).some((type) => !ids.has(type as EntityType)))
      fail(`Template refers to an unknown type: ${w.id}`);
    for (const e of data.entities.filter((e) => e.worldId === w.id))
      if (!ids.has(e.type)) fail(`Unknown entity type: ${e.id}`);
  }
  const entities = new Map(data.entities.map((e) => [e.id, e]));
  const entityNames = new Set<string>();
  for (const e of data.entities) {
    const key = `${e.worldId}\0${e.name}`;
    if (entityNames.has(key)) fail(`Duplicate entity name: ${e.name}`);
    entityNames.add(key);
  }
  const maps = new Map(data.maps.map((m) => [m.id, m]));
  for (const group of [
    data.entities,
    data.maps,
    data.relations,
    data.plots,
    data.sessions,
    data.variables,
  ]) {
    for (const item of group) if (!worlds.has(item.worldId)) fail(`Unknown world for ${item.id}`);
  }
  const entityRef = (entityId: string, worldId: string) => {
    if (entities.get(entityId)?.worldId !== worldId)
      fail(`Invalid or cross-world entity reference: ${entityId}`);
  };
  const mapRef = (mapId: string, worldId: string) => {
    if (maps.get(mapId)?.worldId !== worldId)
      fail(`Invalid or cross-world map reference: ${mapId}`);
  };
  for (const m of data.maps) {
    if (m.parentId) mapRef(m.parentId, m.worldId);
    const visited = new Set([m.id]);
    let ancestor = m.parentId;
    while (ancestor) {
      if (visited.has(ancestor)) {
        fail(`Map hierarchy cycle at ${m.id}`);
        break;
      }
      visited.add(ancestor);
      ancestor = maps.get(ancestor)?.parentId;
    }
    for (const p of m.pins) {
      if (p.entityId) entityRef(p.entityId, m.worldId);
      if (p.childMapId) mapRef(p.childMapId, m.worldId);
      if (p.x < 0 || p.y < 0 || p.x > m.width || p.y > m.height) fail(`Pin outside map: ${p.id}`);
    }
    if (m.editor) {
      validateGeneratedMapGeometry(m, fail);
      for (const site of m.editor.generated?.sites ?? [])
        if (site.entityId) {
          entityRef(site.entityId, m.worldId);
          if (entities.get(site.entityId)?.type !== 'location')
            fail(`Invalid entity type for settlement: ${site.id}`);
        }
      const divisions = new Map((m.editor.divisions ?? []).map((d) => [d.id, d]));
      for (const d of divisions.values())
        if (d.entityId) {
          entityRef(d.entityId, m.worldId);
          if (entities.get(d.entityId)?.type !== divisionEntityTypes[d.kind])
            fail(`Invalid entity type for division: ${d.id}`);
        }
      const geography = m.editor.generated?.geography;
      for (const d of geography?.divisions ?? [])
        if (d.entityId) {
          entityRef(d.entityId, m.worldId);
          if (entities.get(d.entityId)?.type !== divisionEntityTypes[d.kind])
            fail(`Invalid entity type for geographic division: ${d.id}`);
        }
      for (const area of geography?.areas ?? [])
        if (area.entityId) entityRef(area.entityId, m.worldId);
      for (const port of geography?.ports ?? [])
        if (port.entityId) {
          entityRef(port.entityId, m.worldId);
          if (entities.get(port.entityId)?.type !== 'location')
            fail(`Invalid entity type for geographic port: ${port.id}`);
        }
      for (const site of m.editor.generated?.sites ?? [])
        if (site.entityId) {
          entityRef(site.entityId, m.worldId);
          if (entities.get(site.entityId)?.type !== 'location')
            fail(`Invalid entity type for generated settlement: ${site.id}`);
        }
      for (const s of m.editor.divisionPaint ?? []) {
        if (!divisions.has(s.divisionId)) fail(`Unknown map division: ${s.divisionId}`);
        if (s.points.some((p) => p.x < 0 || p.y < 0 || p.x > m.width || p.y > m.height))
          fail(`Division point outside map: ${s.id}`);
      }
      for (const item of [...m.editor.regions, ...m.editor.objects]) {
        if (item.points.some((p) => p.x < 0 || p.y < 0 || p.x > m.width || p.y > m.height))
          fail(`Editor point outside map: ${item.id}`);
      }
      if (m.editor.generation?.version === 2) {
        for (const [siteId, entityId] of Object.entries(
          m.editor.generation.settlementLinks ?? {},
        )) {
          entityRef(entityId, m.worldId);
          if (entities.get(entityId)?.type !== 'location')
            fail(`Invalid entity type for settlement link: ${siteId}`);
        }
        for (const stroke of m.editor.generation.elevation?.strokes ?? []) {
          if (stroke.points.some((p) => p.x < 0 || p.y < 0 || p.x > m.width || p.y > m.height))
            fail(`Elevation point outside map: ${stroke.id}`);
        }
      }
    }
  }
  for (const r of data.relations) {
    entityRef(r.sourceId, r.worldId);
    entityRef(r.targetId, r.worldId);
  }
  const variableNames = new Set<string>();
  for (const v of data.variables) {
    const key = `${v.worldId}\0${v.name}`;
    if (variableNames.has(key)) fail(`Duplicate variable name: ${v.name}`);
    variableNames.add(key);
  }
  for (const p of data.plots) {
    const nodeIds = new Set(p.nodes.map((n) => n.id));
    for (const node of p.nodes) {
      for (const eid of node.entityIds) entityRef(eid, p.worldId);
      for (const rule of [...node.conditions, ...node.effects])
        if (!variableNames.has(`${p.worldId}\0${rule.variable}`))
          fail(`Unknown variable: ${rule.variable}`);
    }
    for (const edge of p.edges)
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target))
        fail(`Unknown plot edge endpoint: ${edge.id}`);
  }
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 15 * 1024 * 1024)
    fail('创作档案超过 15 MiB 保存容量，请减少地图生成精度或分开导出；原有数据未被覆盖。');
});

export function validateWorkspace(value: unknown): Workspace {
  return workspaceSchema.parse(value);
}
export const saveSchema = z
  .object({ data: workspaceSchema, revision: z.number().int().nonnegative() })
  .strict();
