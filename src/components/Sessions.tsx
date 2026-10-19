import { useState } from 'react';
import { CalendarDays, Check, Plus, Save, Trash2 } from 'lucide-react';
import { makeId, type Entity, type Session } from '../../shared/model';
import { Empty, WikiContent } from './Common';
import { useUnsavedDraft } from '../lib/useUnsavedDraft';
import { useAccess } from './AccessContext';
import { RecordPublication } from './RecordPublication';
export default function Sessions({
  sessions,
  entities,
  worldId,
  onChange,
  onOpen,
  onDirty,
}: {
  sessions: Session[];
  entities: Entity[];
  worldId: string;
  onChange: (sessions: Session[]) => void;
  onOpen: (id: string) => void;
  onDirty: (value: boolean) => void;
}) {
  const access = useAccess();
  const [selected, setSelected] = useState(sessions[0]?.id || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState(false);
  const session = sessions.find((s) => s.id === selected) || sessions[0];
  const dirty = editing && !!draft && JSON.stringify(draft) !== JSON.stringify(session);
  useUnsavedDraft(dirty, onDirty);
  const begin = (s: Session) => {
    setDraft(s);
    setEditing(true);
    setDeleting(false);
  };
  const create = () => {
    if (dirty && !window.confirm('这篇日志还有未保存的修改。放弃修改并新建记录？')) return;
    const s: Session = {
      id: makeId('session'),
      worldId,
      title: '新的冒险记录',
      date: new Date().toISOString().slice(0, 10),
      status: 'planned',
      content: '## 开场与目标\n\n## 场景准备\n\n## 玩家的选择\n\n## 待跟进的线索\n',
      createdBy: access.actor.id,
    };
    onChange([...sessions, s]);
    setSelected(s.id);
    begin(s);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CAMPAIGN JOURNAL</div>
          <h1>团务日志</h1>
          <p>记住桌边发生的故事，和下一次冒险的伏笔。</p>
        </div>
        <button className="btn primary" disabled={!access.create('sessions')} onClick={create}>
          <Plus size={16} /> 新建记录
        </button>
      </div>
      {!session ? (
        <Empty
          title="第一场冒险尚未开始"
          description="记录跑团准备、玩家选择和待跟进的线索。"
          action={
            <button className="btn" disabled={!access.create('sessions')} onClick={create}>
              创建第一篇日志
            </button>
          }
        />
      ) : (
        <div className="journal-layout">
          <aside className="journal-list">
            {[...sessions]
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((s) => (
                <button
                  className={`journal-item ${session.id === s.id ? 'active' : ''}`}
                  key={s.id}
                  onClick={() => {
                    if (dirty && !window.confirm('这篇日志还有未保存的修改。放弃修改并切换记录？'))
                      return;
                    setSelected(s.id);
                    setEditing(false);
                    setDeleting(false);
                  }}
                >
                  <small>
                    <CalendarDays size={13} /> {s.date}
                  </small>
                  <strong>{s.title}</strong>
                  <span>{s.status === 'completed' ? '已结束' : '计划中'}</span>
                </button>
              ))}
          </aside>
          <article className="article-sheet">
            <RecordPublication
              module="sessions"
              record={session}
              onChange={(visibility) => {
                onChange(sessions.map((s) => (s.id === session.id ? { ...s, visibility } : s)));
                if (draft?.id === session.id) setDraft({ ...draft, visibility });
              }}
            />
            {editing && draft ? (
              <>
                <label className="field">
                  日志标题
                  <input
                    className="title-input"
                    value={draft.title}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  />
                </label>
                <div className="two-cols">
                  <label className="field">
                    日期
                    <input
                      type="date"
                      value={draft.date}
                      onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    状态
                    <select
                      value={draft.status}
                      onChange={(e) =>
                        setDraft({ ...draft, status: e.target.value as Session['status'] })
                      }
                    >
                      <option value="planned">计划中</option>
                      <option value="completed">已结束</option>
                    </select>
                  </label>
                </div>
                <div className="editor-hint">支持 Markdown 和 [[设定名称]] 关联。</div>
                <textarea
                  className="markdown-editor"
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                />
                <button
                  className="btn primary"
                  disabled={!draft.title.trim() || !draft.date}
                  onClick={() => {
                    onChange(sessions.map((s) => (s.id === draft.id ? draft : s)));
                    setEditing(false);
                  }}
                >
                  <Save size={15} /> 保存日志
                </button>
              </>
            ) : (
              <>
                <div className="section-top">
                  <span className="eyebrow">SESSION NOTES · {session.date}</span>
                  <button
                    className="btn"
                    disabled={!access.update('sessions', session)}
                    onClick={() => begin(session)}
                  >
                    编辑日志
                  </button>
                </div>
                <h1>{session.title}</h1>
                <WikiContent content={session.content} entities={entities} onOpen={onOpen} />
                {deleting ? (
                  <div className="inline-form">
                    <span>确认删除这篇日志？</span>
                    <button
                      className="btn danger"
                      onClick={() => {
                        onChange(sessions.filter((s) => s.id !== session.id));
                        setDeleting(false);
                      }}
                    >
                      确认删除
                    </button>
                    <button className="btn" onClick={() => setDeleting(false)}>
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    className="text-btn danger"
                    disabled={!access.remove('sessions', session)}
                    onClick={() => setDeleting(true)}
                  >
                    <Trash2 size={14} /> 删除日志
                  </button>
                )}
              </>
            )}
          </article>
        </div>
      )}
    </>
  );
}
