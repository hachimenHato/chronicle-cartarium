import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  Position,
  useNodesState,
  type Connection,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  GitBranch,
  Plus,
  Play,
  Trash2,
  Users,
  LockKeyhole,
  Check,
  X,
  SlidersHorizontal,
  RotateCcw,
} from 'lucide-react';
import {
  makeId,
  type Condition,
  type Entity,
  type Plot,
  type PlotNode,
  type Relation,
  type StateVariable,
} from '../../shared/model';
import { availability } from '../lib/plot-engine';
import { EntityLink, Empty, Modal } from './Common';
import { layoutClues, connectionLanes } from '../lib/graph-layout';
import { clueEdgeTypes } from './ClueEdge';
import { ClueLabelProvider } from './ClueLabels';
import { useAccess } from './AccessContext';
import { getEntityTypeLabel } from '../../shared/entity-types';
import type { World } from '../../shared/model';
import { RecordPublication } from './RecordPublication';
const edgeColors = { ally: '#5c8b76', enemy: '#b97264', family: '#aa985e', neutral: '#8b98a1' };
const relationLabels = { ally: '盟友', enemy: '敌对', family: '亲属', neutral: '中立' };

export function RelationshipGraph({
  entities,
  relations,
  worldId,
  onChange,
  onOpen,
  onPositions,
  world,
}: {
  entities: Entity[];
  relations: Relation[];
  worldId: string;
  onChange: (relations: Relation[]) => void;
  onOpen: (id: string) => void;
  onPositions: (positions: Record<string, { x: number; y: number }>) => void;
  world?: World;
}) {
  const access = useAccess();
  const [editing, setEditing] = useState<Relation | null>(null);
  const relevant = useMemo(
    () =>
      entities.filter(
        (e) =>
          e.type === 'character' ||
          relations.some((r) => r.sourceId === e.id || r.targetId === e.id),
      ),
    [entities, relations],
  );
  const layout = useMemo(
    () =>
      layoutClues(
        relevant.map((e) => e.id),
        relations.map((r) => ({ id: r.id, source: r.sourceId, target: r.targetId })),
        240,
        106,
      ),
    [relevant, relations],
  );
  const initialNodes = useMemo(
    () =>
      relevant.map((e, i) => ({
        id: e.id,
        position: e.graphPosition ?? layout.positions[e.id],
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        draggable: access.update(e.type === 'character' ? 'characters' : 'lore', e),
        data: {
          label: (
            <div className="relation-node">
              <div className={`avatar avatar-${i % 4}`}>
                {e.portrait ? <img src={e.portrait} alt="" /> : e.name.slice(0, 1)}
              </div>
              <div>
                <strong className="nodrag">
                  <EntityLink entity={e} onOpen={onOpen} />
                </strong>
                <small>{getEntityTypeLabel(world, e.type)}</small>
                <p>{e.summary || '双击打开档案'}</p>
              </div>
            </div>
          ),
        },
        style: {
          width: 240,
          height: 106,
          padding: 13,
          border: '1px solid var(--line)',
          borderRadius: 10,
          background: 'var(--paper)',
        },
      })),
    [relevant, layout, world, access.actor],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);
  const lanes = useMemo(
    () =>
      connectionLanes(
        relations.map((r) => ({ id: r.id, source: r.sourceId, target: r.targetId })),
        106,
      ),
    [relations],
  );
  const edges = useMemo(
    () =>
      relations.map((r) => ({
        id: r.id,
        source: r.sourceId,
        target: r.targetId,
        label: r.label,
        type: 'clue',
        data: { route: layout.routes[r.id], lane: lanes[r.id] },
        style: {
          stroke: edgeColors[r.kind],
          strokeWidth: 1.7,
          strokeDasharray: r.kind === 'enemy' ? '5 4' : undefined,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColors[r.kind] },
        labelStyle: { fontSize: 12, fill: '#59665d' },
        labelBgStyle: { fill: '#f6f6f0' },
      })),
    [relations, layout, lanes],
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PEOPLE & CONNECTIONS</div>
          <h1>人物关系</h1>
          <p>每一段关系，都是一个故事的起点。</p>
        </div>
        <button
          className="btn primary"
          disabled={!access.create('relations')}
          onClick={() =>
            setEditing({
              id: makeId('rel'),
              worldId,
              sourceId: entities[0]?.id || '',
              targetId: entities[1]?.id || '',
              label: '',
              description: '',
              kind: 'ally',
            })
          }
        >
          <Plus size={16} /> 添加关系
        </button>
      </div>
      <div className="graph-shell relation-graph">
        <div className="graph-top">
          <span>
            <Users size={15} /> {relevant.length} 个角色与势力 · {relations.length} 段关系
          </span>
          <button
            className="text-btn"
            disabled={
              !relevant.every((e) =>
                access.update(e.type === 'character' ? 'characters' : 'lore', e),
              )
            }
            onClick={() => onPositions(layout.positions)}
          >
            <RotateCcw size={14} /> 整理线索布局
          </button>
        </div>
        {nodes.length ? (
          <ClueLabelProvider
            nodes={nodes}
            onOpen={(id) => setEditing(relations.find((relation) => relation.id === id) ?? null)}
          >
            <ReactFlow
              nodes={nodes}
              edges={edges}
              edgeTypes={clueEdgeTypes}
              onNodesChange={onNodesChange}
              onNodeDragStop={(_, node) => onPositions({ [node.id]: node.position })}
              onNodeDoubleClick={(_, node) => onOpen(node.id)}
              onEdgeClick={(_, edge) => setEditing(relations.find((r) => r.id === edge.id)!)}
              fitView
              fitViewOptions={{ padding: 0.35 }}
              minZoom={0.06}
              maxZoom={1.8}
            >
              <Background color="#d8ddd4" gap={24} size={1} />
              <Controls showInteractive={false} />
              <MiniMap nodeColor="#6b8979" maskColor="#f6f5ef99" />
            </ReactFlow>
          </ClueLabelProvider>
        ) : (
          <Empty title="人物们还未相遇" description="先在角色档案中创建人物，再为他们建立关系。" />
        )}
        <div className="graph-legend">
          {Object.entries(relationLabels).map(([k, v]) => (
            <span key={k}>
              <i style={{ background: edgeColors[k as Relation['kind']] }} />
              {v}
            </span>
          ))}
        </div>
      </div>
      {editing && (
        <Modal
          title={relations.some((r) => r.id === editing.id) ? '编辑人物关系' : '建立人物关系'}
          onClose={() => setEditing(null)}
        >
          <div className="form-stack">
            <RecordPublication
              module="relations"
              record={editing}
              onChange={(visibility) => setEditing({ ...editing, visibility })}
            />
            <fieldset
              className="permission-fieldset"
              disabled={
                relations.some((r) => r.id === editing.id)
                  ? !access.update('relations', editing)
                  : !access.create('relations')
              }
            >
              <div className="two-cols">
                <label className="field">
                  起点
                  <select
                    value={editing.sourceId}
                    onChange={(e) => setEditing({ ...editing, sourceId: e.target.value })}
                  >
                    {entities.map((e) => (
                      <option value={e.id} key={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  终点
                  <select
                    value={editing.targetId}
                    onChange={(e) => setEditing({ ...editing, targetId: e.target.value })}
                  >
                    {entities
                      .filter((e) => e.id !== editing.sourceId)
                      .map((e) => (
                        <option value={e.id} key={e.id}>
                          {e.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <label className="field">
                关系名称
                <input
                  value={editing.label}
                  onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                  placeholder="例如：旧日战友、秘密盟约"
                />
              </label>
              <label className="field">
                关系类型
                <select
                  value={editing.kind}
                  onChange={(e) =>
                    setEditing({ ...editing, kind: e.target.value as Relation['kind'] })
                  }
                >
                  {Object.entries(relationLabels).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                关系说明
                <textarea
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  rows={3}
                />
              </label>
            </fieldset>
            <div className="modal-actions">
              {relations.some((r) => r.id === editing.id) && (
                <button
                  className="text-btn danger"
                  disabled={!access.remove('relations', editing)}
                  onClick={() => {
                    onChange(relations.filter((r) => r.id !== editing.id));
                    setEditing(null);
                  }}
                >
                  <Trash2 size={14} />{' '}
                  {access.remove('relations', editing) ? '删除关系' : '无删除权限'}
                </button>
              )}
              <button
                className="btn primary"
                disabled={
                  (relations.some((r) => r.id === editing.id)
                    ? !access.update('relations', editing)
                    : !access.create('relations')) ||
                  !editing.label.trim() ||
                  !editing.sourceId ||
                  !editing.targetId ||
                  editing.sourceId === editing.targetId
                }
                onClick={() => {
                  onChange([...relations.filter((r) => r.id !== editing.id), editing]);
                  setEditing(null);
                }}
              >
                保存关系
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

const kindLabels = { start: '故事起点', scene: '剧情场景', choice: '分支选择', ending: '结局' };
export function PlotBoard({
  plots,
  variables,
  entities,
  worldId,
  onChange,
  onVariables,
  onOpen,
}: {
  plots: Plot[];
  variables: StateVariable[];
  entities: Entity[];
  worldId: string;
  onChange: (plots: Plot[]) => void;
  onVariables: (variables: StateVariable[]) => void;
  onOpen: (id: string) => void;
}) {
  const [activeId, setActiveId] = useState(plots[0]?.id || '');
  const [selectedId, setSelectedId] = useState('');
  const [newPlot, setNewPlot] = useState(false);
  const [name, setName] = useState('');
  const [showVars, setShowVars] = useState(false);
  const [notice, setNotice] = useState('');
  const [edgeId, setEdgeId] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const access = useAccess();
  const plot = plots.find((p) => p.id === activeId) || plots[0];
  const writable = !!plot && access.update('plots', plot);
  const layout = useMemo(
    () => layoutClues(plot?.nodes.map((n) => n.id) ?? [], plot?.edges ?? [], 260, 192),
    [plot],
  );
  const selected = plot?.nodes.find((n) => n.id === selectedId);
  const selectedEdge = plot?.edges.find((e) => e.id === edgeId);
  const setPlot = (next: Plot) => onChange(plots.map((p) => (p.id === next.id ? next : p)));
  const changeNode = (patch: Partial<PlotNode>) => {
    if (plot && selected)
      setPlot({
        ...plot,
        nodes: plot.nodes.map((n) => (n.id === selected.id ? { ...n, ...patch } : n)),
      });
  };
  const connect = (c: Connection) => {
    if (
      plot &&
      c.source &&
      c.target &&
      c.source !== c.target &&
      !plot.edges.some((e) => e.source === c.source && e.target === c.target)
    )
      setPlot({
        ...plot,
        edges: [
          ...plot.edges,
          { id: makeId('edge'), source: c.source, target: c.target, label: '后续剧情' },
        ],
      });
  };
  const addNode = () => {
    if (!plot) return;
    const node: PlotNode = {
      id: makeId('node'),
      title: '新的剧情场景',
      summary: '',
      x: 80 + (plot.nodes.length % 3) * 310,
      y: 80 + Math.floor(plot.nodes.length / 3) * 210,
      kind: plot.nodes.length ? 'scene' : 'start',
      status: 'locked',
      entityIds: [],
      conditions: [],
      conditionMode: 'all',
      effects: [],
    };
    setPlot({ ...plot, nodes: [...plot.nodes, node] });
    setSelectedId(node.id);
    setNotice('');
  };
  const initialNodes: Node[] = useMemo(
    () =>
      plot?.nodes.map((n) => {
        const ready = availability(n, plot, variables).ready;
        return {
          id: n.id,
          position: plot.layoutVersion ? { x: n.x, y: n.y } : layout.positions[n.id],
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
          draggable: writable,
          connectable: writable,
          data: {
            label: (
              <div
                className={`plot-node ${n.status === 'completed' ? 'completed' : ready ? 'ready' : 'locked'}`}
              >
                <div className="plot-node-top">
                  <span>{kindLabels[n.kind]}</span>
                  {n.status === 'completed' ? (
                    <Check size={14} />
                  ) : ready ? (
                    <Play size={13} />
                  ) : (
                    <LockKeyhole size={13} />
                  )}
                </div>
                <strong>{n.title}</strong>
                <p>{n.summary || '添加场景描述与触发条件'}</p>
                <footer>
                  <span>{n.conditions.length} 个条件</span>
                  <span>
                    {n.status === 'completed' ? '已完成' : ready ? '可以触发' : '尚未解锁'}
                  </span>
                </footer>
              </div>
            ),
          },
          style: {
            width: 260,
            padding: 0,
            border: selectedId === n.id ? '2px solid var(--green)' : '1px solid var(--line)',
            borderRadius: 10,
            background: 'var(--paper)',
          },
        };
      }) || [],
    [plot, variables, selectedId, layout, writable],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);
  const edges = useMemo(
    () =>
      plot?.edges.map((e) => ({
        ...e,
        type: 'clue',
        data: { route: layout.routes[e.id] },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#82998c' },
        style: { stroke: '#82998c', strokeWidth: 1.7 },
      })) ?? [],
    [plot, layout],
  );
  const advance = () => {
    if (!plot || !selected) return;
    const check = availability(selected, plot, variables);
    if (!check.ready) {
      setNotice(check.reasons.join('；'));
      return;
    }
    let next = [...variables];
    for (const effect of selected.effects) {
      const index = next.findIndex((v) => v.name === effect.variable);
      if (index >= 0) next[index] = { ...next[index], value: effect.value };
      else next.push({ id: makeId('var'), worldId, name: effect.variable, value: effect.value });
    }
    onVariables(next);
    changeNode({ status: 'completed' });
    setNotice(`「${selected.title}」已完成，${selected.effects.length} 个变量已更新`);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">STORY ARCHITECT</div>
          <h1>剧情编织</h1>
          <p>给故事留下方向，也给玩家留下选择。</p>
        </div>
        <div className="button-row">
          <button className="btn" onClick={() => setShowVars(true)}>
            <SlidersHorizontal size={15} /> 世界变量
          </button>
          <button
            className="btn primary"
            disabled={!access.create('plots')}
            onClick={() => {
              setName('');
              if (access.create('plots')) setNewPlot(true);
            }}
          >
            <Plus size={16} /> 新建剧情
          </button>
        </div>
      </div>
      {plot ? (
        <>
          <div className="plot-toolbar">
            <RecordPublication
              module="plots"
              record={plot}
              onChange={(visibility) => setPlot({ ...plot, visibility })}
            />
            <select
              aria-label="选择剧情"
              value={plot.id}
              onChange={(e) => {
                setActiveId(e.target.value);
                setSelectedId('');
              }}
            >
              {plots.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="muted">
              {plot.nodes.filter((n) => n.status === 'completed').length} / {plot.nodes.length}{' '}
              个场景已推进
            </span>
            <div className="spacer" />
            <button className="text-btn" disabled={!writable} onClick={() => setConfirmReset(true)}>
              <RotateCcw size={14} /> 重置进度
            </button>
            <button
              className="btn"
              disabled={!writable}
              onClick={() =>
                setPlot({
                  ...plot,
                  layoutVersion: 1,
                  nodes: plot.nodes.map((n) => ({ ...n, ...layout.positions[n.id] })),
                })
              }
            >
              <RotateCcw size={14} /> 整理线索布局
            </button>
            <button className="btn" disabled={!writable} onClick={addNode}>
              <Plus size={15} /> 添加场景
            </button>
          </div>
          <div className={`plot-layout ${selected ? 'has-selection' : ''}`}>
            <div className="graph-shell plot-graph">
              <ClueLabelProvider
                key={plot.id}
                nodes={nodes}
                onOpen={(id) => {
                  if (writable) setEdgeId(id);
                }}
              >
                <ReactFlow
                  key={plot.id}
                  nodes={nodes}
                  edges={edges}
                  edgeTypes={clueEdgeTypes}
                  onNodesChange={onNodesChange}
                  onNodeClick={(_, node) => {
                    setSelectedId(node.id);
                    setNotice('');
                  }}
                  onNodeDragStop={(_, node) => {
                    setPlot({
                      ...plot,
                      layoutVersion: 1,
                      nodes: plot.nodes.map((n) => ({
                        ...n,
                        ...(n.id === node.id
                          ? node.position
                          : plot.layoutVersion
                            ? { x: n.x, y: n.y }
                            : layout.positions[n.id]),
                      })),
                    });
                  }}
                  onConnect={writable ? connect : undefined}
                  onEdgeClick={(_, e) => {
                    if (writable) setEdgeId(e.id);
                  }}
                  onPaneClick={() => setSelectedId('')}
                  fitView
                  fitViewOptions={{ padding: 0.18 }}
                  minZoom={0.06}
                  maxZoom={1.8}
                >
                  <Background gap={24} color="#d7ddd3" size={1} />
                  <Controls showInteractive={false} />
                </ReactFlow>
              </ClueLabelProvider>
              <div className="canvas-help">拖动节点底部圆点连接场景 · 选择场景编辑条件</div>
            </div>
            {selected && (
              <aside className="node-editor">
                <div className="section-top">
                  <h3>场景设置</h3>
                  <button
                    className="icon-btn"
                    aria-label="关闭场景设置"
                    onClick={() => setSelectedId('')}
                  >
                    <X size={16} />
                  </button>
                </div>
                <fieldset className="permission-fieldset" disabled={!writable}>
                  <label className="field">
                    场景名称
                    <input
                      key={selected.id}
                      defaultValue={selected.title}
                      onBlur={(e) => {
                        if (e.target.value.trim()) changeNode({ title: e.target.value.trim() });
                        else e.target.value = selected.title;
                      }}
                    />
                  </label>
                  <label className="field">
                    节点类型
                    <select
                      value={selected.kind}
                      onChange={(e) => changeNode({ kind: e.target.value as PlotNode['kind'] })}
                    >
                      {Object.entries(kindLabels).map(([k, v]) => (
                        <option value={k} key={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    场景描述
                    <textarea
                      value={selected.summary}
                      rows={3}
                      onChange={(e) => changeNode({ summary: e.target.value })}
                    />
                  </label>
                  <div className="section-top">
                    <h4>触发条件</h4>
                    <button
                      className="icon-btn"
                      aria-label="添加条件"
                      disabled={!variables.length}
                      onClick={() =>
                        changeNode({
                          conditions: [
                            ...selected.conditions,
                            { variable: variables[0].name, operator: 'eq', value: 'true' },
                          ],
                        })
                      }
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                  <select
                    aria-label="条件组合方式"
                    value={selected.conditionMode}
                    onChange={(e) => changeNode({ conditionMode: e.target.value as 'all' | 'any' })}
                  >
                    <option value="all">满足全部条件（AND）</option>
                    <option value="any">满足任一条件（OR）</option>
                  </select>
                  {selected.conditions.map((c, i) => (
                    <div className="condition-row" key={i}>
                      <select
                        aria-label="条件变量"
                        value={c.variable}
                        onChange={(e) =>
                          changeNode({
                            conditions: selected.conditions.map((v, j) =>
                              j === i ? { ...v, variable: e.target.value } : v,
                            ),
                          })
                        }
                      >
                        {variables.map((v) => (
                          <option key={v.id} value={v.name}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="比较运算"
                        value={c.operator}
                        onChange={(e) =>
                          changeNode({
                            conditions: selected.conditions.map((v, j) =>
                              j === i
                                ? { ...v, operator: e.target.value as Condition['operator'] }
                                : v,
                            ),
                          })
                        }
                      >
                        {Object.entries({
                          eq: '等于',
                          neq: '不等于',
                          gt: '大于',
                          gte: '大于等于',
                          lt: '小于',
                          lte: '小于等于',
                          contains: '包含',
                        }).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="条件值"
                        value={c.value}
                        onChange={(e) =>
                          changeNode({
                            conditions: selected.conditions.map((v, j) =>
                              j === i ? { ...v, value: e.target.value } : v,
                            ),
                          })
                        }
                      />
                      <button
                        className="icon-btn"
                        aria-label="删除条件"
                        onClick={() =>
                          changeNode({ conditions: selected.conditions.filter((_, j) => j !== i) })
                        }
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  {!selected.conditions.length && (
                    <small className="muted">无额外条件，前置场景完成后即可触发。</small>
                  )}
                  <div className="section-top">
                    <h4>完成后的变量变更</h4>
                    <button
                      className="icon-btn"
                      aria-label="添加变量变更"
                      disabled={!variables.length}
                      onClick={() =>
                        changeNode({
                          effects: [
                            ...selected.effects,
                            { variable: variables[0].name, value: 'true' },
                          ],
                        })
                      }
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                  {selected.effects.map((e, i) => (
                    <div className="effect-row" key={i}>
                      <select
                        aria-label="变更变量"
                        value={e.variable}
                        onChange={(ev) =>
                          changeNode({
                            effects: selected.effects.map((v, j) =>
                              j === i ? { ...v, variable: ev.target.value } : v,
                            ),
                          })
                        }
                      >
                        {variables.map((v) => (
                          <option key={v.id} value={v.name}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                      <span>=</span>
                      <input
                        aria-label="变更值"
                        value={e.value}
                        onChange={(ev) =>
                          changeNode({
                            effects: selected.effects.map((v, j) =>
                              j === i ? { ...v, value: ev.target.value } : v,
                            ),
                          })
                        }
                      />
                      <button
                        className="icon-btn"
                        aria-label="删除变量变更"
                        onClick={() =>
                          changeNode({ effects: selected.effects.filter((_, j) => j !== i) })
                        }
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  <datalist id="world-variables">
                    {variables.map((v) => (
                      <option key={v.id} value={v.name} />
                    ))}
                  </datalist>
                  <label className="field">
                    关联设定
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value && !selected.entityIds.includes(e.target.value))
                          changeNode({ entityIds: [...selected.entityIds, e.target.value] });
                      }}
                    >
                      <option value="">添加关联人物或地点…</option>
                      {entities.map((e) => (
                        <option value={e.id} key={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="node-links">
                    {selected.entityIds.map((id) => (
                      <span key={id}>
                        <EntityLink entity={entities.find((e) => e.id === id)} onOpen={onOpen} />
                        <button
                          className="icon-btn"
                          aria-label="移除关联"
                          onClick={() =>
                            changeNode({ entityIds: selected.entityIds.filter((i) => i !== id) })
                          }
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div
                    className={`trigger-status ${availability(selected, plot, variables).ready ? 'ready' : ''}`}
                  >
                    {selected.status === 'completed'
                      ? '此场景已完成'
                      : availability(selected, plot, variables).ready
                        ? '所有条件满足，可以推进'
                        : availability(selected, plot, variables).reasons.join('；')}
                  </div>
                  <button
                    className="btn primary full-width"
                    disabled={
                      !writable ||
                      selected.effects.some((e) => {
                        const variable = variables.find((v) => v.name === e.variable);
                        return !variable || !access.update('variables', variable);
                      }) ||
                      !availability(selected, plot, variables).ready ||
                      selected.effects.some((e) => !e.variable.trim())
                    }
                    onClick={advance}
                  >
                    <Play size={14} /> GM 确认推进
                  </button>
                  {notice && (
                    <p className="notice" role="status">
                      {notice}
                    </p>
                  )}
                  <button
                    className="text-btn danger"
                    onClick={() => {
                      setPlot({
                        ...plot,
                        nodes: plot.nodes.filter((n) => n.id !== selected.id),
                        edges: plot.edges.filter(
                          (e) => e.source !== selected.id && e.target !== selected.id,
                        ),
                      });
                      setSelectedId('');
                    }}
                  >
                    <Trash2 size={13} /> 删除场景
                  </button>
                </fieldset>
              </aside>
            )}
          </div>
        </>
      ) : (
        <Empty
          title="编织你的第一条故事线"
          description="从一个场景开始，加入选择、条件和结局。"
          action={
            <button
              className="btn primary"
              disabled={!access.create('plots')}
              onClick={() => setNewPlot(true)}
            >
              新建剧情
            </button>
          }
        />
      )}
      {newPlot && (
        <Modal title="创建剧情路线" onClose={() => setNewPlot(false)}>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              const id = makeId('plot');
              onChange([
                ...plots,
                {
                  id,
                  worldId,
                  name: name.trim(),
                  summary: '',
                  nodes: [],
                  edges: [],
                  createdBy: access.actor.id,
                },
              ]);
              setActiveId(id);
              setNewPlot(false);
            }}
          >
            <label className="field">
              剧情名称
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：沉没王国的回声"
                required
              />
            </label>
            <button className="btn primary" disabled={!name.trim()}>
              创建剧情
            </button>
          </form>
        </Modal>
      )}
      {showVars && (
        <VariablesDialog
          variables={variables}
          worldId={worldId}
          onSave={(next) => {
            onVariables(next);
            setShowVars(false);
          }}
          onClose={() => setShowVars(false)}
        />
      )}
      {selectedEdge && plot && (
        <Modal title="编辑剧情路线" onClose={() => setEdgeId('')}>
          <div className="form-stack">
            <label className="field">
              路线说明
              <input
                value={selectedEdge.label}
                onChange={(e) =>
                  setPlot({
                    ...plot,
                    edges: plot.edges.map((v) =>
                      v.id === edgeId ? { ...v, label: e.target.value } : v,
                    ),
                  })
                }
              />
            </label>
            <button
              className="btn danger"
              onClick={() => {
                setPlot({ ...plot, edges: plot.edges.filter((e) => e.id !== edgeId) });
                setEdgeId('');
              }}
            >
              删除连接
            </button>
          </div>
        </Modal>
      )}
      {confirmReset && plot && (
        <Modal title="重置剧情进度" onClose={() => setConfirmReset(false)}>
          <div className="form-stack">
            <p>
              将所有场景恢复为未完成。世界变量由多个剧情共享，不会自动回滚，请在「世界变量」中按需修改。
            </p>
            <button
              className="btn primary"
              onClick={() => {
                setPlot({ ...plot, nodes: plot.nodes.map((n) => ({ ...n, status: 'locked' })) });
                setConfirmReset(false);
              }}
            >
              确认重置进度
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function VariablesDialog({
  variables,
  worldId,
  onSave,
  onClose,
}: {
  variables: StateVariable[];
  worldId: string;
  onSave: (variables: StateVariable[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(variables));
  const access = useAccess();
  const valid =
    draft.every((v) => v.name.trim()) &&
    new Set(draft.map((v) => v.name.trim())).size === draft.length;
  return (
    <Modal title="世界变量 · 剧情状态" onClose={onClose}>
      <div className="form-stack">
        <p className="muted">
          变量在当前世界内共享。更名会同步更新条件和效果；删除变量将移除引用它的规则。数值比较使用数字，等于按文本匹配。
        </p>
        {draft.map((v, i) => (
          <div className="variable-row" key={v.id}>
            <input
              aria-label="变量名称"
              disabled={!access.update('variables', v)}
              value={v.name}
              onChange={(e) =>
                setDraft(
                  draft.map((item, j) => (j === i ? { ...item, name: e.target.value } : item)),
                )
              }
            />
            <input
              aria-label={v.name + '的值'}
              disabled={!access.update('variables', v)}
              value={v.value}
              onChange={(e) =>
                setDraft(
                  draft.map((item, j) => (j === i ? { ...item, value: e.target.value } : item)),
                )
              }
            />
            <button
              className="icon-btn"
              aria-label="删除变量"
              disabled={!access.remove('variables', v)}
              onClick={() => setDraft(draft.filter((item) => item.id !== v.id))}
            >
              <Trash2 size={15} />
            </button>
            <RecordPublication
              module="variables"
              record={v}
              onChange={(visibility) =>
                setDraft(draft.map((item) => (item.id === v.id ? { ...item, visibility } : item)))
              }
            />
          </div>
        ))}
        <button
          className="btn"
          disabled={!access.create('variables')}
          onClick={() => {
            let n = draft.length + 1;
            while (draft.some((v) => v.name === '变量' + n)) n++;
            setDraft([
              ...draft,
              {
                id: makeId('var'),
                worldId,
                name: '变量' + n,
                value: '0',
                createdBy: access.actor.id,
              },
            ]);
          }}
        >
          <Plus size={15} /> 添加变量
        </button>
        {!valid && <p className="inline-error">变量名不能为空或重复。</p>}
        <button
          className="btn primary"
          disabled={!valid}
          onClick={() => onSave(draft.map((v) => ({ ...v, name: v.name.trim() })))}
        >
          保存世界变量
        </button>
      </div>
    </Modal>
  );
}
