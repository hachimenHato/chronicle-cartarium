import type { AtlasMap } from './model';
import type { MapObject, MapPoint } from './cartography';

export type MapFeatureKind = 'settlements' | 'ports' | 'roads' | 'seaRoutes';
export interface MapFeature {
  id: string;
  kind: MapFeatureKind;
  name: string;
  point: MapPoint;
  origin: 'generated' | 'object' | 'stroke' | 'pin';
  objectIds?: string[];
}
const center = (points: MapPoint[]) => points[Math.floor(points.length / 2)] ?? { x: 0, y: 0 };
const settlementSymbols = new Set(['city', 'town', 'village', 'castle', 'camp']);
const portSymbols = new Set(['port', 'dock']);
function distanceToLine(p: MapPoint, points: MapPoint[]) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
    );
    const x = p.x - a.x - dx * t,
      y = p.y - a.y - dy * t;
    best = Math.min(best, x * x + y * y);
  }
  return Math.sqrt(best);
}
const sameLine = (a: MapPoint[], b: MapPoint[]) =>
  a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);

/** Stable groups include every building/shadow and both road strokes. Baked maps keep the same group IDs. */
export function mapFeatures(map: AtlasMap): MapFeature[] {
  const snapshot = map.editor?.generated;
  const frozen = !map.editor?.generation;
  const objects = frozen ? (map.editor?.objects ?? []) : (snapshot?.objects ?? []);
  const origin = frozen ? 'object' : 'generated';
  const result: MapFeature[] = [],
    grouped = new Set<string>();
  const siteObjects = new Map<number, string[]>();
  const roads = new Map<number, MapObject[]>();
  const bridges: MapObject[] = [];
  // Index once: the generated artwork can contain tens of thousands of objects.
  for (const object of objects) {
    const site = /^聚落 ([1-9]\d*) ·/.exec(object.name);
    if (site) {
      const index = Number(site[1]) - 1;
      const ids = siteObjects.get(index) ?? [];
      ids.push(object.id);
      siteObjects.set(index, ids);
    }
    const road = /^道路 (\d+)(?: · (?:路基|边缘))?$/.exec(object.name);
    if (road) {
      const index = Number(road[1]);
      const items = roads.get(index) ?? [];
      items.push(object);
      roads.set(index, items);
    }
    if (object.name === '道路桥栏') bridges.push(object);
  }
  for (const [index, site] of (snapshot?.sites ?? []).entries()) {
    const objectIds = siteObjects.get(index) ?? [];
    objectIds.forEach((id) => grouped.add(id));
    result.push({
      id: site.id,
      kind: 'settlements',
      name: site.name,
      point: site,
      origin,
      objectIds,
    });
  }
  const paths = [...roads].map(([index, items]) => ({ index, items, points: items[0].points }));
  for (const object of bridges) {
    const point = center(object.points),
      distances = paths.map((r) => distanceToLine(point, r.points));
    const nearest = Math.min(...distances);
    // A crossing bridge remains visible while any road using it is visible.
    for (let i = 0; i < paths.length; i++)
      if (distances[i] <= nearest + 0.2) paths[i].items.push(object);
  }
  for (const road of paths) {
    road.items.forEach((o) => grouped.add(o.id));
    result.push({
      id: `generated_road_${road.index}`,
      kind: 'roads',
      name: `道路 ${road.index}`,
      point: center(road.points),
      origin,
      objectIds: road.items.map((o) => o.id),
    });
  }
  for (const port of snapshot?.geography?.ports ?? [])
    result.push({
      id: port.id,
      kind: 'ports',
      name: port.name,
      point: port.center,
      origin: 'generated',
    });
  for (const route of snapshot?.geography?.seaRoutes ?? [])
    result.push({
      id: route.id,
      kind: 'seaRoutes',
      name: route.name,
      point: center(route.points),
      origin: 'generated',
    });
  const authored = map.editor?.objects ?? [];
  const roadEdges = authored.filter((o) => o.name === '原手绘道路 · 边缘');
  for (const object of authored) {
    if (grouped.has(object.id)) continue;
    if (
      object.kind === 'symbol' &&
      (settlementSymbols.has(object.symbol ?? '') || portSymbols.has(object.symbol ?? ''))
    ) {
      result.push({
        id: object.id,
        kind: portSymbols.has(object.symbol ?? '') ? 'ports' : 'settlements',
        name: object.name,
        point: center(object.points),
        origin: 'object',
        objectIds: [object.id],
      });
    } else if (
      object.kind === 'path' &&
      /^(?:道路|原手绘道路|手绘道路)/.test(object.name) &&
      !object.name.endsWith(' · 边缘')
    ) {
      const edges = roadEdges.filter((o) => sameLine(o.points, object.points));
      result.push({
        id: object.id,
        kind: 'roads',
        name: object.name,
        point: center(object.points),
        origin: 'object',
        objectIds: [object.id, ...edges.map((o) => o.id)],
      });
    }
  }
  for (const stroke of map.strokes.filter((s) => s.tool === 'road'))
    result.push({
      id: stroke.id,
      kind: 'roads',
      name: '手绘道路',
      point: center(stroke.points),
      origin: 'stroke',
    });
  for (const pin of map.pins.filter((p) => p.kind === 'city'))
    result.push({ id: pin.id, kind: 'settlements', name: pin.label, point: pin, origin: 'pin' });
  return result;
}
export function featureHidden(map: AtlasMap, kind: MapFeatureKind, id: string) {
  return map.editor?.hiddenFeatures?.[kind]?.includes(id) ?? false;
}
export function toggleMapFeature(map: AtlasMap, kind: MapFeatureKind, id: string): AtlasMap {
  const editor = map.editor ?? {
    version: 1 as const,
    mode: 'sketch' as const,
    baseVisible: true,
    regions: [],
    objects: [],
  };
  const ids = new Set(editor.hiddenFeatures?.[kind] ?? []);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return {
    ...map,
    editor: { ...editor, hiddenFeatures: { ...editor.hiddenFeatures, [kind]: [...ids] } },
  };
}
export function hiddenFeatureObjects(map: AtlasMap, origin: 'generated' | 'object' = 'generated') {
  const hidden = map.editor?.hiddenFeatures;
  // Ports/routes in the generated overlay have no MapObject ownership. The usual
  // all-visible map must not inspect roads/bridges merely to return an empty set.
  if (
    !hidden ||
    (!hidden.settlements?.length &&
      !hidden.roads?.length &&
      (origin === 'generated' || !hidden.ports?.length)) ||
    (origin === 'generated' && !map.editor?.generation)
  )
    return new Set<string>();
  const ids = new Set([
    ...(hidden.settlements ?? []),
    ...(hidden.roads ?? []),
    ...(hidden.ports ?? []),
  ]);
  // Unbaked authored groups use the main object's ID. Hidden generated groups
  // cannot affect them, even while a draft object is moving every frame.
  if (
    origin === 'object' &&
    map.editor?.generation &&
    !map.editor.objects.some((object) => ids.has(object.id))
  )
    return new Set<string>();
  const owners = new Map<string, boolean>();
  for (const feature of mapFeatures(map).filter((f) => f.origin === origin))
    for (const id of feature.objectIds ?? [])
      owners.set(id, (owners.get(id) ?? true) && featureHidden(map, feature.kind, feature.id));
  return new Set([...owners].filter(([, hidden]) => hidden).map(([id]) => id));
}
