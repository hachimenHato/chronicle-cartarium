import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
interface Step {
  title: string;
  text: string;
  selector: string;
  view?: string;
}
const fullSteps: Step[] = [
  {
    title: '欢迎来到编年图志',
    text: '这份教程会依次指出常用按钮和窗口。使用下一步前进，随时可以结束；侧栏“工具教学”可再次打开。',
    selector: '.sidebar',
  },
  {
    title: '当前世界与切换',
    text: '这里选择正在创作的世界。地图、设定、人物和剧情都按世界组织；世界本身由主管理员管理。',
    selector: '.world-switch',
  },
  {
    title: '保存状态',
    text: '修改会自动排队保存。“所有更改已保存”才表示服务端写入成功；出现错误或版本冲突时，先保留修改并按提示处理。',
    selector: '.save-status',
  },
  {
    title: '创作仪表盘',
    text: '查看当前数量、草稿和未填字段，安排下一步创作。这些信息是查漏清单，不是质量评分。',
    selector: '.dashboard-grid',
    view: 'dashboard',
  },
  {
    title: '设定分类与新片段',
    text: '在知识库创建地点、国家、信仰等内容。管理员可管理设定类型与通用字段模板；其他账户按授权编辑。',
    selector: '.page-heading',
    view: 'lore',
  },
  {
    title: '查找与筛选',
    text: '按名称、正文、标签查找，并按类型筛选。进入条目后可写Markdown、[[关联名称]]，上传或选用预设封面；悬停1秒显示摘要，出现后再停留2.7秒锁定。点击浮窗外关闭。',
    selector: '.library-toolbar',
    view: 'lore',
  },
  {
    title: '角色档案',
    text: '角色使用独立档案，支持立绘、动机、背景和自定义字段。点击卡片进入内容，编辑后点击保存。',
    selector: '.page-heading',
    view: 'characters',
  },
  {
    title: '地图工作区',
    text: '创建时选择完全随机或按色块，填写种子、地图类型、画布大小与实际范围。色块可导入图片，用三档横条选择A最大随机、B平衡或C严格保形。地图上方图层按钮独立切换显示，选择工具不会改变图层。',
    selector: '.atlas-page, .atlas-workspace, .main-content',
    view: 'atlas',
  },
  {
    title: '地图创作与聚落',
    text: '“疆域分区”选择小区域后填充归属。“地名与地点”统一设置聚落数量、所有名称和关联档案。“兵棋推演”绘制前线、进攻、撤退与防御线。三级创作工具保留人工细化；全屏只显示地图。重开与改名、关联、切图层均不会重新生成。',
    selector: '.atlas-inspector, .main-content',
    view: 'atlas',
  },
  {
    title: '人物关系线索图',
    text: '人物和势力分层展开，拖动后保存位置，双击打开档案。注释放在连线旁，用细虚线指向对应路线；悬停连线或聚焦注释可突出整条连接，点击连线或注释编辑关系。',
    selector: '.graph-shell',
    view: 'relations',
  },
  {
    title: '剧情路线与触发',
    text: '点击节点编辑场景、关联、条件与效果；连接注释放在路线旁，悬停或聚焦注释可追踪整条连接。整理布局可减少拥挤。GM确认推进，工具不会替玩家选择。',
    selector: '.plot-layout, .main-content',
    view: 'plots',
  },
  {
    title: '团务日志',
    text: '保存下场计划和真实团后记录，跟进人物变化与玩家留下的线索。计划和已完成状态分开标记。',
    selector: '.journal-layout, .main-content',
    view: 'journal',
  },
  {
    title: '创作指引',
    text: '创作路线提供练习和自查问题，工具速查解释具体操作。你可以随时从这里开始工具教学。',
    selector: '.guide-layout',
    view: 'guide',
  },
  {
    title: '档案、账户与后台',
    text: '导出与后台按账户权限开放。主管理员可配置主题、管理世界、备份和初始化；次级管理员管理创作和用户。首次教学结束后不会再自动打开。',
    selector: '.sidebar-bottom',
    view: 'dashboard',
  },
];
const emptySteps: Step[] = [
  {
    title: '欢迎来到空白工作台',
    text: '这里还没有世界。主管理员先创建第一个世界，随后工具会继续带你认识地图、设定、人物与剧情。其他账户需要等待管理员建立世界。',
    selector: '.empty-workbench',
  },
  {
    title: '从名字开始',
    text: '填写世界名称并创建，接着用一句话写清时代与核心冲突。这个步骤不填入测试数据，也不会自动创建世界。',
    selector: '.empty-workbench form, .empty-workbench',
  },
];
export function ToolTour({
  hasWorld,
  onNavigate,
  onFinish,
  onHighlight,
}: {
  hasWorld: boolean;
  onNavigate: (view: string) => void;
  onFinish: () => void;
  onHighlight?: (selector: string) => void;
}) {
  const steps = hasWorld ? fullSteps : emptySteps;
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect>();
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const card = useRef<HTMLDivElement>(null);
  const step = steps[index];
  const navigate = useRef(onNavigate);
  navigate.current = onNavigate;
  const highlight = useRef(onHighlight);
  highlight.current = onHighlight;
  useEffect(() => {
    if (step.view) navigate.current(step.view);
    highlight.current?.(step.selector);
  }, [step]);
  useEffect(() => {
    let target: Element | null = null;
    let frame = 0;
    const measure = () => {
      target = document.querySelector(step.selector);
      setRect(target?.getBoundingClientRect());
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    const transition = setTimeout(measure, 260);
    frame = requestAnimationFrame(() => {
      measure();
      const bounds = target?.getBoundingClientRect();
      if (bounds && (bounds.bottom > window.innerHeight || bounds.top < 0))
        target?.scrollIntoView({ block: 'center', behavior: 'instant' });
      measure();
      card.current?.querySelector<HTMLButtonElement>('button[data-next]')?.focus();
    });
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(transition);
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onFinish();
      }
      if (e.key === 'Tab' && card.current) {
        const buttons = [
          ...card.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        ];
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        buttons[(current + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [onFinish]);
  const width = Math.min(390, viewport.width - 28);
  const left = Math.max(
    14,
    Math.min(rect?.left ?? (viewport.width - width) / 2, viewport.width - width - 14),
  );
  const top = Math.max(
    14,
    Math.min(
      rect && rect.bottom + 280 < viewport.height
        ? rect.bottom + 14
        : rect && rect.top > 280
          ? rect.top - 270
          : viewport.height / 2 - 130,
      viewport.height - 280,
    ),
  );
  return createPortal(
    <div className="tool-tour-overlay">
      <svg className="tool-tour-shade" width="100%" height="100%" aria-hidden="true">
        <defs>
          <mask id="chronicle-cartarium-tour-hole">
            <rect width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={Math.max(4, rect.left - 5)}
                y={Math.max(4, rect.top - 5)}
                width={Math.min(rect.width + 10, viewport.width - 8)}
                height={Math.min(rect.height + 10, viewport.height - 8)}
                rx="12"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="#081b26"
          opacity=".72"
          mask="url(#chronicle-cartarium-tour-hole)"
        />
      </svg>
      {rect && (
        <div
          className="tool-tour-highlight"
          style={{
            left: Math.max(4, rect.left - 5),
            top: Math.max(4, rect.top - 5),
            width: Math.min(rect.width + 10, viewport.width - 8),
            height: Math.min(rect.height + 10, viewport.height - 8),
          }}
        />
      )}
      <div
        ref={card}
        className="tool-tour-card"
        role="dialog"
        aria-modal="true"
        aria-label="工具教学"
        style={{ width, left, top }}
      >
        <div className="section-top">
          <span className="eyebrow">
            工具教学 · {index + 1} / {steps.length}
          </span>
          <button className="icon-btn" aria-label="结束工具教学" onClick={onFinish}>
            <X size={16} />
          </button>
        </div>
        <h2>{step.title}</h2>
        <p>{step.text}</p>
        <div className="tool-tour-actions">
          <button className="text-btn" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            <ArrowLeft size={14} /> 上一步
          </button>
          <button
            className="btn primary"
            data-next
            onClick={() => (index + 1 === steps.length ? onFinish() : setIndex(index + 1))}
          >
            {index + 1 === steps.length ? (hasWorld ? '完成教学' : '开始创作') : '下一步'}
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
