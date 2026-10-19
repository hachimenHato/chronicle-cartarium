import { useEffect, useState } from 'react';
import type { AtlasMap, Entity, World } from '../../shared/model';
import {
  defaultGeographicSettings,
  GEOGRAPHY_LIMITS,
  validGeographicSettings,
  type GeneratedGeography,
  type GeographicSettings,
} from '../../shared/geography';
import { divisionEntityTypes, divisionLabels, type DivisionKind } from '../../shared/cartography';
import {
  militaryLineLabels,
  type MilitaryLineKind,
  type MapMilitaryLine,
} from '../../shared/generated-map';
import { EntityLink } from './Common';
import { DivisionQuickCreate } from './DivisionQuickCreate';
import { useAccess } from './AccessContext';
import './GeographyPanel.css';
import { GlobeExtentPicker } from './GlobeExtentPicker';

export type GeographyTool = 'pan' | 'assign' | MilitaryLineKind;
export function GeographyPanel({
  map,
  section = 'divisions',
  world,
  onChange,
  onSettings,
  entities,
  writable,
  pending,
  tool,
  onTool,
  selectedDivision,
  onDivision,
  selectedKind,
  onKind,
  selectedCells,
  onClearSelection,
  onApplySelection,
  onFocus,
  onOpen,
  onDeleteLine,
  onLineChange,
  onCreateEntry,
  onAddDivision,
  onReturn,
}: {
  map: AtlasMap;
  section?: 'divisions' | 'military';
  world?: World;
  onChange: (g: GeneratedGeography) => void;
  onSettings: (settings: GeographicSettings) => void;
  entities: Entity[];
  writable: boolean;
  pending: boolean;
  tool: GeographyTool;
  onTool: (tool: GeographyTool) => void;
  selectedDivision?: string;
  onDivision: (id: string) => void;
  selectedKind: DivisionKind;
  onKind: (kind: DivisionKind) => void;
  selectedCells: Set<number>;
  onClearSelection: () => void;
  onApplySelection: (kind: DivisionKind, divisionId?: string) => void;
  onFocus: (point: { x: number; y: number }) => void;
  onOpen: (id: string) => void;
  onDeleteLine: (id: string) => void;
  onLineChange: (line: MapMilitaryLine) => void;
  onCreateEntry: (divisionId: string, entity: Entity) => boolean;
  onAddDivision: (kind: DivisionKind, entity: Entity) => boolean;
  onReturn: () => void;
}) {
  const recipe = map.editor?.generation;
  const settings = recipe?.version === 2 ? recipe.geography : undefined;
  const g = map.editor?.generated?.geography;
  const [draft, setDraft] = useState(settings ?? defaultGeographicSettings(map.kind));
  const [creating, setCreating] = useState<string>();
  const [addingKind, setAddingKind] = useState<DivisionKind>();
  const access = useAccess();
  const creatingDivision = g?.divisions.find((d) => d.id === creating);
  useEffect(() => setDraft(settings ?? defaultGeographicSettings(map.kind)), [settings, map.id]);
  return (
    <div className="geography-panel">
      <h2>{section === 'military' ? '兵棋推演' : '疆域分区'}</h2>
      {!writable && (
        <button className="text-btn" onClick={onReturn}>
          返回地图档案
        </button>
      )}
      <p className="atlas-subtle">
        国家、文化与信仰沿地理单元划分。地名与聚落请在「地点与地名」中统一管理。
      </p>
      {g ? (
        <p className="geographic-summary">
          {g.cells.length} 个{map.kind === 'town' ? '街区单元' : '地理单元'} · {g.plates.length}{' '}
          板块 · {g.ports.length} 港口 · {g.seaRoutes.length} 航路
        </p>
      ) : (
        <p className="atlas-subtle">尚无地理数据。用下方参数生成；色块地图请先画出陆地。</p>
      )}
      {writable && (
        <details open={!g}>
          <summary>地理生成参数</summary>
          <div className="geography-parameter-grid">
            {(
              [
                ['plateCount', '板块数量', 3, 24, 1],
                ['countryCount', '国家／势力', 0, 24, 1],
                ['cultureCount', '文化数量', 0, 24, 1],
                ['religionCount', '信仰数量', 0, 24, 1],
                ['meanSeaTemperature', '赤道均温 ℃', -20, 45, 1],
                ['rainfall', '降水倍率', 0.2, 3, 0.1],
                ['windAngle', '主风基准 °', 0, 359, 1],
                ['roughness', '边缘破碎程度', 0, 1, 0.05],
                ['regionDensity', '区域细分倍率', 0.5, 2, 0.1],
              ] as const
            ).map(([key, label, min, max, step]) => (
              <label key={key}>
                {label}
                <input
                  className="field"
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  value={draft[key]}
                  onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          <GlobeExtentPicker
            climate={{
              settings: draft,
              kind: map.kind,
              width: map.width,
              height: map.height,
              scaleKm: map.scaleKm,
              seed: recipe?.seed,
              preset: recipe?.version === 2 ? recipe.elevation?.preset : undefined,
              elevation: map.editor?.generated?.elevation,
            }}
            value={{
              latitudeNorth: draft.latitudeNorth,
              latitudeSouth: draft.latitudeSouth,
              longitudeWest: draft.longitudeWest ?? -180,
              longitudeEast: draft.longitudeEast ?? 180,
            }}
            onChange={(extent) => setDraft({ ...draft, ...extent })}
            disabled={pending}
          />
          <label className="atlas-check">
            <input
              type="checkbox"
              checked={draft.ports}
              onChange={(e) => setDraft({ ...draft, ports: e.target.checked })}
            />
            生成港口与海路
          </label>
          <button
            className="btn primary"
            disabled={pending || !validGeographicSettings(draft)}
            onClick={() => onSettings(draft)}
          >
            {pending ? '正在构建…' : '按参数重新构建地理'}
          </button>
          <p className="atlas-subtle">
            会重新计算地形、水系和疆域；地名及关联按相同编号保留，可撤销。气温、降水是创作用的年均近似值。主风基准表示中纬度风向；热带与极地以反向为主，并计入次风。
          </p>
        </details>
      )}
      {g && (
        <>
          {writable && section === 'divisions' && (
            <details open className="geographic-territory-editor">
              <summary>按小区域修改疆域</summary>
              <div className="geographic-kind-tabs" role="group" aria-label="疆域类型">
                {(['country', 'culture', 'religion'] as const).map((kind) => (
                  <button
                    key={kind}
                    className={selectedKind === kind ? 'active' : ''}
                    aria-pressed={selectedKind === kind}
                    disabled={pending}
                    onClick={() => onKind(kind)}
                  >
                    {divisionLabels[kind]}
                  </button>
                ))}
              </div>
              <label className="atlas-label">
                将选中单元归入
                <select
                  className="field"
                  aria-label="填充分区"
                  disabled={pending}
                  value={selectedDivision ?? ''}
                  onChange={(e) => onDivision(e.target.value)}
                >
                  <option value="">选择{divisionLabels[selectedKind]}</option>
                  {g.divisions
                    .filter((division) => division.kind === selectedKind)
                    .map((division) => (
                      <option key={division.id} value={division.id}>
                        {division.name}
                      </option>
                    ))}
                </select>
              </label>
              {access.create('lore') && (
                <button
                  className="text-btn"
                  disabled={
                    pending ||
                    g.divisions.length >= GEOGRAPHY_LIMITS.divisions ||
                    g.divisions.filter((division) => division.kind === selectedKind).length >= 24 ||
                    !g.cells.some((cell) => cell.land)
                  }
                  title="创建对应设定条目后，再选择小区域分配归属；每类最多24个分区。"
                  onClick={() => setAddingKind(selectedKind)}
                >
                  新建{divisionLabels[selectedKind]}
                </button>
              )}
              {selectedDivision &&
                (() => {
                  const division = g.divisions.find((d) => d.id === selectedDivision);
                  if (!division) return null;
                  return (
                    <div className="geographic-division-target">
                      <input
                        type="color"
                        aria-label="分区显示颜色"
                        value={division.color}
                        disabled={pending}
                        onChange={(e) =>
                          onChange({
                            ...g,
                            divisions: g.divisions.map((d) =>
                              d.id === division.id ? { ...d, color: e.target.value } : d,
                            ),
                          })
                        }
                      />
                      {division.entityId ? (
                        <EntityLink
                          entity={entities.find((e) => e.id === division.entityId)}
                          onOpen={onOpen}
                        />
                      ) : (
                        <span className="atlas-subtle">尚未关联设定条目</span>
                      )}
                      {!division.entityId && access.create('lore') && (
                        <button
                          className="text-btn"
                          disabled={pending}
                          onClick={() => setCreating(division.id)}
                        >
                          建立条目
                        </button>
                      )}
                    </div>
                  );
                })()}
              <div className="geographic-selection-tools">
                <button
                  className={`btn ${tool === 'assign' ? 'primary' : ''}`}
                  aria-pressed={tool === 'assign'}
                  disabled={pending}
                  onClick={() => onTool('assign')}
                >
                  选择小区域
                </button>
                <button
                  className={`btn ${tool === 'pan' ? 'primary' : ''}`}
                  aria-pressed={tool === 'pan'}
                  onClick={() => onTool('pan')}
                >
                  平移地图
                </button>
              </div>
              <p className="geographic-selection-count" role="status">
                已选 {selectedCells.size} 个陆地单元
              </p>
              <p className="atlas-subtle">
                单击逐块选取，再次单击取消；Shift＋单击添加两点间相连单元，Ctrl／⌘＋单击选取相连的同归属区域。拖动可平移地图。检查高亮范围后应用。
              </p>
              <div className="geographic-selection-actions">
                <button
                  className="btn primary"
                  disabled={pending || !selectedCells.size || !selectedDivision}
                  onClick={() => onApplySelection(selectedKind, selectedDivision)}
                >
                  填充选中区域
                </button>
                <button
                  className="btn"
                  disabled={pending || !selectedCells.size}
                  onClick={() => onApplySelection(selectedKind)}
                >
                  清除归属
                </button>
                <button
                  className="text-btn"
                  disabled={!selectedCells.size}
                  onClick={onClearSelection}
                >
                  取消选择
                </button>
              </div>
              <p className="atlas-subtle">
                只修改当前{divisionLabels[selectedKind]}
                归属，其他两类划分保持不变。清除归属会留下未分配单元。
              </p>
            </details>
          )}
          {writable && section === 'military' && (
            <details open>
              <summary>兵棋推演</summary>
              <div className="military-tools">
                {Object.entries(militaryLineLabels).map(([id, label]) => (
                  <button
                    key={id}
                    className={`btn ${tool === id ? 'primary' : ''}`}
                    disabled={pending}
                    onClick={() => onTool(tool === id ? 'pan' : (id as MilitaryLineKind))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="atlas-subtle">
                前线沿陆地的国界／小区域边缘自动吸附；请从边界附近开始拖动。进攻、撤退与防御线可自由绘制。
                前线短齿与防御锯齿默认朝绘制方向的右侧。绘制后点击“翻转齿向”即可调换两侧；闭合线的内外同样这样切换。
              </p>
              {map.editor?.military?.map((l) => (
                <div key={l.id} className="military-line-card">
                  <span className="atlas-subtle">{militaryLineLabels[l.kind]}</span>
                  <div className="geographic-port-row">
                    <input
                      className="field"
                      aria-label={`兵棋线名称 ${l.id}`}
                      defaultValue={l.name}
                      key={`${l.id}-${l.name}`}
                      maxLength={120}
                      onBlur={(e) =>
                        e.target.value.trim() && onLineChange({ ...l, name: e.target.value.trim() })
                      }
                    />
                    <input
                      type="color"
                      aria-label={`兵棋线颜色 ${l.id}`}
                      value={l.color}
                      onChange={(e) => onLineChange({ ...l, color: e.target.value })}
                    />
                    <button className="text-btn" onClick={() => onDeleteLine(l.id)}>
                      删除
                    </button>
                  </div>
                  {(l.kind === 'front' || l.kind === 'defense') && (
                    <button
                      className="btn military-flip"
                      aria-label={`翻转齿向 ${l.name}`}
                      onClick={() => onLineChange({ ...l, points: [...l.points].reverse() })}
                    >
                      ⇄ 翻转齿向
                    </button>
                  )}
                </div>
              ))}
            </details>
          )}
        </>
      )}
      {creatingDivision && (
        <DivisionQuickCreate
          kind={creatingDivision.kind}
          worldId={map.worldId}
          world={world}
          initialName={creatingDivision.name}
          entities={entities}
          onClose={() => setCreating(undefined)}
          onCreate={(entity) => onCreateEntry(creatingDivision.id, entity)}
        />
      )}
      {addingKind && (
        <DivisionQuickCreate
          kind={addingKind}
          worldId={map.worldId}
          world={world}
          entities={entities}
          onClose={() => setAddingKind(undefined)}
          onCreate={(entity) => onAddDivision(addingKind, entity)}
        />
      )}
    </div>
  );
}
