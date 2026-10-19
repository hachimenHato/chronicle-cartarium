import type { AtlasMap, Entity, Workspace } from './model';

/** Detach deleted pages from authored and generated map metadata without changing geography. */
export function clearMapEntityLinks(map: AtlasMap, deleted: ReadonlySet<string>): AtlasMap {
  const unlinked = <T extends { entityId?: string }>(item: T): T =>
    item.entityId && deleted.has(item.entityId) ? { ...item, entityId: undefined } : item;
  const editor = map.editor;
  const snapshot = editor?.generated;
  const recipe = editor?.generation;
  return {
    ...map,
    pins: map.pins.map(unlinked),
    ...(editor
      ? {
          editor: {
            ...editor,
            divisions: editor.divisions?.map(unlinked),
            ...(recipe?.version === 2 && recipe.settlementLinks
              ? {
                  generation: {
                    ...recipe,
                    settlementLinks: Object.fromEntries(
                      Object.entries(recipe.settlementLinks).filter(
                        ([, value]) => !deleted.has(value),
                      ),
                    ),
                  },
                }
              : {}),
            ...(snapshot
              ? {
                  generated: {
                    ...snapshot,
                    sites: snapshot.sites?.map(unlinked),
                    ...(snapshot.geography
                      ? {
                          geography: {
                            ...snapshot.geography,
                            divisions: snapshot.geography.divisions.map(unlinked),
                            areas: snapshot.geography.areas.map(unlinked),
                            ports: snapshot.geography.ports.map(unlinked),
                          },
                        }
                      : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}

/** Upsert a page and keep name-based wiki references inside its world consistent. */
export function saveEntityInWorkspace(data: Workspace, entity: Entity): Workspace {
  const previous = data.entities.find((item) => item.id === entity.id);
  const entities = previous
    ? data.entities.map((item) => (item.id === entity.id ? entity : item))
    : [...data.entities, entity];

  if (!previous || previous.name === entity.name || previous.worldId !== entity.worldId) {
    return { ...data, entities };
  }

  const rename = (text: string): string =>
    text.replace(/\[\[([^\]]+)\]\]/g, (reference: string, name: string) =>
      name.trim() === previous.name ? `[[${entity.name}]]` : reference,
    );

  return {
    ...data,
    worlds: data.worlds.map((world) =>
      world.id === entity.worldId ? { ...world, description: rename(world.description) } : world,
    ),
    entities: entities.map((item) =>
      item.worldId === entity.worldId
        ? {
            ...item,
            summary: rename(item.summary),
            content: rename(item.content),
            attributes: Object.fromEntries(
              Object.entries(item.attributes).map(([key, value]) => [key, rename(value)]),
            ),
          }
        : item,
    ),
    maps: data.maps
      .map((map) =>
        map.worldId === entity.worldId
          ? {
              ...map,
              name: rename(map.name),
              summary: rename(map.summary),
              pins: map.pins.map((pin) => ({
                ...pin,
                label: rename(pin.label),
                description: rename(pin.description),
              })),
              ...(map.editor
                ? {
                    editor: {
                      ...map.editor,
                      ...(map.editor.divisions
                        ? {
                            divisions: map.editor.divisions.map((d) => ({
                              ...d,
                              name:
                                d.entityId === entity.id && d.name === previous.name
                                  ? entity.name
                                  : rename(d.name),
                            })),
                          }
                        : {}),
                      regions: map.editor.regions.map((region) => ({
                        ...region,
                        name: rename(region.name),
                      })),
                      objects: map.editor.objects.map((object) => ({
                        ...object,
                        name: rename(object.name),
                        text: rename(object.text),
                      })),
                      ...(map.editor.military
                        ? {
                            military: map.editor.military.map((line) => ({
                              ...line,
                              name: rename(line.name),
                            })),
                          }
                        : {}),
                      ...(map.editor.generation?.version === 2 &&
                      map.editor.generation.settlementNames
                        ? {
                            generation: {
                              ...map.editor.generation,
                              settlementNames: Object.fromEntries(
                                Object.entries(map.editor.generation.settlementNames).map(
                                  ([key, value]) => [key, rename(value)],
                                ),
                              ),
                            },
                          }
                        : {}),
                      ...(map.editor.generated
                        ? {
                            generated: {
                              ...map.editor.generated,
                              objects: map.editor.generated.objects.map((object) => ({
                                ...object,
                                name: rename(object.name),
                                text: rename(object.text),
                              })),
                              ...(map.editor.generated.sites
                                ? {
                                    sites: map.editor.generated.sites.map((site) => ({
                                      ...site,
                                      name: rename(site.name),
                                    })),
                                  }
                                : {}),
                              ...(map.editor.generated.geography
                                ? {
                                    geography: {
                                      ...map.editor.generated.geography,
                                      divisions: map.editor.generated.geography.divisions.map(
                                        (d) => ({
                                          ...d,
                                          name:
                                            d.entityId === entity.id && d.name === previous.name
                                              ? entity.name
                                              : rename(d.name),
                                        }),
                                      ),
                                      areas: map.editor.generated.geography.areas.map((area) => ({
                                        ...area,
                                        name:
                                          area.entityId === entity.id && area.name === previous.name
                                            ? entity.name
                                            : rename(area.name),
                                      })),
                                      plates: map.editor.generated.geography.plates.map(
                                        (plate) => ({
                                          ...plate,
                                          name: rename(plate.name),
                                        }),
                                      ),
                                      ports: map.editor.generated.geography.ports.map((port) => ({
                                        ...port,
                                        name:
                                          port.entityId === entity.id && port.name === previous.name
                                            ? entity.name
                                            : rename(port.name),
                                      })),
                                      seaRoutes: map.editor.generated.geography.seaRoutes.map(
                                        (route) => ({ ...route, name: rename(route.name) }),
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
            }
          : map,
      )
      .map((map) => {
        const original = data.maps.find((item) => item.id === map.id);
        const oldRecipe = original?.editor?.generation;
        const recipe = map.editor?.generation;
        if (map.worldId !== entity.worldId || !map.editor || recipe?.version !== 2) return map;
        const renamedIds = new Set(
          (original?.editor?.generated?.sites ?? [])
            .filter(
              (site) =>
                (site.entityId ??
                  (oldRecipe?.version === 2 ? oldRecipe.settlementLinks?.[site.id] : undefined)) ===
                  entity.id && site.name === previous.name,
            )
            .map((site) => site.id),
        );
        for (const [id, name] of Object.entries(
          oldRecipe?.version === 2 ? (oldRecipe.settlementNames ?? {}) : {},
        ))
          if (
            oldRecipe?.version === 2 &&
            oldRecipe.settlementLinks?.[id] === entity.id &&
            name === previous.name
          )
            renamedIds.add(id);
        if (!renamedIds.size) return map;
        const snapshot = map.editor.generated;
        return {
          ...map,
          editor: {
            ...map.editor,
            generation: {
              ...recipe,
              settlementNames: {
                ...recipe.settlementNames,
                ...Object.fromEntries([...renamedIds].map((id) => [id, entity.name])),
              },
            },
            ...(snapshot
              ? {
                  generated: {
                    ...snapshot,
                    sites: snapshot.sites?.map((site) =>
                      renamedIds.has(site.id) ? { ...site, name: entity.name } : site,
                    ),
                    objects: snapshot.objects.map((object) => {
                      const label = /^聚落 (\d+) · 名称$/.exec(object.name);
                      const site = label && snapshot.sites?.[Number(label[1]) - 1];
                      return site && renamedIds.has(site.id) && object.text === previous.name
                        ? { ...object, text: entity.name }
                        : object;
                    }),
                  },
                }
              : {}),
          },
        };
      }),
    relations: data.relations.map((relation) =>
      relation.worldId === entity.worldId
        ? { ...relation, description: rename(relation.description) }
        : relation,
    ),
    plots: data.plots.map((plot) =>
      plot.worldId === entity.worldId
        ? {
            ...plot,
            summary: rename(plot.summary),
            nodes: plot.nodes.map((node) => ({ ...node, summary: rename(node.summary) })),
          }
        : plot,
    ),
    sessions: data.sessions.map((session) =>
      session.worldId === entity.worldId
        ? { ...session, content: rename(session.content) }
        : session,
    ),
  };
}
