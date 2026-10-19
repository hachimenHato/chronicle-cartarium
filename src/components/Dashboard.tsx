import { Activity, BookOpen, Map, Users, GitBranch, CalendarDays, ArrowRight } from 'lucide-react';
import type { Workspace, EntityType } from '../../shared/model';
import { getEntityTypes } from '../../shared/entity-types';
import { getEntityTemplate } from '../../shared/entity-templates';
export function Dashboard({
  data,
  worldId,
  status,
  onNavigate,
  onType,
}: {
  data: Workspace;
  worldId: string;
  status: string;
  onNavigate: (view: string) => void;
  onType?: (type: EntityType) => void;
}) {
  const entities = data.entities.filter((e) => e.worldId === worldId);
  const world = data.worlds.find((w) => w.id === worldId);
  const maps = data.maps.filter((m) => m.worldId === worldId);
  const plots = data.plots.filter((p) => p.worldId === worldId);
  const sessions = data.sessions.filter((s) => s.worldId === worldId);
  const stats = [
    { label: '设定条目', value: entities.length, icon: BookOpen, view: 'lore' },
    {
      label: '角色人物',
      value: entities.filter((e) => e.type === 'character').length,
      icon: Users,
      view: 'characters',
    },
    { label: '地图与区域', value: maps.length, icon: Map, view: 'atlas' },
    {
      label: '剧情场景',
      value: plots.reduce((n, p) => n + p.nodes.length, 0),
      icon: GitBranch,
      view: 'plots',
    },
  ];
  const incomplete = entities.filter((e) => e.status === 'draft');
  const linked = maps.flatMap((m) => m.pins).filter((p) => p.entityId || p.childMapId).length;
  return (
    <section className="dashboard-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">A WORLD AT A GLANCE</div>
          <h1>创作仪表盘</h1>
          <p>看看世界已经长到哪里，下一次冒险还缺什么。</p>
        </div>
        <Activity size={30} />
      </div>
      <div className="dashboard-stats">
        {stats.map(({ label, value, icon: Icon, view }) => (
          <button key={label} aria-label={`${value} ${label}`} onClick={() => onNavigate(view)}>
            <Icon size={23} />
            <strong>{value}</strong>
            <span>{label}</span>
            <ArrowRight size={15} />
          </button>
        ))}
      </div>
      <div className="dashboard-grid">
        <article>
          <h2>设定查漏</h2>
          <p className="muted">
            按当前模板统计未填写字段与草稿，帮助安排下一步创作；这些数量不评价内容质量。
          </p>
          <div className="coverage-list">
            {getEntityTypes(world).map(({ id: type, name: label }) => {
              const items = entities.filter((e) => e.type === type);
              const count = items.length;
              const drafts = items.filter((e) => e.status === 'draft').length;
              const empty = items.reduce(
                (n, e) =>
                  n +
                  getEntityTemplate(world, type).filter((key) => !e.attributes[key]?.trim()).length,
                0,
              );
              return (
                <button
                  className="coverage-check"
                  key={type}
                  onClick={() =>
                    onType ? onType(type) : onNavigate(type === 'character' ? 'characters' : 'lore')
                  }
                >
                  <span>{label}</span>
                  <strong>{count} 条</strong>
                  <small>{count === 0 ? '尚未建立' : `${drafts} 草稿 · ${empty} 未填字段`}</small>
                </button>
              );
            })}
          </div>
        </article>
        <article>
          <h2>备团与待办</h2>
          <div className="dashboard-health">
            <span>保存状态</span>
            <strong>
              {status === 'saved'
                ? '已保存'
                : status === 'pending'
                  ? '等待保存'
                  : status === 'saving'
                    ? '保存中'
                    : '需要处理保存问题'}
            </strong>
          </div>
          <div className="dashboard-health">
            <span>草稿条目</span>
            <strong>{incomplete.length}</strong>
          </div>
          <div className="dashboard-health">
            <span>关联地图标记</span>
            <strong>
              {linked} / {maps.reduce((n, m) => n + m.pins.length, 0)}
            </strong>
          </div>
          <div className="dashboard-health">
            <span>待准备团务</span>
            <strong>{sessions.filter((s) => s.status === 'planned').length}</strong>
          </div>
          <h3>接下来的场次</h3>
          {sessions
            .filter((s) => s.status === 'planned')
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(0, 4)
            .map((s) => (
              <button
                className="dashboard-session"
                key={s.id}
                onClick={() => onNavigate('journal')}
              >
                <CalendarDays size={16} />
                <span>
                  {s.title}
                  <small>{s.date}</small>
                </span>
                <ArrowRight size={14} />
              </button>
            ))}
          {!sessions.some((s) => s.status === 'planned') && (
            <p className="muted">还没有备团计划，可以先安排一场开场冒险。</p>
          )}
          <button className="btn" onClick={() => onNavigate('guide')}>
            查看创作指引
          </button>
        </article>
      </div>
    </section>
  );
}
