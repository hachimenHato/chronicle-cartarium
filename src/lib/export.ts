import { entityLabels, type Workspace } from '../../shared/model';
import { biomeCatalog, symbolCatalog, generationDetailCatalog } from '../../shared/cartography';
import { divisionLabels } from '../../shared/cartography';
import { formatDistance, mapCoverageKm } from './map-scale';
import { entityAttributeEntries } from '../../shared/entity-templates';
import { getEntityTypeLabel, getEntityTypes } from '../../shared/entity-types';
import { settlementCatalog, type SettlementKind } from '../../shared/cartography';
import { militaryLineLabels } from '../../shared/generated-map';
import { renameSettlementArtwork } from './settlement-names';
import { featureHidden, mapFeatures } from '../../shared/map-features';
export interface ExportOptions {
  worldId: string;
  entityIds: string[];
  includeMaps: boolean;
  includeRelations: boolean;
  includePlots: boolean;
  includeSessions: boolean;
  includeSecrets: boolean;
}
export function exportMarkdown(data: Workspace, options: ExportOptions): string {
  const world = data.worlds.find((w) => w.id === options.worldId);
  if (!world) throw new Error('世界不存在');
  const worldEntities = data.entities.filter((e) => e.worldId === world.id);
  const entities = worldEntities.filter(
    (e) =>
      options.entityIds.includes(e.id) && (options.includeSecrets || e.visibility === 'public'),
  );
  const permitted = new Set(entities.map((e) => e.id));
  const visibleLink = (id?: string) =>
    !id ||
    options.includeSecrets ||
    worldEntities.find((entity) => entity.id === id)?.visibility === 'public';
  const renderLink = (id?: string) => {
    const entity = worldEntities.find((item) => item.id === id);
    return entity && visibleLink(id)
      ? permitted.has(entity.id)
        ? `[${entity.name}](#${entity.id})`
        : entity.name
      : '';
  };
  const secretNames = new Set(
    worldEntities.filter((e) => e.visibility === 'gm').map((e) => e.name),
  );
  const render = (text: string) =>
    text.replace(/\[\[([^\]]+)\]\]/g, (_, name: string) => {
      name = name.trim();
      if (!options.includeSecrets && secretNames.has(name)) return '〔未公开条目〕';
      const e = entities.find((item) => item.name === name);
      return e ? `[${name}](#${e.id})` : name;
    });
  const mapName = (id?: string) => {
    const target = data.maps.find((map) => map.id === id);
    return !target
      ? '无'
      : options.includeSecrets || target.visibility === 'public'
        ? render(target.name)
        : '〔未公开地图〕';
  };
  const out = [
    `# ${world.name} · ${world.subtitle}`,
    render(world.description),
    `> 规则：${world.system}  \n> 导出范围：${options.includeSecrets ? 'GM 完整资料' : '玩家资料（排除 GM 条目与剧情、日志）'}  \n> 导出时间：${new Date().toISOString()}`,
    '## 目录',
    ...entities.map((e) => `- [${e.name}](#${e.id})`),
    '',
  ];
  if (world.entityTypes)
    out.push(
      '## 设定类型',
      ...getEntityTypes(world).map((t) => `- **${t.name}**：${t.description || '自定义设定类型'}`),
    );
  if (options.includeSecrets && world.entityTemplates) {
    const types = new Set(entities.map((entity) => entity.type));
    const templates = Object.entries(world.entityTemplates).filter(([type]) =>
      types.has(type as keyof typeof entityLabels),
    );
    if (templates.length) {
      out.push('## 自定义字段模板');
      for (const [type, fields = []] of templates)
        out.push(
          `### ${getEntityTypeLabel(world, type as keyof typeof entityLabels)}`,
          fields.length ? fields.map((name) => `- ${name}`).join('\n') : '此类没有通用字段。',
        );
    }
  }
  for (const e of entities) {
    out.push(
      `<a id="${e.id}"></a>`,
      `## ${e.name}`,
      `> ${getEntityTypeLabel(world, e.type)} · ${e.visibility === 'gm' ? 'GM 秘密' : '公开'} · ${e.status === 'draft' ? '草稿' : '已完善'}`,
      render(e.summary),
    );
    if (e.portrait) out.push(`![${e.name}立绘](${e.portrait})`);
    if (e.cover) out.push(`![${e.name}封面](${e.cover})`);
    if (e.tags.length) out.push(`标签：${e.tags.join(' / ')}`);
    for (const [key, value] of entityAttributeEntries(e, world)) {
      if (value) out.push(`### ${key}`, render(value));
    }
    out.push(render(e.content), '---');
  }
  if (options.includeMaps) {
    out.push('## 地图集');
    for (const map of data.maps.filter(
      (m) => m.worldId === world.id && (options.includeSecrets || m.visibility === 'public'),
    )) {
      out.push(
        `### ${render(map.name)}`,
        render(map.summary),
        `- 类型：${map.kind}；随机种子：${map.seed}；画布：${map.width} × ${map.height}`,
        `- 上级地图：${mapName(map.parentId)}`,
        `- 地理范围：${formatDistance(mapCoverageKm(map))} × ${formatDistance((mapCoverageKm(map) * map.height) / map.width)}${map.scaleKm === undefined ? '（旧地图按类型估算，尚未设定实际范围）' : ''}`,
      );
      if (map.editor) {
        for (const division of map.editor.divisions ?? []) {
          const linked = worldEntities.find((e) => e.id === division.entityId);
          if (!options.includeSecrets && linked?.visibility === 'gm') continue;
          const strokes = (map.editor.divisionPaint ?? []).filter(
            (s) => s.divisionId === division.id,
          );
          out.push(
            `- ${divisionLabels[division.kind]}分区 **${render(division.name)}**：${linked && permitted.has(linked.id) ? `[${linked.name}](#${linked.id})` : linked ? linked.name : '未关联条目'}；颜色 ${division.color}；边界编辑 ${strokes.length} 笔${division.visible ? '' : '；已隐藏'}。`,
            '- 分区边界与有序涂抹/擦除坐标保存在 JSON 备份中；同类分区后画者占据重叠区域，三类分区独立。',
          );
        }
        const modeLabels = { sketch: '快速生成', sculpt: '智能塑形', detail: '精细编辑' };
        out.push(
          `- 绘图级别：${modeLabels[map.editor.mode]}；随机底图：${map.editor.baseVisible ? '显示' : '隐藏'}`,
          `- 地形区域：${map.editor.regions.length}；独立组件：${map.editor.objects.length}`,
        );
        if (map.editor.generation) {
          const recipe = map.editor.generation;
          const climates = { temperate: '温带', dry: '干燥', cold: '寒冷' };
          out.push(
            `- ${recipe.version === 2 && recipe.geography?.source === 'random' ? '完全随机生成' : '色块生成'}：版本 ${recipe.version}；种子 ${recipe.seed}；气候 ${climates[recipe.climate]}；聚落上限 ${recipe.version === 2 && recipe.settlementCounts ? Object.values(recipe.settlementCounts).reduce((sum, count) => sum + count, 0) : recipe.settlements}；水系${recipe.rivers ? '开启' : '关闭'}；道路${recipe.routes ? '开启' : '关闭'}`,
            map.editor.generated
              ? '- 当前地形、水系与聚落来自已保存的生成快照，打开地图不会重新生成；JSON 备份同时保留配方、快照和手工编辑，SVG 导出保留当前画面。'
              : '- 自动地形、水系与聚落由原始区域和上述参数派生；JSON 备份保留完整配方，SVG 导出保留当前画面。',
          );
          if (recipe.version === 2) {
            if (recipe.settlementCounts)
              out.push(
                `- 聚落类型数量上限：${Object.entries(recipe.settlementCounts)
                  .map(
                    ([kind, count]) =>
                      `${settlementCatalog[kind as SettlementKind].label} ${count}`,
                  )
                  .join('；')}。`,
              );
            if (recipe.settlementNames && Object.keys(recipe.settlementNames).length)
              out.push(
                '- 聚落自定义名称（类型与序号；实际选址取决于生成结果）：',
                ...Object.entries(recipe.settlementNames)
                  .filter(([id]) =>
                    visibleLink(
                      recipe.settlementLinks?.[id] ??
                        map.editor?.generated?.sites?.find((site) => site.id === id)?.entityId,
                    ),
                  )
                  .map(([id, name]) => {
                    const [kind, index] = id.split('_');
                    return `  - ${settlementCatalog[kind as SettlementKind].label} ${Number(index) + 1}：${render(name)}`;
                  }),
              );
            const detail = generationDetailCatalog.find((item) => item.id === recipe.detail)!;
            out.push(
              `- 地形采样：${detail.label}（长边目标 ${map.scaleKm === undefined ? detail.samples : Math.round(Math.min(512, detail.samples * Math.max(1, Math.sqrt(Math.max(map.width, map.height) / 1000))))} 格，复杂笔迹可能降低）；SVG 为矢量图，采样精度不等同于图片像素尺寸。`,
              `- 河路形态：${recipe.linework === 'organic' ? '柔和曲线' : '原版线形'}。`,
            );
            if (recipe.elevation) {
              const height = recipe.elevation;
              const presets = {
                sketch: '依照色块',
                continent: '大陆',
                archipelago: '群岛',
                highlands: '高地',
              };
              const operations = { raise: '抬高', lower: '降低', flatten: '整平', smooth: '平滑' };
              out.push(
                `- 海拔地形：版本 ${height.version}；基础地貌 ${presets[height.preset]}；种子 ${height.seed}；起伏 ${height.relief} 倍；海平面 ${height.seaLevel} 米；编辑 ${height.strokes.length} 笔。`,
                '- 高程以米计，编辑按下列顺序重放；完整笔迹坐标保存在 JSON 备份中。',
              );
              for (const [index, stroke] of height.strokes.entries()) {
                const start = stroke.points[0];
                const end = stroke.points.at(-1)!;
                const position = (p: typeof start) => `(${Math.round(p.x)}, ${Math.round(p.y)})`;
                out.push(
                  `- 海拔编辑 ${index + 1}：${operations[stroke.operation]}；笔刷直径 ${stroke.width} 地图单位；强度 ${Math.round(stroke.strength * 100)}%${stroke.operation === 'flatten' ? `；目标海拔 ${stroke.target} 米` : ''}；${stroke.points.length} 个控制点，${position(start)} → ${position(end)}。`,
                );
              }
            }
          }
        }
        const snapshot = map.editor.generated;
        if (snapshot) {
          const snapshotSites =
            map.editor.generation?.version === 2
              ? renameSettlementArtwork([], snapshot.sites, map.editor.generation).sites
              : snapshot.sites;
          out.push(
            `- 已保存生成快照：版本 ${snapshot.version}；签名 ${snapshot.signature}；生成组件 ${snapshot.objects.length} 个。`,
            '- 下列地理图层来自同一次确定性生成；气候与板块为简化的制图模型，不代表完整物理模拟。',
          );
          if (snapshot.stats)
            out.push(
              `- 自动布局：陆地采样 ${snapshot.stats.landCells}；河道 ${snapshot.stats.rivers}；聚落 ${snapshot.stats.settlements}；道路 ${snapshot.stats.roads}。`,
            );
          if (snapshot.elevation)
            out.push(
              `- 高程图层：${snapshot.elevation.columns} × ${snapshot.elevation.rows}；最低 ${Math.round(snapshot.elevation.min)} 米，最高 ${Math.round(snapshot.elevation.max)} 米。`,
            );
          for (const site of snapshotSites ?? []) {
            if (!visibleLink(site.entityId)) continue;
            out.push(
              `- 已生成${settlementCatalog[site.kind].label} **${render(site.name)}**：(${Math.round(site.x)}, ${Math.round(site.y)})${site.entityId ? `；关联 ${renderLink(site.entityId)}` : '；尚未关联设定条目'}${featureHidden(map, 'settlements', site.id) ? '；地图中已隐藏' : ''}。`,
            );
          }
          const geo = snapshot.geography;
          if (geo) {
            const temperatures = geo.cells.map((cell) => cell.temperature);
            const rain = geo.cells.map((cell) => cell.precipitation);
            const land = geo.cells.filter((cell) => cell.land);
            out.push(
              `- 共享区域图层：${geo.cells.length} 个地理单元，其中陆地 ${land.length} 个，大陆架 ${geo.cells.filter((cell) => cell.shelf).length} 个。`,
              `- 气温图层：年均气温 ${Math.min(...temperatures).toFixed(1)}～${Math.max(...temperatures).toFixed(1)} ℃；降水图层：年降水 ${Math.round(Math.min(...rain))}～${Math.round(Math.max(...rain))} 毫米。`,
              `- 陆地生物群系：${
                biomeCatalog
                  .map((biome) => {
                    const count = land.filter((cell) => cell.biome === biome.id).length;
                    return count ? `${biome.label} ${count} 单元` : '';
                  })
                  .filter(Boolean)
                  .join('；') || '无陆地'
              }。`,
            );
            const settings =
              map.editor.generation?.version === 2 ? map.editor.generation.geography : undefined;
            if (settings)
              out.push(
                `- 地理生成参数：纬度 ${settings.latitudeNorth}°～${settings.latitudeSouth}°；经度 ${settings.longitudeWest ?? -180}°～${settings.longitudeEast ?? 180}°${(settings.longitudeWest ?? -180) > (settings.longitudeEast ?? 180) ? '（跨日期变更线）' : ''}；赤道海平面年均气温 ${settings.meanSeaTemperature} ℃；降水系数 ${settings.rainfall}；主导风向 ${settings.windAngle}°；边缘破碎度 ${settings.roughness}；区域密度 ${settings.regionDensity}。`,
                ...(settings.source === 'sketch'
                  ? [
                      `- 色块轮廓策略：${{ randomized: 'A 最大随机（仅参考相对位置与面积）', balanced: 'B 平衡生成（部分参考轮廓）', strict: 'C 严格保形（保留采样轮廓）' }[settings.sketchMode ?? 'balanced']}。`,
                    ]
                  : []),
              );
            for (const plate of geo.plates)
              out.push(
                `- 板块 **${render(plate.name)}**：${plate.kind === 'continental' ? '大陆板块' : '海洋板块'}；运动向量 (${plate.velocity.x.toFixed(2)}, ${plate.velocity.y.toFixed(2)})。`,
              );
            const areaLabels = {
              continent: '大陆',
              island: '岛屿',
              ocean: '海洋',
              lake: '湖泊',
              province: '地区',
              district: '街区',
            };
            for (const area of geo.areas) {
              const linked = worldEntities.find((entity) => entity.id === area.entityId);
              if (!options.includeSecrets && linked?.visibility === 'gm') continue;
              out.push(
                `- ${areaLabels[area.kind]} **${render(area.name)}**：${area.cells.length} 个地理单元；中心 (${Math.round(area.center.x)}, ${Math.round(area.center.y)})${linked ? `；关联 ${permitted.has(linked.id) ? `[${linked.name}](#${linked.id})` : linked.name}` : ''}。`,
              );
            }
            for (const division of geo.divisions) {
              const linked = worldEntities.find((entity) => entity.id === division.entityId);
              if (!options.includeSecrets && linked?.visibility === 'gm') continue;
              const count = geo.cells.filter((cell) => cell[division.kind] === division.id).length;
              out.push(
                `- 自动${divisionLabels[division.kind]} **${render(division.name)}**：${count} 个陆地单元；颜色 ${division.color}${linked ? `；关联 ${permitted.has(linked.id) ? `[${linked.name}](#${linked.id})` : linked.name}` : '；尚未关联设定条目'}。`,
              );
            }
            out.push(
              '- 国界、文化与信仰边界沿共享区域边缘划分；完整多边形、邻接、高程及气候数据保存在 JSON 档案中。',
            );
            const publicPorts = new Set(
              geo.ports
                .filter((port) =>
                  visibleLink(
                    port.entityId ??
                      snapshotSites?.find((site) => site.id === port.settlementId)?.entityId,
                  ),
                )
                .map((port) => port.id),
            );
            for (const port of geo.ports) {
              if (!publicPorts.has(port.id)) continue;
              const site = snapshotSites?.find((item) => item.id === port.settlementId);
              const entityId = port.entityId ?? site?.entityId;
              out.push(
                `- 港口 **${render(port.name)}**：${port.settlementId ? `关联聚落 ${render(site?.name ?? port.settlementId)}` : '独立沿海港口'}${entityId ? `；关联档案 ${renderLink(entityId)}` : ''}；港口位置 (${Math.round(port.center.x)}, ${Math.round(port.center.y)})${featureHidden(map, 'ports', port.id) ? '；地图中已隐藏' : ''}。`,
              );
            }
            for (const route of geo.seaRoutes) {
              if (!publicPorts.has(route.from) || !publicPorts.has(route.to)) continue;
              out.push(
                `- 航路 **${render(route.name)}**：${render(geo.ports.find((port) => port.id === route.from)?.name ?? route.from)} → ${render(geo.ports.find((port) => port.id === route.to)?.name ?? route.to)}；${route.points.length} 个航线控制点${featureHidden(map, 'seaRoutes', route.id) ? '；地图中已隐藏' : ''}。`,
              );
            }
          }
        }
        for (const road of mapFeatures(map).filter((feature) => feature.kind === 'roads'))
          out.push(
            `- 道路 **${render(road.name)}**：位置 (${Math.round(road.point.x)}, ${Math.round(road.point.y)})${featureHidden(map, 'roads', road.id) ? '；地图中已隐藏' : '；地图中显示'}。`,
          );
        for (const line of map.editor.military ?? [])
          out.push(
            `- ${militaryLineLabels[line.kind]} **${render(line.name)}**：${line.points.length} 个控制点；颜色 ${line.color}；线宽 ${line.width}${line.visible ? '' : '；已隐藏'}${line.kind === 'front' ? '；沿陆地国界或区域边界绘制' : ''}。`,
          );
        for (const region of map.editor.regions) {
          out.push(
            `- 地形 **${render(region.name)}**：${biomeCatalog.find((b) => b.id === region.biome)?.label}；${region.geometry === 'brush' ? '笔刷区域' : '多边形区域'}，${region.points.length} 个控制点；密度 ${Math.round(region.density * 100)}%；种子 ${region.seed}${region.visible ? '' : '；已隐藏'}${region.locked ? '；已锁定' : ''}`,
          );
        }
        const kindLabels = {
          symbol: '图章',
          path: '线条',
          polygon: '形状',
          text: '文字',
          image: '导入图片',
        };
        for (const object of map.editor.objects) {
          const component =
            object.kind === 'symbol'
              ? symbolCatalog.find((s) => s.id === object.symbol)?.label
              : kindLabels[object.kind];
          out.push(
            `- 组件 **${render(object.name)}**：${component}；${object.layer === 'base' ? '底层' : '细节层'}；${object.points.length} 个控制点${object.blur ? `；边缘柔和度 ${object.blur}` : ''}${object.text ? `；${render(object.text)}` : ''}${!object.visible || featureHidden(map, 'settlements', object.id) || featureHidden(map, 'roads', object.id) ? '；已隐藏' : ''}${object.locked ? '；已锁定' : ''}`,
          );
          if (object.kind === 'image')
            out.push(`  - 图片资源：${object.imageUrl}；迁移时同时备份 uploads 目录。`);
        }
      }
      for (const pin of map.pins) {
        const linked = worldEntities.find((e) => e.id === pin.entityId);
        if (!options.includeSecrets && linked?.visibility === 'gm') continue;
        out.push(
          `- **${render(pin.label)}** (${Math.round(pin.x)}, ${Math.round(pin.y)})：${render(pin.description)}${linked && permitted.has(linked.id) ? ` → [${linked.name}](#${linked.id})` : ''}${pin.childMapId ? `；子地图：${mapName(pin.childMapId)}` : ''}${featureHidden(map, 'settlements', pin.id) ? '；地图中已隐藏' : ''}`,
        );
      }
      out.push('');
    }
  }
  if (options.includeRelations) {
    out.push('## 人物关系');
    for (const r of data.relations.filter(
      (r) =>
        r.worldId === world.id &&
        (options.includeSecrets || r.visibility === 'public') &&
        permitted.has(r.sourceId) &&
        permitted.has(r.targetId),
    )) {
      out.push(
        `- [${entities.find((e) => e.id === r.sourceId)!.name}](#${r.sourceId}) → **${r.label}** → [${entities.find((e) => e.id === r.targetId)!.name}](#${r.targetId})：${render(r.description)}`,
      );
    }
  }
  if (options.includeSecrets && options.includePlots) {
    out.push('## 剧情路线（GM）');
    for (const plot of data.plots.filter((p) => p.worldId === world.id)) {
      out.push(`### ${plot.name}`, render(plot.summary), '```mermaid', 'flowchart TD');
      for (const node of plot.nodes)
        out.push(`  ${node.id}["${node.title.replace(/["\n<>]/g, ' ')}"]`);
      for (const edge of plot.edges)
        out.push(`  ${edge.source} -->|"${edge.label.replace(/["\n<>|]/g, ' ')}"| ${edge.target}`);
      out.push('```');
      for (const node of plot.nodes) {
        out.push(
          `#### ${node.title}`,
          render(node.summary),
          `- 状态：${node.status}`,
          `- 条件：${node.conditions.length ? node.conditions.map((c) => `${c.variable} ${c.operator} ${c.value}`).join(node.conditionMode === 'all' ? ' AND ' : ' OR ') : '无额外条件'}`,
          `- 完成效果：${node.effects.map((e) => `${e.variable} = ${e.value}`).join('；') || '无'}`,
        );
      }
    }
    out.push(
      '### 世界变量',
      ...data.variables.filter((v) => v.worldId === world.id).map((v) => `- ${v.name}：${v.value}`),
    );
  }
  if (options.includeSecrets && options.includeSessions) {
    out.push('## 团务日志（GM）');
    for (const session of data.sessions.filter((s) => s.worldId === world.id))
      out.push(
        `### ${session.title}`,
        `日期：${session.date} · ${session.status === 'completed' ? '已结束' : '计划中'}`,
        render(session.content),
      );
  }
  return out.join('\n\n') + '\n';
}
