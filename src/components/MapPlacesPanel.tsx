import { useMemo, useState } from 'react';
import { MapPin, Anchor, Search, Plus, ArrowUpRight, Eye, EyeOff, Route } from 'lucide-react';
import {
  mapFeatures,
  featureHidden,
  toggleMapFeature,
  type MapFeatureKind,
} from '../../shared/map-features';
import type { AtlasMap, Entity, EntityType, World } from '../../shared/model';
import type { GeneratedGeography } from '../../shared/geography';
import {
  divisionEntityTypes,
  divisionLabels,
  settlementCatalog,
  type GeneratedSettlement,
  type SketchGenerationV2,
} from '../../shared/cartography';
import { newEntity } from '../../shared/entity-templates';
import { settlementCounts } from '../lib/settlements';
import { renameSettlementArtwork } from '../lib/settlement-names';
import { EntityLink, Modal } from './Common';
import { useAccess } from './AccessContext';
import './MapPlacesPanel.css';

const areaLabels = {
  continent: '大陆',
  island: '岛屿',
  ocean: '海域',
  lake: '湖泊',
  province: '地区',
  district: '街区',
};
type Place = {
  id: string;
  category: 'sites' | 'areas' | 'divisions' | 'ports' | 'pins';
  name: string;
  label: string;
  type: EntityType;
  entityId?: string;
  center: { x: number; y: number };
  settlementId?: string;
};

/** All named map places share one editing and association surface. */
export function MapPlacesPanel({
  map,
  world,
  entities,
  settlements,
  pending,
  writable,
  onGeneration,
  onChangeGeography,
  onFocus,
  onOpen,
  onCreatePlace,
  onChangeMap,
}: {
  map: AtlasMap;
  world?: World;
  entities: Entity[];
  settlements: GeneratedSettlement[];
  pending: boolean;
  writable: boolean;
  onGeneration: (patch: Partial<SketchGenerationV2>) => void;
  onChangeGeography: (geography: GeneratedGeography) => void;
  onFocus: (point: { x: number; y: number }) => void;
  onOpen: (id: string) => void;
  onCreatePlace: (entity: Entity, map: AtlasMap) => boolean;
  onChangeMap: (map: AtlasMap) => void;
}) {
  const [filter, setFilter] = useState('');
  const [group, setGroup] = useState('all');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState<{ place: Place; entity: Entity }>();
  const access = useAccess();
  const recipe = map.editor?.generation;
  const settings = recipe?.version === 2 ? recipe : undefined;
  const geography = map.editor?.generated?.geography;
  const sites = useMemo(
    () =>
      settings ? (renameSettlementArtwork([], settlements, settings).sites ?? []) : settlements,
    [settings, settlements],
  );
  const counts = settings ? settlementCounts(settings) : undefined;
  const total = counts ? Object.values(counts).reduce((sum, count) => sum + count, 0) : 0;
  const features = useMemo(() => mapFeatures(map), [map]);
  const matches = (name: string) =>
    name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase());
  const lines = features.filter(
    (f) => (f.kind === 'roads' || f.kind === 'seaRoutes') && matches(f.name),
  );
  const places: Place[] = [
    ...map.pins.map((pin) => ({
      ...pin,
      name: pin.label,
      category: 'pins' as const,
      label: '地图标记',
      type: 'location' as const,
      center: { x: pin.x, y: pin.y },
    })),
    ...sites.map((site) => ({
      ...site,
      category: 'sites' as const,
      label: settlementCatalog[site.kind].label,
      type: 'location' as const,
      center: { x: site.x, y: site.y },
    })),
    ...(geography?.divisions ?? []).map((division) => ({
      ...division,
      category: 'divisions' as const,
      label: divisionLabels[division.kind],
      type: divisionEntityTypes[division.kind],
    })),
    ...(geography?.areas ?? []).map((area) => ({
      ...area,
      category: 'areas' as const,
      label: areaLabels[area.kind],
      type: 'location' as const,
    })),
    ...(geography?.ports ?? []).map((port) => ({
      ...port,
      category: 'ports' as const,
      label: '港口',
      type: 'location' as const,
      entityId: port.settlementId
        ? sites.find((site) => site.id === port.settlementId)?.entityId
        : port.entityId,
    })),
  ];
  const visible = places.filter(
    (place) =>
      (group === 'all' || place.category === group) &&
      `${place.name} ${place.label}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );
  const components = features.filter(
    (f) =>
      f.origin === 'object' &&
      (f.kind === 'settlements' || f.kind === 'ports') &&
      !places.some((p) => p.id === f.id) &&
      matches(f.name) &&
      (group === 'all' ||
        (group === 'sites' && f.kind === 'settlements') ||
        (group === 'ports' && f.kind === 'ports')),
  );
  const visibleLines = group === 'all' || group === 'lines' ? lines : [];
  const resultCount = visible.length + components.length + visibleLines.length;
  function visibilityButton(kind: MapFeatureKind, id: string, name: string) {
    const hidden = featureHidden(map, kind, id);
    return (
      <button
        type="button"
        className={`map-feature-toggle ${hidden ? 'is-hidden' : ''}`}
        disabled={!writable || pending}
        aria-label={`${hidden ? '显示' : '隐藏'} ${name}`}
        aria-pressed={!hidden}
        onClick={() => onChangeMap(toggleMapFeature(map, kind, id))}
      >
        {hidden ? <EyeOff size={15} /> : <Eye size={15} />}
        <span>{hidden ? '已隐藏' : '显示中'}</span>
      </button>
    );
  }
  function changedMap(place: Place, patch: { name?: string; entityId?: string }, link = false) {
    if (place.category === 'pins')
      return {
        ...map,
        pins: map.pins.map((pin) =>
          pin.id === place.id
            ? { ...pin, ...(link ? { entityId: patch.entityId } : { label: patch.name! }) }
            : pin,
        ),
      };
    if (!map.editor || !settings) return map;
    if (place.category === 'sites' || (place.category === 'ports' && link && place.settlementId)) {
      const id = place.settlementId ?? place.id;
      const settlementLinks = { ...settings.settlementLinks };
      if (link) {
        if (patch.entityId) settlementLinks[id] = patch.entityId;
        else delete settlementLinks[id];
      }
      const generation = {
        ...settings,
        ...(link
          ? { settlementLinks }
          : { settlementNames: { ...settings.settlementNames, [id]: patch.name! } }),
      };
      const snapshot = map.editor.generated;
      const renamed = snapshot
        ? renameSettlementArtwork(snapshot.objects, snapshot.sites, generation)
        : undefined;
      return {
        ...map,
        editor: {
          ...map.editor,
          generation,
          ...(snapshot && renamed ? { generated: { ...snapshot, ...renamed } } : {}),
        },
      };
    }
    if (!geography || !map.editor.generated) return map;
    const category = place.category as 'areas' | 'divisions' | 'ports';
    return {
      ...map,
      editor: {
        ...map.editor,
        generated: {
          ...map.editor.generated,
          geography: {
            ...geography,
            [category]: geography[category].map((item) =>
              item.id === place.id ? { ...item, ...patch } : item,
            ),
          },
        },
      },
    };
  }
  function commitPlace(place: Place, patch: { name?: string; entityId?: string }, link = false) {
    const next = changedMap(place, patch, link);
    if (next === map) return;
    if (place.category === 'pins') {
      onChangeMap(next);
      return;
    }
    if (place.category === 'sites' || (place.category === 'ports' && link && place.settlementId)) {
      const generation = next.editor!.generation as SketchGenerationV2;
      onGeneration(
        link
          ? { settlementLinks: generation.settlementLinks }
          : { settlementNames: generation.settlementNames },
      );
    } else if (next.editor?.generated?.geography)
      onChangeGeography(next.editor.generated.geography);
  }
  return (
    <div className="map-places-panel">
      <header>
        <span className="map-places-kicker">地图索引</span>
        <h2>地点与地名</h2>
        <p>
          统一编辑地点、道路与航路。隐藏只影响地图和图片导出，保留数据与关联，可随时显示；不会重新生成地图。
        </p>
      </header>
      {settings && counts && (
        <details className="map-places-count-panel">
          <summary>
            聚落生成数量{' '}
            <span>
              {sites.length} / {total} 处
            </span>
          </summary>
          <p>设置各类型数量上限，修改后重新选址；空间不足时实际数量会减少。</p>
          <div className="map-places-counts">
            {Object.entries(settlementCatalog).map(([key, definition]) => {
              const kind = key as GeneratedSettlement['kind'];
              return (
                <label key={key}>
                  {definition.label}
                  <input
                    className="field"
                    type="number"
                    aria-label={`${definition.label}生成数量`}
                    key={`${key}-${counts[kind]}`}
                    defaultValue={counts[kind]}
                    min={0}
                    max={24}
                    step={1}
                    disabled={!writable || pending}
                    onBlur={(event) => {
                      const count = Number(event.target.value);
                      if (
                        !Number.isInteger(count) ||
                        count < 0 ||
                        count > 24 ||
                        total - counts[kind] + count > 60
                      ) {
                        setError('每种最多24处，合计最多60处。');
                        event.target.value = String(counts[kind]);
                        return;
                      }
                      setError('');
                      if (count !== counts[kind])
                        onGeneration({ settlementCounts: { ...counts, [kind]: count } });
                    }}
                    onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                  />
                  <small>{sites.filter((site) => site.kind === kind).length} 已生成</small>
                </label>
              );
            })}
          </div>
        </details>
      )}
      <label className="map-places-search">
        <Search size={16} />
        <input
          className="field"
          aria-label="搜索地图地名"
          placeholder="搜索聚落、海域、国家…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </label>
      <div className="map-places-filters" role="group" aria-label="地点分类">
        {[
          ['all', '全部'],
          ['sites', '聚落'],
          ['areas', '地名'],
          ['divisions', '疆域'],
          ['ports', '港口'],
          ['pins', '标记'],
          ['lines', '道路与航路'],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={group === id}
            className={group === id ? 'active' : ''}
            onClick={() => setGroup(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="map-places-result">
        {resultCount} 个项目{pending ? ' · 正在生成…' : ''}
      </p>
      <div className="map-places-list">
        {visible.map((place) => (
          <article key={`${place.category}-${place.id}`} className="map-place-card">
            <div className="map-place-heading">
              <span>
                {place.category === 'ports' ? <Anchor size={14} /> : <MapPin size={14} />}
                {place.label}
              </span>
              <button className="text-btn" disabled={pending} onClick={() => onFocus(place.center)}>
                定位 <ArrowUpRight size={13} />
              </button>
              {features.some(
                (f) => f.id === place.id && (f.kind === 'settlements' || f.kind === 'ports'),
              ) &&
                visibilityButton(
                  place.category === 'ports' ? 'ports' : 'settlements',
                  place.id,
                  place.name,
                )}
            </div>
            <input
              className="field map-place-name"
              aria-label={`${place.label}名称 ${place.id}`}
              key={`${place.id}-${place.name}`}
              defaultValue={place.name}
              maxLength={place.category === 'sites' ? 240 : 120}
              disabled={!writable || pending}
              onBlur={(event) => {
                const name = event.target.value.trim();
                if (!name || /[\u0000-\u001f\u007f]/.test(name)) {
                  setError('名称不能为空，不能包含控制字符。');
                  event.target.value = place.name;
                  return;
                }
                setError('');
                if (name !== place.name) commitPlace(place, { name });
              }}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            />
            <select
              className="field"
              aria-label={`关联档案 ${place.id}`}
              value={place.entityId ?? ''}
              disabled={!writable || pending}
              onChange={(event) =>
                commitPlace(place, { entityId: event.target.value || undefined }, true)
              }
            >
              <option value="">关联设定条目</option>
              {entities
                .filter(
                  (entity) =>
                    entity.worldId === map.worldId &&
                    (place.category === 'pins' || entity.type === place.type),
                )
                .map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.name}
                  </option>
                ))}
            </select>
            <div className="map-place-link-row">
              {place.entityId ? (
                <EntityLink
                  entity={entities.find((entity) => entity.id === place.entityId)}
                  onOpen={onOpen}
                />
              ) : (
                <span>尚未关联</span>
              )}
              {!place.entityId && writable && access.create('lore') && (
                <button
                  className="text-btn"
                  disabled={pending}
                  onClick={() =>
                    setCreating({
                      place,
                      entity: {
                        ...newEntity(map.worldId, place.type, world),
                        name: place.name,
                        visibility: map.visibility ?? 'gm',
                        createdBy: access.actor.id,
                      },
                    })
                  }
                >
                  <Plus size={13} />
                  建立条目
                </button>
              )}
            </div>
            {place.category === 'ports' && (
              <small className="map-place-port-note">
                {place.settlementId
                  ? '关联与所属聚落共享；港口名称可单独修改。'
                  : '独立沿海港口，不占用聚落数量，可单独关联档案。'}
              </small>
            )}
          </article>
        ))}
        {[...components, ...visibleLines].map((feature) => (
          <article key={`${feature.kind}-${feature.id}`} className="map-place-card map-line-card">
            <div className="map-place-heading">
              <span>
                {feature.kind === 'ports' ? (
                  <Anchor size={14} />
                ) : feature.kind === 'settlements' ? (
                  <MapPin size={14} />
                ) : (
                  <Route size={14} />
                )}
                {
                  {
                    roads: '道路',
                    seaRoutes: '航路',
                    settlements: '手工聚落组件',
                    ports: '手工港口组件',
                  }[feature.kind]
                }
              </span>
              {visibilityButton(feature.kind, feature.id, feature.name)}
            </div>
            <strong>{feature.name}</strong>
            <button className="text-btn" disabled={pending} onClick={() => onFocus(feature.point)}>
              定位 <ArrowUpRight size={13} />
            </button>
          </article>
        ))}
      </div>
      {!resultCount && (
        <div className="map-places-empty">
          <MapPin size={24} />
          <p>
            {places.length || features.length
              ? '没有找到匹配的项目。'
              : '生成地图后，这里会出现聚落、地名与交通路线。'}
          </p>
        </div>
      )}
      {error && !creating && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {creating && (
        <Modal title={`快速创建${creating.place.label}条目`} onClose={() => setCreating(undefined)}>
          <form
            className="division-quick-form"
            onSubmit={(event) => {
              event.preventDefault();
              const name = creating.entity.name.trim();
              if (
                !name ||
                entities.some(
                  (entity) =>
                    entity.worldId === map.worldId &&
                    entity.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
                )
              ) {
                setError('请输入唯一的条目名称，或关联已经存在的条目。');
                return;
              }
              const entity = {
                ...creating.entity,
                name,
                summary: creating.entity.summary.trim(),
                updatedAt: new Date().toISOString(),
              };
              if (
                onCreatePlace(entity, changedMap(creating.place, { entityId: entity.id }, true))
              ) {
                setCreating(undefined);
                setError('');
              } else setError('当前地图无法建立关联，请稍后再试。');
            }}
          >
            <p className="atlas-subtle">创建后直接关联当前位置，详细设定可以稍后打开补充。</p>
            <label>
              条目名称
              <input
                className="field"
                required
                maxLength={240}
                value={creating.entity.name}
                onChange={(event) =>
                  setCreating({
                    ...creating,
                    entity: { ...creating.entity, name: event.target.value },
                  })
                }
              />
            </label>
            <label>
              摘要
              <textarea
                className="field"
                rows={3}
                maxLength={2000}
                value={creating.entity.summary}
                onChange={(event) =>
                  setCreating({
                    ...creating,
                    entity: { ...creating.entity, summary: event.target.value },
                  })
                }
              />
            </label>
            <label>
              内容标记
              <select
                className="field"
                value={creating.entity.visibility}
                onChange={(event) =>
                  setCreating({
                    ...creating,
                    entity: {
                      ...creating.entity,
                      visibility: event.target.value as Entity['visibility'],
                    },
                  })
                }
              >
                <option value="public">公开内容</option>
                <option value="gm">GM 私密内容</option>
              </select>
            </label>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => setCreating(undefined)}>
                取消
              </button>
              <button className="btn primary" type="submit">
                创建并关联
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
