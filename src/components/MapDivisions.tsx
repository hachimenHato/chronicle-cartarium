import { useEffect, useId, useMemo, useState } from 'react';
import type { AtlasMap, Entity, World } from '../../shared/model';
import {
  DIVISION_LIMITS,
  divisionLabels,
  divisionEntityTypes,
  type DivisionKind,
  type MapDivision,
  type MapPoint,
} from '../../shared/cartography';
import { divisionAnchor, divisionStrokePath } from '../lib/divisions';
import { EntityLink } from './Common';
import { useEntityTooltip } from './EntityTooltip';
import type { DivisionStudio } from './useDivisionStudio';
import { DivisionQuickCreate } from './DivisionQuickCreate';
import { formatDistance } from '../lib/map-scale';
import './MapDivisions.css';
import { useAccess } from './AccessContext';
import { getEntityTypes } from '../../shared/entity-types';

function DivisionLabel({
  division,
  map,
  entities,
  onOpen,
}: {
  division: MapDivision;
  map: AtlasMap;
  entities: Entity[];
  onOpen?: (id: string) => void;
}) {
  const entity = entities.find((e) => e.id === division.entityId);
  const tooltip = useEntityTooltip(entity);
  const anchor = useMemo(() => divisionAnchor(map, division.id), [map, division.id]);
  if (!anchor) return null;
  return (
    <g
      {...tooltip}
      className="map-division-label"
      transform={`translate(${anchor.x} ${anchor.y})`}
      role={onOpen && entity ? 'button' : undefined}
      tabIndex={onOpen && entity ? 0 : undefined}
      aria-label={`打开${divisionLabels[division.kind]}条目：${entity?.name ?? division.name}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => entity && onOpen?.(entity.id)}
      onKeyDown={(e) => {
        if (entity && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen?.(entity.id);
        }
      }}
    >
      <text
        textAnchor="middle"
        fontSize={Math.max(12, Math.min(map.width, map.height) / 44)}
        fontFamily="Georgia, 'Noto Serif SC', serif"
        fill={division.color}
        stroke="#f5ebd1"
        strokeWidth="3"
        paintOrder="stroke"
        fontWeight="600"
      >
        {division.name}
      </text>
    </g>
  );
}
export function MapDivisions({
  map,
  entities = [],
  kind = 'country',
  onOpen,
  studio,
  zoom = 1,
}: {
  map: AtlasMap;
  entities?: Entity[];
  kind?: DivisionKind | 'none';
  onOpen?: (id: string) => void;
  studio?: DivisionStudio;
  zoom?: number;
}) {
  const prefix = useId().replace(/:/g, '');
  const divisions = (map.editor?.divisions ?? []).filter((d) => d.kind === kind);
  const ids = new Set(divisions.map((d) => d.id));
  const paints = useMemo(
    () =>
      (map.editor?.divisionPaint ?? []).map((s) => ({
        stroke: s,
        path: divisionStrokePath(s, map.width, map.height),
      })),
    [map.editor?.divisionPaint, map.width, map.height],
  );
  const handles = studio?.tool === 'vertices' ? (studio.draft ?? studio.stroke) : undefined;
  return (
    <g data-map-divisions={kind}>
      <defs>
        {paints
          .filter(({ stroke }) => ids.has(stroke.divisionId))
          .map(({ stroke, path }) => (
            <path
              key={stroke.id}
              id={`${prefix}-stroke-${stroke.id}`}
              d={path}
              fillRule="evenodd"
            />
          ))}
        <filter
          id={`${prefix}-border`}
          x="-5%"
          y="-5%"
          width="110%"
          height="110%"
          colorInterpolationFilters="sRGB"
        >
          <feMorphology in="SourceAlpha" operator="erode" radius="1.2" result="inner" />
          <feComposite in="SourceGraphic" in2="inner" operator="out" />
        </filter>
        {divisions.map((division) => (
          <mask
            key={division.id}
            id={`${prefix}-${division.id}`}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={map.width}
            height={map.height}
            style={{ maskType: 'luminance' }}
          >
            <rect width={map.width} height={map.height} fill="#000" />
            {paints
              .filter(
                ({ stroke: s }) =>
                  ids.has(s.divisionId) &&
                  (s.operation === 'paint' || s.divisionId === division.id),
              )
              .map(({ stroke: s }) => (
                <use
                  key={s.id}
                  href={`#${prefix}-stroke-${s.id}`}
                  fill={s.operation === 'paint' && s.divisionId === division.id ? '#fff' : '#000'}
                  fillRule="evenodd"
                />
              ))}
          </mask>
        ))}
      </defs>
      {divisions
        .filter((d) => d.visible)
        .map((division) => (
          <g key={division.id} data-map-division={division.id}>
            <g mask={`url(#${prefix}-${division.id})`} pointerEvents="none">
              <rect width={map.width} height={map.height} fill={division.color} fillOpacity="0.2" />
            </g>
            <g filter={`url(#${prefix}-border)`} pointerEvents="none">
              <rect
                width={map.width}
                height={map.height}
                fill={division.color}
                mask={`url(#${prefix}-${division.id})`}
              />
            </g>
            <DivisionLabel division={division} map={map} entities={entities} onOpen={onOpen} />
          </g>
        ))}
      {handles && (
        <g data-editor-overlay="true">
          <polyline
            points={handles.points.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#4f4941"
            strokeWidth={1 / zoom}
            strokeDasharray={`${4 / zoom} ${3 / zoom}`}
            pointerEvents="none"
          />
          {handles.points.map((p, i) => (
            <circle
              key={i}
              data-division-vertex={i}
              cx={p.x}
              cy={p.y}
              r={4 / zoom}
              fill={i === studio?.vertexIndex ? '#a36550' : '#fff9e8'}
              stroke="#4f4941"
              strokeWidth={1 / zoom}
              onPointerDown={(e) => studio?.startVertex(e, i)}
            />
          ))}
        </g>
      )}
    </g>
  );
}
export function DivisionPanel({
  map,
  world,
  studio,
  entities,
  width,
  setWidth,
  onOpen,
  onCreate,
  coastlines,
}: {
  map: AtlasMap;
  world?: World;
  studio: DivisionStudio;
  entities: Entity[];
  width: number;
  setWidth: (n: number) => void;
  onOpen: (id: string) => void;
  onCreate: (entity: Entity) => boolean;
  coastlines?: MapPoint[][];
}) {
  const [entityId, setEntityId] = useState('');
  const [name, setName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const access = useAccess();
  const typeAvailable = getEntityTypes(world).some(
    (t) => t.id === divisionEntityTypes[studio.kind],
  );
  const [snapDistance, setSnapDistance] = useState('30');
  const choices = entities.filter(
    (e) => e.worldId === map.worldId && e.type === divisionEntityTypes[studio.kind],
  );
  const selected = studio.selected;
  const point =
    studio.stroke?.points[Math.min(studio.vertexIndex, (studio.stroke?.points.length ?? 1) - 1)];
  useEffect(() => {
    setEntityId('');
    setDeleteConfirm(false);
  }, [map.id, studio.kind, selected?.id]);
  useEffect(() => setCreateOpen(false), [map.id, studio.kind]);
  useEffect(() => setName(selected?.name ?? ''), [selected?.id, selected?.name]);
  return (
    <div className="division-panel" data-division-controls="true">
      <div className="division-heading">
        <span>疆域与人文</span>
        <small>描绘世界的归属</small>
      </div>
      <div className="division-kind-tabs">
        {(Object.keys(divisionLabels) as DivisionKind[]).map((kind) => (
          <button
            key={kind}
            className={studio.kind === kind ? 'active' : ''}
            onClick={() => studio.setKind(kind)}
          >
            {divisionLabels[kind]}
          </button>
        ))}
      </div>
      <p className="atlas-subtle">
        三层独立；同层后画的领地替换重叠部分。先关联条目，再涂抹边界；悬停名称1秒查看摘要，点击进入设定。
      </p>
      <label className="atlas-label">
        关联{divisionLabels[studio.kind]}条目
        <select className="field" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
          <option value="">
            选择已有{studio.kind === 'country' ? '势力 / 国家' : divisionLabels[studio.kind]}设定…
          </option>
          {choices.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="btn"
        disabled={!entityId}
        onClick={() => {
          const entity = choices.find((e) => e.id === entityId);
          if (entity) studio.add(entity);
        }}
      >
        添加{divisionLabels[studio.kind]}分区
      </button>
      <button
        className="btn"
        onClick={() => setCreateOpen(true)}
        disabled={
          !access.create('lore') ||
          !typeAvailable ||
          (map.editor?.divisions?.length ?? 0) >= DIVISION_LIMITS.divisions
        }
      >
        ＋ 快速创建{divisionLabels[studio.kind]}
      </button>
      {!typeAvailable && (
        <p className="atlas-small-empty">
          此世界已移除此内置类型，请在知识库的“设定类型”中恢复后再快捷创建。
        </p>
      )}
      {!choices.length && typeAvailable && (
        <div className="atlas-small-empty">
          还没有{divisionLabels[studio.kind]}
          条目。点击上方「快速创建」，填写名称与摘要即可开始划分范围。
        </div>
      )}
      <div className="division-list">
        {(map.editor?.divisions ?? [])
          .filter((d) => d.kind === studio.kind)
          .map((d) => (
            <button
              key={d.id}
              className={d.id === selected?.id ? 'active' : ''}
              onClick={() => studio.select(d.id)}
            >
              <i style={{ background: d.color }} />
              {d.name}
              {!d.visible && <small>隐藏</small>}
            </button>
          ))}
      </div>
      {selected && (
        <>
          <label className="atlas-label">
            分区名称
            <input
              className="field"
              value={name}
              maxLength={240}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name.trim() && name.trim() !== selected.name)
                  studio.patchDivision({ name: name.trim() });
                else setName(selected.name);
              }}
            />
          </label>
          <div className="division-style-row">
            <label>
              图层颜色{' '}
              <input
                aria-label="分区颜色"
                type="color"
                value={selected.color}
                onChange={(e) => studio.patchDivision({ color: e.target.value })}
              />
            </label>
            <label className="atlas-check">
              <input
                type="checkbox"
                checked={selected.visible}
                onChange={(e) => studio.patchDivision({ visible: e.target.checked })}
              />
              显示分区
            </label>
          </div>
          <label className="atlas-label">
            对应设定
            <select
              className="field"
              value={selected.entityId ?? ''}
              onChange={(e) => studio.patchDivision({ entityId: e.target.value || undefined })}
            >
              <option value="">未关联（重新选择条目）</option>
              {choices.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          {selected.entityId && (
            <EntityLink entity={entities.find((e) => e.id === selected.entityId)} onOpen={onOpen} />
          )}
          <div className="division-tools">
            {(
              [
                ['paint', '涂抹领地'],
                ['erase', '擦除领地'],
                ['lasso', '描边圈选'],
                ['vertices', '精修控制点'],
                ['pan', '平移地图'],
              ] as const
            ).map(([tool, label]) => (
              <button
                key={tool}
                className={studio.tool === tool ? 'active' : ''}
                onClick={() => studio.setTool(tool)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="atlas-label">
            分区笔刷直径 <span>{width}</span>
            <input
              aria-label="分区笔刷直径"
              type="range"
              min="5"
              max="500"
              step="5"
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
            />
          </label>
          <label className="atlas-label">
            边界自然起伏 <span>{Math.round(studio.roughness * 100)}%</span>
            <input
              aria-label="边界自然起伏"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={studio.roughness}
              onChange={(e) => studio.setRoughness(Number(e.target.value))}
            />
          </label>
          <p className="atlas-subtle">
            涂抹与圈选均可自然化边缘，起伏设为 0
            可精确描边。缩放放大后，用小笔刷擦除可画出海湾、飞地或孔洞。Esc 取消当前一笔。
          </p>
          <div className="division-snap">
            <label className="atlas-label">
              最大吸附距离（地图单位）
              <input
                className="field"
                type="number"
                min="0"
                max={Math.max(map.width, map.height)}
                step="1"
                value={snapDistance}
                onChange={(e) => setSnapDistance(e.target.value)}
              />
            </label>
            <p className="atlas-subtle">
              仅移动距离内的范围边缘，沿真实海岸线贴合；远处的内陆边界保留。
              {map.scaleKm && Number(snapDistance) > 0
                ? ` 当前距离约 ${formatDistance((Number(snapDistance) / map.width) * map.scaleKm)}。`
                : ''}
            </p>
            <button
              className="btn"
              disabled={
                !coastlines?.length ||
                !studio.strokes.length ||
                !selected.visible ||
                snapDistance === '' ||
                !Number.isFinite(Number(snapDistance)) ||
                Number(snapDistance) < 0 ||
                Number(snapDistance) > Math.max(map.width, map.height)
              }
              onClick={() => studio.snapToLand(coastlines!, Number(snapDistance))}
            >
              一键吸附陆地边缘
            </button>
            {!coastlines?.length && (
              <small className="atlas-subtle">地形生成完成后可吸附；请先切换到生成预览。</small>
            )}
          </div>
          {studio.tool === 'vertices' && studio.stroke && (
            <div className="division-precision">
              <label className="atlas-label">
                此笔边界起伏
                <input
                  aria-label="此笔边界起伏"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={studio.stroke.roughness}
                  onChange={(e) =>
                    studio.commitPaint({ ...studio.stroke!, roughness: Number(e.target.value) })
                  }
                />
              </label>
              <label className="atlas-label">
                边界笔迹
                <select
                  className="field"
                  value={studio.stroke.id}
                  onChange={(e) => {
                    studio.setStrokeId(e.target.value);
                    studio.setVertexIndex(0);
                  }}
                >
                  {studio.strokes.map((s, i) => (
                    <option key={s.id} value={s.id}>
                      {i + 1} ·{' '}
                      {s.operation === 'erase'
                        ? '擦除'
                        : s.geometry === 'polygon'
                          ? '圈选'
                          : '涂抹'}{' '}
                      · {s.points.length} 点
                    </option>
                  ))}
                </select>
              </label>
              <label className="atlas-label">
                控制点
                <select
                  className="field"
                  value={Math.min(studio.vertexIndex, studio.stroke.points.length - 1)}
                  onChange={(e) => studio.setVertexIndex(Number(e.target.value))}
                >
                  {studio.stroke.points.map((_, i) => (
                    <option key={i} value={i}>
                      第 {i + 1} 点
                    </option>
                  ))}
                </select>
              </label>
              {point && (
                <form
                  key={`${studio.stroke.id}-${studio.vertexIndex}-${point.x}-${point.y}`}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    studio.commitPaint({
                      ...studio.stroke!,
                      points: studio.stroke!.points.map((p, i) =>
                        i === Math.min(studio.vertexIndex, studio.stroke!.points.length - 1)
                          ? { x: Number(data.get('x')), y: Number(data.get('y')) }
                          : p,
                      ),
                    });
                  }}
                >
                  <div className="map-size-grid">
                    <label>
                      X
                      <input
                        className="field"
                        name="x"
                        aria-label="边界点 X"
                        type="number"
                        min="0"
                        max={map.width}
                        step="any"
                        required
                        defaultValue={Number(point.x.toFixed(3))}
                      />
                    </label>
                    <label>
                      Y
                      <input
                        className="field"
                        name="y"
                        aria-label="边界点 Y"
                        type="number"
                        min="0"
                        max={map.height}
                        step="any"
                        required
                        defaultValue={Number(point.y.toFixed(3))}
                      />
                    </label>
                  </div>
                  <button className="btn" type="submit">
                    应用控制点坐标
                  </button>
                </form>
              )}
              <div className="division-tools">
                <button
                  disabled={studio.stroke.points.length >= DIVISION_LIMITS.points}
                  onClick={() => {
                    const s = studio.stroke!;
                    const i = Math.min(studio.vertexIndex, s.points.length - 1),
                      a = s.points[i],
                      b = s.points[(i + 1) % s.points.length];
                    studio.commitPaint({
                      ...s,
                      points: [
                        ...s.points.slice(0, i + 1),
                        { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
                        ...s.points.slice(i + 1),
                      ],
                    });
                    studio.setVertexIndex(i + 1);
                  }}
                >
                  在此点后插入
                </button>
                <button
                  disabled={
                    studio.stroke.points.length <= (studio.stroke.geometry === 'polygon' ? 3 : 1)
                  }
                  onClick={() => {
                    const s = studio.stroke!;
                    studio.commitPaint({
                      ...s,
                      points: s.points.filter(
                        (_, i) => i !== Math.min(studio.vertexIndex, s.points.length - 1),
                      ),
                    });
                    studio.setVertexIndex(0);
                  }}
                >
                  删除控制点
                </button>
              </div>
              <button className="btn" onClick={studio.deleteStroke}>
                删除此笔边界编辑
              </button>
            </div>
          )}
          <button className="btn danger" onClick={() => setDeleteConfirm(true)}>
            删除分区
          </button>
          {deleteConfirm && (
            <div role="alert" className="division-delete">
              将移除此分区与全部边界笔迹，设定条目仍保留。可撤销。
              <div className="division-tools">
                <button
                  onClick={() => {
                    studio.remove();
                    setDeleteConfirm(false);
                  }}
                >
                  确认删除分区
                </button>
                <button onClick={() => setDeleteConfirm(false)}>取消</button>
              </div>
            </div>
          )}
        </>
      )}
      {studio.notice && (
        <p className="studio-notice" role="status">
          {studio.notice}
        </p>
      )}
      {createOpen && (
        <DivisionQuickCreate
          key={`${map.worldId}-${studio.kind}`}
          kind={studio.kind}
          world={world}
          worldId={map.worldId}
          entities={entities}
          onCreate={onCreate}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </div>
  );
}
