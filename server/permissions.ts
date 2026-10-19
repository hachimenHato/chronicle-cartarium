import { isDeepStrictEqual } from 'node:util';
import {
  canRead,
  canCreate,
  canChange,
  isAdministrator,
  recordModule,
  type UserAccount,
} from '../shared/access';
import type { Workspace, Entity, AtlasMap, Plot } from '../shared/model';
import type { GeneratedGeography } from '../shared/geography';
import type { GeneratedMapSnapshot } from '../shared/generated-map';
import { validateWorkspace } from './validation';
import { clearMapEntityLinks, saveEntityInWorkspace } from '../shared/workspace-mutations';

export class PermissionError extends Error {
  constructor(message = '当前账户没有执行此操作的权限。') {
    super(message);
  }
}
export const requireOwner = (actor: UserAccount) => {
  if (actor.role !== 'owner') throw new PermissionError('此操作仅限主管理员。');
};
export const requireAdministrator = (actor: UserAccount) => {
  if (!isAdministrator(actor)) throw new PermissionError('此操作仅限管理员。');
};
const collections = ['entities', 'maps', 'relations', 'plots', 'sessions', 'variables'] as const;

function mapTexts(map: AtlasMap): string[] {
  const snapshot = map.editor?.generated;
  const geography = snapshot?.geography;
  return [
    map.name,
    map.summary,
    ...map.pins.flatMap((pin) => [pin.label, pin.description]),
    ...(map.editor?.regions ?? []).map((region) => region.name),
    ...(map.editor?.objects ?? []).flatMap((object) => [object.name, object.text]),
    ...(map.editor?.military ?? []).map((line) => line.name),
    ...(map.editor?.divisions ?? []).map((division) => division.name),
    ...(map.editor?.generation?.version === 2
      ? Object.values(map.editor.generation.settlementNames ?? {})
      : []),
    ...(snapshot?.objects ?? []).flatMap((object) => [object.name, object.text]),
    ...(snapshot?.sites ?? []).map((site) => site.name),
    ...(geography?.areas ?? []).map((area) => area.name),
    ...(geography?.divisions ?? []).map((division) => division.name),
    ...(geography?.plates ?? []).map((plate) => plate.name),
    ...(geography?.ports ?? []).map((port) => port.name),
    ...(geography?.seaRoutes ?? []).map((route) => route.name),
  ];
}

/** Geography is public base geometry; linked private names, ownership and political edges are not. */
function visibleGeneratedMap(
  snapshot: GeneratedMapSnapshot,
  entityIds: Set<string>,
  redact: (text: string) => string,
  settlementLinks: Record<string, string> = {},
): GeneratedMapSnapshot {
  const next = structuredClone(snapshot);
  next.objects = next.objects.map((object) => ({
    ...object,
    name: redact(object.name),
    text: redact(object.text),
  }));
  const hiddenSites = new Set(
    (next.sites ?? [])
      .filter((site) => {
        const linked = settlementLinks[site.id] ?? site.entityId;
        return linked && !entityIds.has(linked);
      })
      .map((site) => site.id),
  );
  next.objects = next.objects.map((object) => {
    const label = /^聚落 (\d+) · 名称$/.exec(object.name);
    const site = label && next.sites?.[Number(label[1]) - 1];
    return site && hiddenSites.has(site.id) ? { ...object, text: '未公开聚落' } : object;
  });
  next.sites = next.sites?.map((site) =>
    hiddenSites.has(site.id)
      ? { ...site, name: '未公开聚落', entityId: undefined }
      : { ...site, name: redact(site.name) },
  );
  const geo = next.geography;
  if (!geo) return next;
  const hiddenDivisions = new Set(
    geo.divisions.filter((d) => d.entityId && !entityIds.has(d.entityId)).map((d) => d.id),
  );
  const originalCells = new Map(geo.cells.map((cell) => [cell.id, cell]));
  geo.divisions = geo.divisions
    .filter((d) => !hiddenDivisions.has(d.id))
    .map((d) => ({ ...d, name: redact(d.name) }));
  geo.areas = geo.areas
    .filter((area) => !area.entityId || entityIds.has(area.entityId))
    .map((area) => ({ ...area, name: redact(area.name) }));
  geo.cells = geo.cells.map((cell) => {
    const shown = { ...cell };
    for (const kind of ['country', 'culture', 'religion'] as const)
      if (cell[kind] && hiddenDivisions.has(cell[kind]!)) delete shown[kind];
    return shown;
  });
  geo.borders = geo.borders.filter((border) => {
    if (border.kind !== 'country' && border.kind !== 'culture' && border.kind !== 'religion')
      return true;
    const kind = border.kind;
    return border.cells.every((id) => !hiddenDivisions.has(originalCells.get(id)?.[kind] ?? ''));
  });
  geo.plates = geo.plates.map((plate) => ({ ...plate, name: redact(plate.name) }));
  const hiddenPorts = new Set(
    geo.ports
      .filter(
        (port) =>
          (port.settlementId && hiddenSites.has(port.settlementId)) ||
          (port.entityId && !entityIds.has(port.entityId)),
      )
      .map((port) => port.id),
  );
  geo.ports = geo.ports.map((port) => ({
    ...port,
    name: hiddenPorts.has(port.id) ? '未公开港口' : redact(port.name),
    ...(hiddenPorts.has(port.id) ? { entityId: undefined } : {}),
  }));
  geo.seaRoutes = geo.seaRoutes.map((route) => ({
    ...route,
    name:
      hiddenPorts.has(route.from) || hiddenPorts.has(route.to)
        ? '未公开港口航线'
        : redact(route.name),
  }));
  return next;
}

/** The same projection is used for reads and diffing writes; hidden records never become deletions. */
export function visibleWorkspace(data: Workspace, actor: UserAccount): Workspace {
  if (isAdministrator(actor)) return structuredClone(data);
  const entities = data.entities.filter((e) => canRead(actor, e));
  const ids = new Set(entities.map((e) => e.id));
  const privateNames = new Map(
    data.worlds.map((w) => [
      w.id,
      new Set(data.entities.filter((e) => e.worldId === w.id && !ids.has(e.id)).map((e) => e.name)),
    ]),
  );
  const redact = (text: string, worldId: string) =>
    text.replace(/\[\[([^\]]+)\]\]/g, (whole, name: string) =>
      privateNames.get(worldId)?.has(name.trim()) ? '〔未公开条目〕' : whole,
    );
  const maps = data.maps.filter((m) => canRead(actor, m));
  const mapIds = new Set(maps.map((m) => m.id));
  const variables = data.variables.filter((v) => canRead(actor, v));
  const visibleVariables = new Set(variables.map((v) => `${v.worldId}\0${v.name}`));
  return {
    worlds: data.worlds.map((w) => ({ ...w, description: redact(w.description, w.id) })),
    entities: entities.map((e) => ({
      ...e,
      summary: redact(e.summary, e.worldId),
      content: redact(e.content, e.worldId),
      attributes: Object.fromEntries(
        Object.entries(e.attributes).map(([k, v]) => [k, redact(v, e.worldId)]),
      ),
    })),
    maps: maps.map((m) => {
      const divisions = (m.editor?.divisions ?? []).filter(
        (d) => !d.entityId || ids.has(d.entityId),
      );
      const divisionIds = new Set(divisions.map((d) => d.id));
      const hiddenPinIds = new Set(
        m.pins.filter((pin) => pin.entityId && !ids.has(pin.entityId)).map((pin) => pin.id),
      );
      return {
        ...m,
        name: redact(m.name, m.worldId),
        summary: redact(m.summary, m.worldId),
        parentId: m.parentId && mapIds.has(m.parentId) ? m.parentId : undefined,
        pins: m.pins
          .filter((p) => !p.entityId || ids.has(p.entityId))
          .map((p) => ({
            ...p,
            label: redact(p.label, m.worldId),
            description: redact(p.description, m.worldId),
            childMapId: p.childMapId && mapIds.has(p.childMapId) ? p.childMapId : undefined,
          })),
        ...(m.editor
          ? {
              editor: {
                ...m.editor,
                ...(m.editor.hiddenFeatures?.settlements
                  ? {
                      hiddenFeatures: {
                        ...m.editor.hiddenFeatures,
                        settlements: m.editor.hiddenFeatures.settlements.filter(
                          (id) => !hiddenPinIds.has(id),
                        ),
                      },
                    }
                  : {}),
                divisions: divisions.map((d) => ({ ...d, name: redact(d.name, m.worldId) })),
                divisionPaint: (m.editor.divisionPaint ?? []).filter((p) =>
                  divisionIds.has(p.divisionId),
                ),
                regions: m.editor.regions.map((region) => ({
                  ...structuredClone(region),
                  name: redact(region.name, m.worldId),
                })),
                objects: m.editor.objects.map((object) => ({
                  ...structuredClone(object),
                  name: redact(object.name, m.worldId),
                  text: redact(object.text, m.worldId),
                })),
                ...(m.editor.generated
                  ? {
                      generated: visibleGeneratedMap(
                        m.editor.generated,
                        ids,
                        (text) => redact(text, m.worldId),
                        m.editor.generation?.version === 2
                          ? m.editor.generation.settlementLinks
                          : undefined,
                      ),
                    }
                  : {}),
                ...(m.editor.military
                  ? {
                      military: m.editor.military.map((line) => ({
                        ...structuredClone(line),
                        name: redact(line.name, m.worldId),
                      })),
                    }
                  : {}),
                ...(m.editor.generation?.version === 2
                  ? {
                      generation: {
                        ...m.editor.generation,
                        ...(m.editor.generation.settlementNames
                          ? {
                              settlementNames: Object.fromEntries(
                                Object.entries(m.editor.generation.settlementNames).map(
                                  ([key, value]) => {
                                    const linked =
                                      m.editor!.generation?.version === 2
                                        ? m.editor!.generation.settlementLinks?.[key]
                                        : undefined;
                                    return [
                                      key,
                                      linked && !ids.has(linked)
                                        ? '未公开聚落'
                                        : redact(value, m.worldId),
                                    ];
                                  },
                                ),
                              ),
                            }
                          : {}),
                        ...(m.editor.generation.settlementLinks
                          ? {
                              settlementLinks: Object.fromEntries(
                                Object.entries(m.editor.generation.settlementLinks).filter(
                                  ([, value]) => ids.has(value),
                                ),
                              ),
                            }
                          : {}),
                      },
                    }
                  : {}),
              },
            }
          : {}),
      };
    }),
    relations: data.relations
      .filter((r) => canRead(actor, r) && ids.has(r.sourceId) && ids.has(r.targetId))
      .map((r) => ({ ...r, description: redact(r.description, r.worldId) })),
    plots: data.plots
      .filter(
        (p) =>
          canRead(actor, p) &&
          p.nodes.every((n) =>
            [...n.conditions, ...n.effects].every((v) =>
              visibleVariables.has(`${p.worldId}\0${v.variable}`),
            ),
          ),
      )
      .map((p) => ({
        ...p,
        summary: redact(p.summary, p.worldId),
        nodes: p.nodes.map((n) => ({
          ...n,
          summary: redact(n.summary, p.worldId),
          entityIds: n.entityIds.filter((id) => ids.has(id)),
        })),
      })),
    sessions: data.sessions
      .filter((s) => canRead(actor, s))
      .map((s) => ({ ...s, content: redact(s.content, s.worldId) })),
    variables,
  };
}

/** Keep fields that were only redacted by the server when the browser has not changed them. */
function restoreUnchanged<T extends object>(original: T, projected: T, submitted: T): T {
  const next = { ...submitted };
  for (const key of new Set([...Object.keys(original), ...Object.keys(projected)])) {
    const k = key as keyof T;
    if (isDeepStrictEqual(submitted[k], projected[k])) {
      if (Object.hasOwn(original, key)) next[k] = original[k];
      else delete next[k];
    }
  }
  return next;
}
function preserveHiddenMapParts(
  original: AtlasMap,
  projected: AtlasMap,
  submitted: AtlasMap,
): AtlasMap {
  const oldGeneration = original.editor?.generation;
  const projectedGeneration = projected.editor?.generation;
  const hiddenSettlementLinks =
    oldGeneration?.version === 2 && projectedGeneration?.version === 2
      ? Object.fromEntries(
          Object.entries(oldGeneration.settlementLinks ?? {}).filter(
            ([key, value]) => projectedGeneration.settlementLinks?.[key] !== value,
          ),
        )
      : {};
  const hiddenSettlementIds = new Set([
    ...Object.keys(hiddenSettlementLinks),
    ...(original.editor?.generated?.sites ?? [])
      .filter(
        (site) =>
          site.entityId &&
          projected.editor?.generated?.sites?.find((shown) => shown.id === site.id)?.entityId !==
            site.entityId,
      )
      .map((site) => site.id),
  ]);
  const physicalRecipe = (recipe: unknown) => {
    if (!recipe || typeof recipe !== 'object') return recipe;
    const {
      settlementNames: _names,
      settlementLinks: _links,
      ...physical
    } = recipe as Record<string, unknown>;
    return physical;
  };
  if (
    hiddenSettlementIds.size &&
    (!submitted.editor ||
      !isDeepStrictEqual(
        physicalRecipe(original.editor?.generation),
        physicalRecipe(submitted.editor.generation),
      ) ||
      original.editor?.generated?.signature !== submitted.editor.generated?.signature ||
      [...hiddenSettlementIds].some(
        (id) => !submitted.editor?.generated?.sites?.some((site) => site.id === id),
      ))
  )
    throw new PermissionError('地图包含未公开聚落，请由管理员删除或重新生成。');
  const originalGeo = original.editor?.generated?.geography;
  const projectedGeo = projected.editor?.generated?.geography;
  if (
    originalGeo &&
    projectedGeo &&
    hiddenGeographicPorts(originalGeo, projectedGeo, hiddenSettlementIds).size &&
    (!submitted.editor ||
      !isDeepStrictEqual(
        physicalRecipe(original.editor?.generation),
        physicalRecipe(submitted.editor.generation),
      ) ||
      original.editor?.generated?.signature !== submitted.editor.generated?.signature)
  )
    throw new PermissionError('地图包含未公开港口，请由管理员删除或重新生成。');
  const pins = new Set(projected.pins.map((p) => p.id));
  const hidden = original.pins.filter((p) => !pins.has(p.id));
  if (
    !isDeepStrictEqual(original.pins, submitted.pins) &&
    hidden.some((p) => submitted.pins.some((s) => s.id === p.id))
  )
    throw new PermissionError();
  const next = {
    ...submitted,
    pins: isDeepStrictEqual(original.pins, submitted.pins)
      ? submitted.pins
      : [
          ...submitted.pins.map((p) => {
            const old = original.pins.find((v) => v.id === p.id),
              shown = projected.pins.find((v) => v.id === p.id);
            return old && shown ? restoreUnchanged(old, shown, p) : p;
          }),
          ...hidden,
        ],
  };
  if (original.editor && projected.editor && !next.editor) {
    const hiddenDivisions = (original.editor.divisions ?? []).some(
      (d) => !(projected.editor!.divisions ?? []).some((shown) => shown.id === d.id),
    );
    const originalGeo = original.editor.generated?.geography;
    const shownGeo = projected.editor.generated?.geography;
    if (hiddenDivisions || (originalGeo && shownGeo && hasHiddenGeography(originalGeo, shownGeo)))
      throw new PermissionError('地图包含未公开疆域或地名，请由管理员删除或重新生成。');
  }
  if (
    original.editor &&
    projected.editor &&
    next.editor &&
    !isDeepStrictEqual(next.editor, original.editor)
  ) {
    const shown = new Set((projected.editor.divisions ?? []).map((d) => d.id));
    const hiddenDivisions = (original.editor.divisions ?? []).filter((d) => !shown.has(d.id));
    if (hiddenDivisions.some((d) => next.editor!.divisions?.some((v) => v.id === d.id)))
      throw new PermissionError();
    const hiddenIds = new Set(hiddenDivisions.map((d) => d.id));
    next.editor = {
      ...next.editor,
      divisions: [
        ...(next.editor.divisions ?? []).map((d) => {
          const old = original.editor!.divisions?.find((v) => v.id === d.id);
          const shown = projected.editor!.divisions?.find((v) => v.id === d.id);
          return old && shown ? restoreUnchanged(old, shown, d) : d;
        }),
        ...hiddenDivisions,
      ],
      divisionPaint: [
        ...(next.editor.divisionPaint ?? []),
        ...(original.editor.divisionPaint ?? []).filter((p) => hiddenIds.has(p.divisionId)),
      ],
      regions: next.editor.regions.map((region) => {
        const old = original.editor!.regions.find((v) => v.id === region.id);
        const shown = projected.editor!.regions.find((v) => v.id === region.id);
        return old && shown ? restoreUnchanged(old, shown, region) : region;
      }),
      objects: next.editor.objects.map((object) => {
        const old = original.editor!.objects.find((v) => v.id === object.id);
        const shown = projected.editor!.objects.find((v) => v.id === object.id);
        return old && shown ? restoreUnchanged(old, shown, object) : object;
      }),
      military: next.editor.military?.map((line) => {
        const old = original.editor!.military?.find((v) => v.id === line.id);
        const shown = projected.editor!.military?.find((v) => v.id === line.id);
        return old && shown ? restoreUnchanged(old, shown, line) : line;
      }),
    };
    if (
      hidden.length &&
      next.editor.hiddenFeatures?.settlements?.some(
        (id) => !pins.has(id) && hidden.some((pin) => pin.id === id),
      )
    )
      throw new PermissionError('不能修改未公开地点的显示状态。');
    const hiddenPinFlags = original.editor.hiddenFeatures?.settlements?.filter((id) =>
      hidden.some((pin) => pin.id === id),
    );
    if (hiddenPinFlags?.length)
      next.editor.hiddenFeatures = {
        ...next.editor.hiddenFeatures,
        settlements: [...(next.editor.hiddenFeatures?.settlements ?? []), ...hiddenPinFlags],
      };
    const oldRecipe = original.editor.generation;
    const shownRecipe = projected.editor.generation;
    if (oldRecipe && shownRecipe && next.editor.generation) {
      if (isDeepStrictEqual(next.editor.generation, shownRecipe))
        next.editor.generation = oldRecipe;
      else if (
        oldRecipe.version === 2 &&
        shownRecipe.version === 2 &&
        next.editor.generation.version === 2 &&
        next.editor.generation.settlementNames
      )
        next.editor.generation = {
          ...next.editor.generation,
          settlementNames: Object.fromEntries(
            Object.entries(next.editor.generation.settlementNames).map(([key, value]) => [
              key,
              value === shownRecipe.settlementNames?.[key]
                ? (oldRecipe.settlementNames?.[key] ?? value)
                : value,
            ]),
          ),
        };
      if (
        next.editor.generation.version === 2 &&
        oldRecipe.version === 2 &&
        hiddenSettlementIds.size
      )
        next.editor.generation = {
          ...next.editor.generation,
          settlementLinks: { ...next.editor.generation.settlementLinks, ...hiddenSettlementLinks },
          settlementNames: {
            ...next.editor.generation.settlementNames,
            ...Object.fromEntries(
              Object.entries(oldRecipe.settlementNames ?? {}).filter(([key]) =>
                hiddenSettlementIds.has(key),
              ),
            ),
          },
        };
    }
    const oldSnapshot = original.editor.generated;
    const shownSnapshot = projected.editor.generated;
    if (oldSnapshot && shownSnapshot) {
      if (isDeepStrictEqual(next.editor.generated, shownSnapshot))
        next.editor.generated = oldSnapshot;
      else if (next.editor.generated) {
        const edited = restoreUnchanged(oldSnapshot, shownSnapshot, next.editor.generated);
        edited.objects = edited.objects.map((object) => {
          const old = oldSnapshot.objects.find((v) => v.id === object.id);
          const shown = shownSnapshot.objects.find((v) => v.id === object.id);
          return old && shown ? restoreUnchanged(old, shown, object) : object;
        });
        edited.sites = edited.sites?.map((site) => {
          const old = oldSnapshot.sites?.find((v) => v.id === site.id);
          const shown = shownSnapshot.sites?.find((v) => v.id === site.id);
          if (old && hiddenSettlementIds.has(site.id)) {
            if (shown && !isDeepStrictEqual(site, shown))
              throw new PermissionError('不能修改未公开聚落。');
            return old;
          }
          return old && shown ? restoreUnchanged(old, shown, site) : site;
        });
        if (oldSnapshot.geography && shownSnapshot.geography && edited.geography)
          edited.geography = preserveHiddenGeography(
            oldSnapshot.geography,
            shownSnapshot.geography,
            edited.geography,
            hiddenSettlementIds,
          );
        else if (
          oldSnapshot.geography &&
          shownSnapshot.geography &&
          hasHiddenGeography(oldSnapshot.geography, shownSnapshot.geography)
        )
          throw new PermissionError('地图包含未公开疆域或地名，请由管理员删除或重新生成。');
        next.editor.generated = edited;
      } else if (
        oldSnapshot.geography &&
        shownSnapshot.geography &&
        hasHiddenGeography(oldSnapshot.geography, shownSnapshot.geography)
      )
        throw new PermissionError('地图包含未公开疆域或地名，请由管理员删除或重新生成。');
    }
  }
  return next;
}

function hasHiddenGeography(original: GeneratedGeography, shown: GeneratedGeography): boolean {
  return (
    original.divisions.length !== shown.divisions.length ||
    original.areas.length !== shown.areas.length ||
    hiddenGeographicPorts(original, shown).size > 0
  );
}

function hiddenGeographicPorts(
  original: GeneratedGeography,
  shown: GeneratedGeography,
  hiddenSettlementIds: ReadonlySet<string> = new Set(),
): Set<string> {
  return new Set(
    original.ports
      .filter((port) => {
        const projected = shown.ports.find((item) => item.id === port.id);
        return (
          !projected ||
          port.entityId !== projected.entityId ||
          (port.settlementId && hiddenSettlementIds.has(port.settlementId)) ||
          (projected.name === '未公开港口' && port.name !== projected.name)
        );
      })
      .map((port) => port.id),
  );
}

function preserveHiddenGeography(
  original: GeneratedGeography,
  shown: GeneratedGeography,
  submitted: GeneratedGeography,
  hiddenSettlementIds: ReadonlySet<string> = new Set(),
): GeneratedGeography {
  if (isDeepStrictEqual(submitted, original)) return original;
  const next = restoreUnchanged(original, shown, submitted);
  const hiddenPorts = hiddenGeographicPorts(original, shown, hiddenSettlementIds);
  for (const id of hiddenPorts) {
    const port = submitted.ports.find((item) => item.id === id);
    const projected = shown.ports.find((item) => item.id === id);
    if (!port || !projected || !isDeepStrictEqual(port, projected))
      throw new PermissionError('不能修改未公开港口。');
  }
  for (const originalRoute of original.seaRoutes) {
    if (!hiddenPorts.has(originalRoute.from) && !hiddenPorts.has(originalRoute.to)) continue;
    const route = submitted.seaRoutes.find((item) => item.id === originalRoute.id);
    const projected = shown.seaRoutes.find((item) => item.id === originalRoute.id);
    if (!route || !projected || !isDeepStrictEqual(route, projected))
      throw new PermissionError('不能修改未公开港口的航路。');
  }
  const structuralCells = (geo: GeneratedGeography) =>
    geo.cells.map((cell) => ({
      id: cell.id,
      center: cell.center,
      polygon: cell.polygon,
      neighbors: cell.neighbors,
      land: cell.land,
      plate: cell.plate,
    }));
  if (
    (hasHiddenGeography(original, shown) || hiddenPorts.size > 0) &&
    !isDeepStrictEqual(structuralCells(original), structuralCells(next))
  )
    throw new PermissionError('地图包含未公开疆域或地名，重新生成地理单元需要管理员执行。');
  const hidden = new Set(
    original.divisions.filter((d) => !shown.divisions.some((s) => s.id === d.id)).map((d) => d.id),
  );
  for (const key of ['divisions', 'areas', 'borders', 'plates', 'ports', 'seaRoutes'] as const) {
    const hiddenItems = original[key].filter((item) => !shown[key].some((v) => v.id === item.id));
    if (
      key !== 'borders' &&
      hiddenItems.some((item) => submitted[key].some((v) => v.id === item.id))
    )
      throw new PermissionError('不能修改尚未获准查看的地图分区。');
    // Political edges are derived from ownership. Redacted cells may cause the client
    // to derive an edge already hidden by the server; never treat this as private data editing.
    (next[key] as { id: string | number }[]) = [
      ...submitted[key]
        .filter((item) => !hiddenItems.some((hidden) => hidden.id === item.id))
        .map((item) => {
          const old = original[key].find((v) => v.id === item.id);
          const projected = shown[key].find((v) => v.id === item.id);
          return old && projected ? restoreUnchanged(old, projected, item) : item;
        }),
      ...hiddenItems,
    ];
  }
  next.cells = next.cells.map((cell) => {
    const old = original.cells.find((v) => v.id === cell.id);
    if (!old) return cell;
    const kept = { ...cell };
    for (const kind of ['country', 'culture', 'religion'] as const)
      if (old[kind] && hidden.has(old[kind]!)) {
        if (cell[kind] && cell[kind] !== old[kind])
          throw new PermissionError('此编辑会覆盖未公开疆域，请由管理员处理。');
        kept[kind] = old[kind];
      }
    return kept;
  });
  if (hidden.size) {
    const political = new Map(
      [...submitted.borders, ...original.borders]
        .filter((border) => ['country', 'culture', 'religion'].includes(border.kind))
        .map((border) => [`${border.kind}:${border.cells.join(':')}`, border]),
    );
    const borders = next.borders.filter((border) => ['plate', 'cell'].includes(border.kind));
    const sharedEdges = borders.filter((border) => border.kind === 'cell');
    for (const edge of sharedEdges) {
      const [left, right] = edge.cells.map((id) => next.cells[id]);
      if (!left?.land || !right?.land) continue;
      for (const kind of ['country', 'culture', 'religion'] as const)
        if (left[kind] !== right[kind] && (left[kind] || right[kind])) {
          const existing = political.get(`${kind}:${edge.cells.join(':')}`);
          borders.push({
            id: existing?.id ?? `${kind}_${left.id}_${right.id}`,
            kind,
            cells: edge.cells,
            points: edge.points,
          });
        }
    }
    next.borders = borders;
  }
  return next;
}

export function mergeAuthorizedWorkspace(
  before: Workspace,
  submitted: Workspace,
  actor: UserAccount,
): Workspace {
  const projected = visibleWorkspace(before, actor);
  if (actor.role === 'owner') {
    const stamped = structuredClone(submitted);
    for (const key of collections)
      for (const record of stamped[key]) {
        const old = before[key].find((r) => r.id === record.id);
        if (old) {
          if (record.createdBy !== old.createdBy)
            throw new PermissionError('不能修改条目的作者归属。');
        } else record.createdBy = actor.id;
      }
    const removed = new Set(
      before.entities
        .filter((entity) => !stamped.entities.some((item) => item.id === entity.id))
        .map((entity) => entity.id),
    );
    if (removed.size) stamped.maps = stamped.maps.map((map) => clearMapEntityLinks(map, removed));
    return validateWorkspace(stamped);
  }
  const next = structuredClone(before);
  if (submitted.worlds.length !== projected.worlds.length)
    throw new PermissionError('当前账户不能增删世界。');
  for (const world of submitted.worlds) {
    const old = projected.worlds.find((w) => w.id === world.id);
    if (!old) throw new PermissionError('当前账户不能增删世界。');
    const { entityTypes: _types, entityTemplates: _templates, ...core } = world;
    const { entityTypes: _oldTypes, entityTemplates: _oldTemplates, ...oldCore } = old;
    if (!isDeepStrictEqual(core, oldCore)) throw new PermissionError('当前账户不能修改世界资料。');
    if (!isDeepStrictEqual(world, old)) {
      requireAdministrator(actor);
      next.worlds = next.worlds.map((w) =>
        w.id === world.id
          ? { ...w, entityTypes: world.entityTypes, entityTemplates: world.entityTemplates }
          : w,
      );
    }
  }
  for (const collection of collections) {
    const originals = before[collection] as Workspace[typeof collection][number][];
    const shown = projected[collection] as typeof originals;
    const incoming = submitted[collection] as typeof originals;
    const result = [] as typeof originals;
    for (const original of originals) {
      const visible = shown.find((r) => r.id === original.id);
      const input = incoming.find((r) => r.id === original.id);
      if (!visible) {
        if (input) throw new PermissionError('不能修改未获准查看的内容。');
        result.push(original);
        continue;
      }
      if (!input) {
        if (!canChange(actor, recordModule(collection, original), original, 'delete'))
          throw new PermissionError('没有删除此条目的权限。');
        continue;
      }
      if (input.createdBy !== original.createdBy)
        throw new PermissionError('不能修改条目的作者归属。');
      if (input.worldId !== original.worldId)
        throw new PermissionError('不能通过移动条目绕过世界权限。');
      if (isDeepStrictEqual(input, visible)) {
        result.push(original);
        continue;
      }
      if (!canChange(actor, recordModule(collection, original), original, 'update'))
        throw new PermissionError('没有修改此条目的权限。');
      if (
        collection === 'entities' &&
        (input as Entity).type !== (original as Entity).type &&
        !canCreate(actor, recordModule(collection, input))
      )
        throw new PermissionError();
      let restored = restoreUnchanged(original, visible, input);
      if (collection === 'entities') {
        const old = original as Entity,
          shown = visible as Entity,
          edited = restored as Entity;
        edited.attributes = Object.fromEntries(
          Object.entries(edited.attributes).map(([key, value]) => [
            key,
            value === shown.attributes[key] ? (old.attributes[key] ?? value) : value,
          ]),
        );
      }
      if (collection === 'plots') {
        const old = original as Plot,
          shown = visible as Plot,
          edited = restored as Plot;
        const visibleEntities = new Set(projected.entities.map((e) => e.id));
        edited.nodes = edited.nodes.map((node) => {
          const originalNode = old.nodes.find((n) => n.id === node.id),
            visibleNode = shown.nodes.find((n) => n.id === node.id);
          if (!originalNode || !visibleNode) return node;
          const preserved = restoreUnchanged(originalNode, visibleNode, node);
          return {
            ...preserved,
            entityIds: [
              ...new Set([
                ...preserved.entityIds,
                ...originalNode.entityIds.filter((id) => !visibleEntities.has(id)),
              ]),
            ],
          };
        });
      }
      if (collection === 'maps' && actor.role === 'user')
        restored = preserveHiddenMapParts(
          original as AtlasMap,
          visible as AtlasMap,
          restored as AtlasMap,
        );
      result.push(restored);
    }
    for (const input of incoming.filter((r) => !originals.some((o) => o.id === r.id))) {
      if (!canCreate(actor, recordModule(collection, input)))
        throw new PermissionError('没有在此模块创建内容的权限。');
      if (input.createdBy && input.createdBy !== actor.id)
        throw new PermissionError('不能伪造条目的作者归属。');
      result.push({ ...input, createdBy: actor.id });
    }
    // Collections have different record types; each record was checked against its own module above.
    (next[collection] as typeof originals) = result;
  }
  // Full validation protects links to retained private records and prevents destructive dangling references.
  if (actor.role === 'user') {
    const accessible = visibleWorkspace(next, actor);
    const entityIds = new Set(accessible.entities.map((e) => e.id));
    const mapIds = new Set(accessible.maps.map((m) => m.id));
    const variableNames = new Set(accessible.variables.map((v) => `${v.worldId}\0${v.name}`));
    const removedIds = new Set(
      before.entities.filter((e) => !next.entities.some((v) => v.id === e.id)).map((e) => e.id),
    );
    const oldVariableNames = new Set(
      before.variables
        .filter((v) => !next.variables.some((n) => n.id === v.id && n.name === v.name))
        .map((v) => `${v.worldId}\0${v.name}`),
    );
    for (const entity of submitted.entities) {
      const old = before.entities.find((e) => e.id === entity.id);
      if (
        old &&
        isDeepStrictEqual(
          entity,
          projected.entities.find((e) => e.id === entity.id),
        )
      )
        continue;
      const texts = [entity.summary, entity.content, ...Object.values(entity.attributes)];
      const oldTexts = old
        ? [old.summary, old.content, ...Object.values(old.attributes)].join('\n')
        : '';
      for (const text of texts)
        for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
          const target = next.entities.find(
            (e) => e.worldId === entity.worldId && e.name === match[1].trim(),
          );
          if (target && !entityIds.has(target.id) && !oldTexts.includes(match[0]))
            throw new PermissionError('不能关联尚未获准查看的条目。');
        }
    }
    for (const map of submitted.maps) {
      const old = before.maps.find((m) => m.id === map.id);
      const oldTexts = old ? mapTexts(old).join('\n') : '';
      for (const text of mapTexts(map))
        for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
          const target = next.entities.find(
            (entity) => entity.worldId === map.worldId && entity.name === match[1].trim(),
          );
          if (target && !entityIds.has(target.id) && !oldTexts.includes(match[0]))
            throw new PermissionError('不能关联尚未获准查看的地图条目。');
        }
      for (const pin of map.pins) {
        const oldPin = old?.pins.find((p) => p.id === pin.id);
        if (pin.entityId && !entityIds.has(pin.entityId) && pin.entityId !== oldPin?.entityId)
          throw new PermissionError();
        if (pin.childMapId && !mapIds.has(pin.childMapId) && pin.childMapId !== oldPin?.childMapId)
          throw new PermissionError();
      }
      if (map.parentId && !mapIds.has(map.parentId) && map.parentId !== old?.parentId)
        throw new PermissionError();
      for (const division of map.editor?.divisions ?? [])
        if (
          division.entityId &&
          !entityIds.has(division.entityId) &&
          division.entityId !== old?.editor?.divisions?.find((d) => d.id === division.id)?.entityId
        )
          throw new PermissionError();
      if (map.editor?.generation?.version === 2)
        for (const [siteId, entityId] of Object.entries(
          map.editor.generation.settlementLinks ?? {},
        ))
          if (
            !entityIds.has(entityId) &&
            (old?.editor?.generation?.version !== 2 ||
              old.editor.generation.settlementLinks?.[siteId] !== entityId)
          )
            throw new PermissionError('不能关联尚未获准查看的地图条目。');
      for (const site of map.editor?.generated?.sites ?? [])
        if (
          site.entityId &&
          !entityIds.has(site.entityId) &&
          old?.editor?.generated?.sites?.find((previous) => previous.id === site.id)?.entityId !==
            site.entityId
        )
          throw new PermissionError('不能关联尚未获准查看的地图条目。');
      for (const key of ['areas', 'divisions', 'ports'] as const)
        for (const item of map.editor?.generated?.geography?.[key] ?? []) {
          const previous = old?.editor?.generated?.geography?.[key].find((v) => v.id === item.id);
          if (
            item.entityId &&
            !entityIds.has(item.entityId) &&
            item.entityId !== previous?.entityId
          )
            throw new PermissionError('不能关联尚未获准查看的地图条目。');
        }
    }
    for (const relation of submitted.relations)
      if (
        (!entityIds.has(relation.sourceId) && !removedIds.has(relation.sourceId)) ||
        (!entityIds.has(relation.targetId) && !removedIds.has(relation.targetId))
      )
        throw new PermissionError();
    for (const plot of submitted.plots)
      for (const node of plot.nodes) {
        if (node.entityIds.some((id) => !entityIds.has(id) && !removedIds.has(id)))
          throw new PermissionError();
        if (
          [...node.conditions, ...node.effects].some(
            (v) =>
              !variableNames.has(`${plot.worldId}\0${v.variable}`) &&
              !oldVariableNames.has(`${plot.worldId}\0${v.variable}`),
          )
        )
          throw new PermissionError('不能引用尚未获准查看的世界变量。');
      }
  }
  let linked = next;
  const variableChanges = new Map(
    before.variables
      .filter((v) => !next.variables.some((n) => n.id === v.id && n.name === v.name))
      .map((v) => [`${v.worldId}\0${v.name}`, next.variables.find((n) => n.id === v.id)?.name]),
  );
  if (variableChanges.size) {
    if (
      actor.role === 'user' &&
      before.plots.some(
        (p) =>
          p.nodes.some((n) =>
            [...n.conditions, ...n.effects].some(
              (r) =>
                variableChanges.has(`${p.worldId}\0${r.variable}`) &&
                !variableChanges.get(`${p.worldId}\0${r.variable}`),
            ),
          ) && !canChange(actor, 'plots', p, 'update'),
      )
    )
      throw new PermissionError('此变量仍被没有修改权限的剧情引用，请由管理员先整理关联。');
    const remap = <T extends { variable: string }>(rules: T[], worldId: string) =>
      rules
        .filter(
          (r) =>
            !variableChanges.has(`${worldId}\0${r.variable}`) ||
            variableChanges.get(`${worldId}\0${r.variable}`),
        )
        .map((r) => ({
          ...r,
          variable: variableChanges.get(`${worldId}\0${r.variable}`) ?? r.variable,
        }));
    linked = {
      ...linked,
      plots: linked.plots.map((p) => ({
        ...p,
        nodes: p.nodes.map((n) => ({
          ...n,
          conditions: remap(n.conditions, p.worldId),
          effects: remap(n.effects, p.worldId),
        })),
      })),
    };
  }
  // Updating a name is an authorized edit of that record. The server maintains
  // references mechanically, including hidden records, without exposing them or
  // granting the author permission to edit their other content.
  for (const entity of next.entities) {
    const old = before.entities.find((e) => e.id === entity.id);
    if (old && old.name !== entity.name)
      linked = saveEntityInWorkspace(
        {
          ...linked,
          entities: linked.entities.map((e) =>
            e.id === old.id ? { ...entity, name: old.name } : e,
          ),
        },
        entity,
      );
  }
  const entityIds = new Set(linked.entities.map((e) => e.id));
  const deleted = new Set(before.entities.filter((e) => !entityIds.has(e.id)).map((e) => e.id));
  if (actor.role === 'user' && deleted.size) {
    const protectedRelation = before.relations.some(
      (r) =>
        (deleted.has(r.sourceId) || deleted.has(r.targetId)) &&
        !canChange(actor, 'relations', r, 'delete'),
    );
    const protectedMap = before.maps.some(
      (m) =>
        (m.pins.some((p) => p.entityId && deleted.has(p.entityId)) ||
          m.editor?.divisions?.some((d) => d.entityId && deleted.has(d.entityId)) ||
          (m.editor?.generation?.version === 2 &&
            Object.values(m.editor.generation.settlementLinks ?? {}).some((id) =>
              deleted.has(id),
            )) ||
          m.editor?.generated?.sites?.some((site) => site.entityId && deleted.has(site.entityId)) ||
          m.editor?.generated?.geography?.divisions.some(
            (d) => d.entityId && deleted.has(d.entityId),
          ) ||
          m.editor?.generated?.geography?.areas.some(
            (area) => area.entityId && deleted.has(area.entityId),
          ) ||
          m.editor?.generated?.geography?.ports.some(
            (port) => port.entityId && deleted.has(port.entityId),
          )) &&
        !canChange(actor, 'maps', m, 'update'),
    );
    const protectedPlot = before.plots.some(
      (p) =>
        p.nodes.some((n) => n.entityIds.some((id) => deleted.has(id))) &&
        !canChange(actor, 'plots', p, 'update'),
    );
    if (protectedRelation || protectedMap || protectedPlot)
      throw new PermissionError('此条目仍被没有修改权限的内容引用，请由管理员先整理关联。');
  }
  if (deleted.size)
    linked = {
      ...linked,
      relations: linked.relations.filter(
        (r) => !deleted.has(r.sourceId) && !deleted.has(r.targetId),
      ),
      maps: linked.maps.map((m) => ({
        ...m,
        pins: m.pins.map((p) =>
          p.entityId && deleted.has(p.entityId) ? { ...p, entityId: undefined } : p,
        ),
        ...(m.editor
          ? {
              editor: {
                ...m.editor,
                divisions: m.editor.divisions?.map((d) =>
                  d.entityId && deleted.has(d.entityId) ? { ...d, entityId: undefined } : d,
                ),
                ...(m.editor.generation?.version === 2
                  ? {
                      generation: {
                        ...m.editor.generation,
                        ...(m.editor.generation.settlementLinks
                          ? {
                              settlementLinks: Object.fromEntries(
                                Object.entries(m.editor.generation.settlementLinks).filter(
                                  ([, value]) => !deleted.has(value),
                                ),
                              ),
                            }
                          : {}),
                      },
                    }
                  : {}),
                ...(m.editor.generated
                  ? {
                      generated: {
                        ...m.editor.generated,
                        sites: m.editor.generated.sites?.map((site) =>
                          site.entityId && deleted.has(site.entityId)
                            ? { ...site, entityId: undefined }
                            : site,
                        ),
                        ...(m.editor.generated.geography
                          ? {
                              geography: {
                                ...m.editor.generated.geography,
                                divisions: m.editor.generated.geography.divisions.map((d) =>
                                  d.entityId && deleted.has(d.entityId)
                                    ? { ...d, entityId: undefined }
                                    : d,
                                ),
                                areas: m.editor.generated.geography.areas.map((area) =>
                                  area.entityId && deleted.has(area.entityId)
                                    ? { ...area, entityId: undefined }
                                    : area,
                                ),
                                ports: m.editor.generated.geography.ports.map((port) =>
                                  port.entityId && deleted.has(port.entityId)
                                    ? { ...port, entityId: undefined }
                                    : port,
                                ),
                              },
                            }
                          : {}),
                      },
                    }
                  : {}),
              },
            }
          : {}),
      })),
      plots: linked.plots.map((p) => ({
        ...p,
        nodes: p.nodes.map((n) => ({
          ...n,
          entityIds: n.entityIds.filter((id) => !deleted.has(id)),
        })),
      })),
    };
  return validateWorkspace(linked);
}

export function workspaceImages(data: Workspace): Set<string> {
  return new Set(
    [
      ...data.entities.flatMap((e) => [e.portrait, e.cover]),
      ...data.maps.flatMap((m) =>
        [...(m.editor?.objects ?? []), ...(m.editor?.generated?.objects ?? [])].map(
          (o) => o.imageUrl,
        ),
      ),
    ].filter((url): url is string => Boolean(url?.startsWith('/uploads/'))),
  );
}
