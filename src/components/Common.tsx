import { useEffect, useRef, type ReactNode } from 'react';
import { X, FileText, LockKeyhole } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { Entity } from '../../shared/model';
import { useEntityTooltip } from './EntityTooltip';

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    const target =
      ref.current?.querySelector<HTMLElement>('input, select, textarea') ||
      ref.current?.querySelector<HTMLElement>('button');
    target?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea, select:not(:disabled), a[href]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
      prev?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="关闭" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function EntityLink({
  entity,
  onOpen,
  children,
}: {
  entity?: Entity;
  onOpen: (id: string) => void;
  children?: ReactNode;
}) {
  const tooltip = useEntityTooltip(entity);
  if (!entity) return <span className="broken-link">{children || '未关联条目'}</span>;
  return (
    <span className="entity-link-wrap">
      <button
        className="entity-link"
        aria-description="悬停或聚焦1秒显示摘要，显示后再停留2.7秒锁定"
        {...tooltip}
        onClick={() => onOpen(entity.id)}
      >
        {children || entity.name}
      </button>
    </span>
  );
}
export function WikiContent({
  content,
  entities,
  onOpen,
}: {
  content: string;
  entities: Entity[];
  onOpen: (id: string) => void;
}) {
  const markdown = content.replace(/\[\[([^\]]+)\]\]/g, (_, name: string) => {
    const e = entities.find((item) => item.name === name.trim());
    return e ? `[${name}](#entity-${e.id})` : `**${name}（未关联）**`;
  });
  return (
    <div className="markdown">
      <ReactMarkdown
        components={{
          a: ({ href, children }) =>
            href?.startsWith('#entity-') ? (
              <EntityLink entity={entities.find((e) => e.id === href.slice(8))} onOpen={onOpen}>
                {children}
              </EntityLink>
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <FileText size={32} strokeWidth={1.2} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function VisibilityBadge({ value }: { value: string }) {
  return value === 'gm' ? (
    <span className="badge secret">
      <LockKeyhole size={11} /> GM 秘密
    </span>
  ) : null;
}
