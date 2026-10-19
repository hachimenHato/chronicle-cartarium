import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, LockKeyhole, UnlockKeyhole } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { type Entity, type World } from '../../shared/model';
import { getEntityTypeLabel } from '../../shared/entity-types';
import {
  TOOLTIP_LOCK_MS,
  TOOLTIP_SHOW_MS,
  tooltipPosition,
  tooltipReducer,
  type TooltipAction,
  type TooltipEntry,
} from '../lib/entity-tooltip-state';
import './EntityTooltip.css';

interface TooltipContextValue {
  entries: TooltipEntry[];
  show: (id: string, entity: Entity, anchor: Element, parentId?: string) => void;
  enter: (id: string) => void;
  beginLock: (id: string) => void;
  leave: (id: string) => void;
}
const TooltipContext = createContext<TooltipContextValue | null>(null);
const ParentTooltipContext = createContext<string | undefined>(undefined);

/** Put one provider around the active world; entity summaries can then follow links in that world. */
export function EntityTooltipProvider({
  entities,
  onOpen,
  children,
  world,
}: {
  entities: Entity[];
  onOpen: (id: string) => void;
  children: ReactNode;
  world?: World;
}) {
  const [entries, setEntries] = useState<TooltipEntry[]>([]);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  const entriesRef = useRef(entries);
  const cards = useRef(new Map<string, HTMLElement>());
  const active = useRef(new Set<string>());
  const lockTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const closeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const startedAt = useRef(new Map<string, number>());
  const showTimers = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; parentId?: string }>(),
  );

  const update = useCallback((action: TooltipAction) => {
    if (action.type === 'clear') {
      for (const { timer } of showTimers.current.values()) clearTimeout(timer);
      showTimers.current.clear();
      active.current.clear();
    }
    const next = tooltipReducer(entriesRef.current, action);
    if (next === entriesRef.current) return;
    entriesRef.current = next;
    setEntries(next);
    const remaining = new Set(next.map((entry) => entry.id));
    for (const [id, pending] of showTimers.current) {
      if (pending.parentId && !remaining.has(pending.parentId)) {
        clearTimeout(pending.timer);
        showTimers.current.delete(id);
        active.current.delete(id);
      }
    }
    for (const timers of [lockTimers.current, closeTimers.current]) {
      for (const [id, timer] of timers) {
        if (!remaining.has(id)) {
          clearTimeout(timer);
          timers.delete(id);
        }
      }
    }
    for (const id of startedAt.current.keys()) {
      if (!remaining.has(id)) {
        startedAt.current.delete(id);
        active.current.delete(id);
      }
    }
  }, []);

  const enter = useCallback(
    (id: string) => {
      active.current.add(id);
      clearTimeout(closeTimers.current.get(id));
      closeTimers.current.delete(id);
      const entry = entriesRef.current.find((item) => item.id === id);
      if (!entry || entry.locked || lockTimers.current.has(id)) return;
      const began = startedAt.current.get(id) ?? performance.now();
      startedAt.current.set(id, began);
      const timer = setTimeout(
        () => {
          lockTimers.current.delete(id);
          if (active.current.has(id)) update({ type: 'lock', id });
        },
        Math.ceil(Math.max(0, TOOLTIP_LOCK_MS - (performance.now() - began))),
      );
      lockTimers.current.set(id, timer);
    },
    [update],
  );

  const beginLock = useCallback(
    (id: string) => {
      if (active.current.has(id)) enter(id);
    },
    [enter],
  );

  const leave = useCallback(
    (id: string) => {
      const pending = showTimers.current.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        showTimers.current.delete(id);
      }
      active.current.delete(id);
      clearTimeout(closeTimers.current.get(id));
      if (!entriesRef.current.some((entry) => entry.id === id && !entry.locked)) return;
      // A short bridge allows the pointer to cross the gap between a link and its preview.
      closeTimers.current.set(
        id,
        setTimeout(() => {
          closeTimers.current.delete(id);
          update({ type: 'leave', id });
        }, 120),
      );
    },
    [update],
  );

  const show = useCallback(
    (id: string, entity: Entity, anchor: Element, parentId?: string) => {
      if (entriesRef.current.some((entry) => entry.id === id)) {
        enter(id);
        return;
      }
      if (showTimers.current.has(id)) return;
      if (parentId && !entriesRef.current.some((entry) => entry.id === parentId && entry.locked))
        return;
      active.current.add(id);
      const timer = setTimeout(() => {
        showTimers.current.delete(id);
        if (!active.current.has(id) || !anchor.isConnected) return;
        const rect = anchor.getBoundingClientRect();
        update({
          type: 'show',
          entry: {
            id,
            entityId: entity.id,
            parentId,
            anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
            locked: false,
          },
        });
        // The card starts its lock timer only after its DOM has been mounted.
      }, TOOLTIP_SHOW_MS);
      showTimers.current.set(id, { timer, parentId });
    },
    [enter, update],
  );

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') update({ type: 'clear' });
    };
    const blur = () => {
      update({ type: 'clear' });
    };
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if ([...cards.current.values()].some((card) => card.contains(target))) return;
      update({ type: 'clear' });
    };
    const visibility = () => {
      if (document.hidden) blur();
    };
    const fullscreen = () => {
      update({ type: 'clear' });
      setPortalTarget(document.fullscreenElement);
    };
    window.addEventListener('keydown', key);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('fullscreenchange', fullscreen);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('fullscreenchange', fullscreen);
      document.removeEventListener('pointerdown', outside, true);
      for (const timers of [lockTimers.current, closeTimers.current]) {
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
      }
      for (const { timer } of showTimers.current.values()) clearTimeout(timer);
      showTimers.current.clear();
    };
  }, [update]);

  return (
    <TooltipContext.Provider value={{ entries, show, enter, beginLock, leave }}>
      {children}
      {entries.map((entry, index) => {
        const entity = entities.find((item) => item.id === entry.entityId);
        return entity
          ? createPortal(
              <ParentTooltipContext.Provider value={entry.id}>
                <TooltipCard
                  world={world}
                  entry={entry}
                  entity={entity}
                  entities={entities}
                  onOpen={onOpen}
                  order={index}
                  register={(element) => {
                    if (element) cards.current.set(entry.id, element);
                    else cards.current.delete(entry.id);
                  }}
                />
              </ParentTooltipContext.Provider>,
              portalTarget || document.fullscreenElement || document.body,
              entry.id,
            )
          : null;
      })}
    </TooltipContext.Provider>
  );
}

/** Works on buttons, text links and SVG groups; hover and keyboard focus use the same dwell lock. */
export function useEntityTooltip(entity?: Entity) {
  const context = useContext(TooltipContext);
  const parentId = useContext(ParentTooltipContext);
  const id = `entity-preview-${useId().replace(/:/g, '')}`;
  const anchor = useRef<Element | null>(null);
  const hovering = useRef(false);
  const focused = useRef(false);
  const [engaged, setEngaged] = useState(false);
  const { show, leave } = context ?? {};
  const parentLocked =
    !parentId || Boolean(context?.entries.some((entry) => entry.id === parentId && entry.locked));

  useEffect(() => {
    if (engaged && parentLocked && entity && anchor.current)
      show?.(id, entity, anchor.current, parentId);
  }, [engaged, parentLocked, entity, show, id, parentId]);

  useEffect(() => () => leave?.(id), [id, leave]);

  return {
    onMouseEnter: (event: MouseEvent<Element>) => {
      anchor.current = event.currentTarget;
      hovering.current = true;
      setEngaged(true);
      if (entity) show?.(id, entity, event.currentTarget, parentId);
    },
    onMouseLeave: () => {
      hovering.current = false;
      if (!focused.current) {
        setEngaged(false);
        leave?.(id);
      }
    },
    onFocus: (event: FocusEvent<Element>) => {
      anchor.current = event.currentTarget;
      focused.current = true;
      setEngaged(true);
      if (entity) show?.(id, entity, event.currentTarget, parentId);
    },
    onBlur: () => {
      focused.current = false;
      if (!hovering.current) {
        setEngaged(false);
        leave?.(id);
      }
    },
    'aria-describedby': context?.entries.some((entry) => entry.id === id) ? id : undefined,
  };
}

function PreviewLink({
  entity,
  onOpen,
  children,
}: {
  entity: Entity;
  onOpen: (id: string) => void;
  children: ReactNode;
}) {
  const binding = useEntityTooltip(entity);
  return (
    <button className="entity-link" {...binding} onClick={() => onOpen(entity.id)}>
      {children}
    </button>
  );
}

const PreviewText = memo(function PreviewText({
  content,
  entities,
  onOpen,
}: {
  content: string;
  entities: Entity[];
  onOpen: (id: string) => void;
}) {
  const markdown = content.replace(/\[\[([^\]]+)\]\]/g, (_, name: string) => {
    const entity = entities.find((item) => item.name === name.trim());
    return entity ? `[${name}](#entity-${entity.id})` : `${name}（未关联）`;
  });
  return (
    <ReactMarkdown
      components={{
        a: ({ href, children }) => {
          const entity = href?.startsWith('#entity-')
            ? entities.find((item) => item.id === href.slice(8))
            : undefined;
          return entity ? (
            <PreviewLink entity={entity} onOpen={onOpen}>
              {children}
            </PreviewLink>
          ) : (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        },
        img: () => null,
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
});

function TooltipCard({
  entry,
  entity,
  entities,
  onOpen,
  order,
  register,
  world,
}: {
  entry: TooltipEntry;
  entity: Entity;
  entities: Entity[];
  onOpen: (id: string) => void;
  order: number;
  register: (element: HTMLDivElement | null) => void;
  world?: World;
}) {
  const context = useContext(TooltipContext)!;
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: -9999, top: 0 });
  const startLock = context.beginLock;
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => startLock(entry.id));
    return () => cancelAnimationFrame(frame);
  }, [entry.id, startLock]);
  useLayoutEffect(() => {
    const positionCard = () => {
      if (!ref.current) return;
      const { width, height } = ref.current.getBoundingClientRect();
      setPosition(
        tooltipPosition(
          entry.anchor,
          { width, height },
          { width: window.innerWidth, height: window.innerHeight },
          !!entry.parentId,
        ),
      );
    };
    positionCard();
    const observer = new ResizeObserver(positionCard);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener('resize', positionCard);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', positionCard);
    };
  }, [entry.anchor, entry.parentId]);
  const excerpt = entity.content.slice(0, 640);
  return (
    <div
      id={entry.id}
      ref={(element) => {
        ref.current = element;
        register(element);
      }}
      className={`entity-preview ${entry.locked ? 'is-locked' : 'is-locking'}`}
      role="dialog"
      aria-label={`${entity.name}词条摘要`}
      data-entity-tooltip-root="true"
      data-locked={entry.locked}
      style={
        {
          ...position,
          zIndex: 1200 + order,
          '--tooltip-lock-duration': `${TOOLTIP_LOCK_MS}ms`,
        } as CSSProperties
      }
      onMouseEnter={() => context.enter(entry.id)}
      onMouseLeave={() => context.leave(entry.id)}
      onFocusCapture={() => context.enter(entry.id)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) context.leave(entry.id);
      }}
    >
      <header className="entity-preview-head">
        <div>
          <span className="entity-preview-type">
            {getEntityTypeLabel(world, entity.type)}
            {entity.visibility === 'gm' ? ' · GM 秘密' : ''}
          </span>
          <strong>{entity.name}</strong>
        </div>
        <span
          className="entity-preview-lock"
          title={entry.locked ? '已锁定；点击浮窗外或按 Esc 关闭' : '摘要显示后，继续停留2.7秒锁定'}
          aria-label={entry.locked ? '已锁定' : '正在锁定'}
        >
          <UnlockKeyhole className="entity-preview-lock-empty" size={19} />
          <span className="entity-preview-lock-fill">
            <LockKeyhole size={19} />
          </span>
        </span>
      </header>
      <div className="entity-preview-scroll">
        <div className="entity-preview-summary">
          <PreviewText content={entity.summary || '暂无摘要'} entities={entities} onOpen={onOpen} />
        </div>
        {excerpt && (
          <div className="entity-preview-excerpt">
            <PreviewText
              content={excerpt + (entity.content.length > excerpt.length ? '…' : '')}
              entities={entities}
              onOpen={onOpen}
            />
          </div>
        )}
        {!!entity.tags.length && (
          <div className="entity-preview-tags">
            {entity.tags.slice(0, 5).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        )}
      </div>
      <footer>
        <span>{entry.locked ? '已锁定 · 可继续悬停内部词条' : '保持悬停，锁定后可移开鼠标'}</span>
        <button onClick={() => onOpen(entity.id)}>
          打开词条 <ArrowUpRight size={13} />
        </button>
      </footer>
    </div>
  );
}
