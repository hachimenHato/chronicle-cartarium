import { useState } from 'react';
import { BookOpen, ArrowRight } from 'lucide-react';
import { creativeChapters } from '../../shared/creative-guide';
const referenceChapters = [
  {
    title: '从零开始与推荐顺序',
    text: '先创建世界并写一句核心冲突，再建起始地点、三名NPC和一条短剧情。然后绘制区域地图并给地点添加关联标记，最后安排第一场团务。你不必先完成整片大陆才能开始游戏。仪表盘会显示当前数量、草稿与待准备场次。',
    steps: [
      '世界总览 → 编辑世界：名称、时代、规则体系与简介。',
      '知识库 → 新建设定：用分类模板写地理、文化、信仰、经济与魔法代价。',
      '知识库或角色档案右上“模板设置”：选设定类型，增删、改名或排序通用字段，再应用并等待保存。模板按当前世界保存，新条目和地图快捷创建共用。移出模板的已填写字段保留为条目额外字段。',
      '角色档案 → 新建人物：先写动机、矛盾、秘密与扮演提示，再上传立绘。',
      '地图工坊 → 新地图：选择世界/区域/城镇、画布尺寸与实际覆盖范围。',
      '创建地图时点“选择星球方位与范围”，旋转或放大星球并调整覆盖范围，无需填写经纬度；不选为全球。下方可切换气温、降水与生态预览，选区会影响实际生成。已有地图可在地理参数中修改范围，再明确重构。',
      '剧情编织 → 创建剧情：先画开场、调查、选择与结局，再设置变量条件。',
    ],
    target: 'overview',
  },
  {
    title: '地图的三个创作级别',
    text: '快速生成、智能塑形与精细编辑共享同一张地图，切换级别不会删除内容。先用少量颜色规划陆地、水域、山地和森林，选择生成预览；地图计算在后台进行，中心提示完成后消失。色块草稿只显示原始意图，适合流畅修改。',
    steps: [
      '快速生成：用色块勾勒整体形状；画笔最小为5，切换地貌时保持同一大小。',
      '色块生成三档：A最大随机完全不保形状和大小，只弱参考方位；小点也能长成大片大陆。B平衡部分保形，C严格保留已采样轮廓。默认B；导入既定地图推荐C。',
      '智能塑形：14种地貌与群组工具，调整局部地形、密度和起伏，重新生成会保留人工内容。',
      '精细编辑：修改图章、曲线、文字、图片和节点。转换生成内容前先确认，之后可以逐个编辑。',
      '地图默认是平移；需要移动元素时明确切换选择工具。滚轮以鼠标位置缩放，撤销/重做可修正本次编辑。',
      '地图上方的图层按钮独立切换地形、海拔、国家、文化、信仰等视图；选择兵棋工具不改变当前视图。',
      '兵棋推演中，前线短齿与防御锯齿朝绘制方向右侧；绘好后点对应记录的“翻转齿向”交换两侧，闭合线也能换内外。',
    ],
    target: 'atlas',
  },
  {
    title: '海拔、地图尺度与真实图例',
    text: '“地形”显示古典地图与色块生成；“海拔”显示高度和海平面，并提供抬升、降低、平整与平滑。地貌意图与海拔共同影响生成，不是只把色块换颜色。世界图、区域图和城镇图的覆盖范围会改变山峰、水系与道路的密度和粗细。',
    steps: [
      '新建时设定画布尺寸和覆盖公里数；地图档案可修改，变更时核对标记位置。',
      '五类聚落可分别设置数量；世界图在主体周围布置较多建筑，区域图少量点缀，城镇图不加周边建筑，实际数量受地形限制。',
      '海拔模板提供整体地势，局部海拔笔刷可调整山谷、丘陵与海岸。',
      '左下“图例”只列出当前可见图层实际存在的地貌、河流、道路、图章和标记。',
      '纯地图全屏隐藏绘制工具和面板；仍可拖动探索，Esc或右上按钮退出。',
    ],
    target: 'atlas',
  },
  {
    title: '国家、文化、信仰与层级地图',
    text: '国家、文化、信仰在生成地图时按山河海岸与聚落划分，并关联真实设定条目。三个层相互独立，可跨国分布。后续按共享小区域选取和填充归属，海岸与湖泊会自动裁切。',
    steps: [
      '疆域分区中选择国家／文化／信仰和目标；新建按钮可同时创建分区和设定条目。',
      '「地名与地点」统一管理聚落、大陆、海洋、疆域、港口与标记；可改名称、定位、关联或建立词条，聚落生成数量也在此设置。点击眼睛逐项隐藏／显示聚落、港口、道路与航路，隐藏不会删除或重生成。',
      '点击选择小区域，再点“填充选中区域”；再次点击取消，Shift连选，Ctrl／⌘选择相连同归属区域。拖动只平移，清除归属只作用当前层。',
      '「兵棋推演」绘制精确前线、方向箭带、撤退箭头与防御齿线；前线只吸附边界，需要看清细分时手动打开「区域」图层。',
      '开启港口生成时保障通海岛屿及沿海国家的港口，独立码头不占聚落名额；内陆国家不会强行获得港口。封闭湖泊不会连接外海航路。',
      '地图标记可同时关联地点条目和子地图，双击进入详情或子地图。',
      '隐藏图层、隐藏右工具栏与收起左导航有助于专注阅读；均不会删除地图数据。',
    ],
    target: 'atlas',
  },
  {
    title: '图片、组件与导出地图',
    text: '组件库含自然、聚落、防御、信仰、魔法、冒险、资源与交通设施，可搜索或分类浏览。直接导入PNG、JPEG或WebP可作为图片底图；新地图选择“按照色块生成”则可读取图片近似地形颜色，转为可编辑色块。',
    steps: [
      '单张图片不超过8MB；导入后默认锁定，防止误拖动。',
      '精细编辑对象列表可以调整图片的位置、比例、旋转、透明度和层级。',
      'SVG导出保存当前可见内容，并将已上传底图嵌入导出文件；地图生成未完成时不可导出过时预览。',
      'JSON和Markdown不包含图片原始文件，迁移时须同时备份data/uploads。',
    ],
    target: 'atlas',
  },
  {
    title: '关联导航与悬浮词条',
    text: '正文里输入 [[条目名称]] 创建关联链接。名称在当前世界中解析，改名后请核对正文链接。人物关系和地图标记使用稳定ID关联，可在图中跳转。',
    steps: [
      '点击关联词条打开详情；悬停或键盘聚焦1秒后显示摘要，无需快捷键。等待期间移开即取消显示。',
      '摘要出现后才开始锁定计时；继续停留约2.7秒，锁图标逐渐填满，锁定后移开仍保留。',
      '锁定卡片内的关联词条可以继续打开嵌套摘要，每层都先等待1秒，再独立计时锁定。',
      '按Esc、窗口失焦或点击整组卡片之外，关闭全部摘要并取消待显示的卡片。',
    ],
    target: 'lore',
  },
  {
    title: '剧情路线、条件与GM控制',
    text: '连线规定场景的前后关系：没有入边的场景可以开始，有入边的场景须至少一个前驱完成，再检查变量条件。GM决定何时推进，不会自动替玩家选择。条件只比较状态变量，不执行脚本；场景效果写入预先定义的变量，操作前核查影响。',
    steps: [
      '先在状态变量中定义布尔、数字或文本状态，如“取得镜片”“神社信任”。',
      '场景设置全部满足/任一满足；等于、包含和数字比较用于不同线索。',
      '连接注释放在路线旁，细虚线指向对应连线；悬停或聚焦注释会突出整条连接，便于越过交叉点追踪。',
      '完成场景后按约定应用效果；回溯时同时核对变量与已完成状态。',
      '范例第二卷展示并行调查，第三卷展示三种终幕；不要把唯一检定当作主线通行证。',
    ],
    target: 'plots',
  },
  {
    title: '人物关系与团务日志',
    text: '人物关系是条目之间的有向关系，可以连接角色与国家、组织或地点。剧情路线是场景图，两者含义不同。团务计划与团后记录分开，避免把计划当作已经发生的事件。',
    steps: [
      '人物关系：选择源、目标、关系类别与说明，写清利益、承诺与矛盾。',
      '关系注释与路线分开摆放；悬停路线或聚焦注释突出整条关系，点击可编辑。拥挤时可整理布局或手动拉开卡片。',
      '角色立绘从本机上传；不要仅写外部图片地址来替代可迁移资源。',
      '团务日志记录玩家选择、获得线索、NPC变化和下次入口。',
      '范例计划尚未跑团；完成一场后再标记已完成并填写真实团后记录。',
    ],
    target: 'journal',
  },
  {
    title: '保存、备份、迁移与初始化',
    text: '页面提示“所有更改已保存”才表示服务端写入成功。发现修订冲突时保留当前内容，先下载备份再重新载入；不要在不同窗口同时编辑同一工作区。',
    steps: [
      '导出可选择世界、类型、条目和GM可见性，生成Markdown文档。',
      '完整JSON备份含地图编辑数据，恢复会替换全部创作内容；图片目录需另行备份。',
      '本地数据库在data/worldloom.sqlite，MySQL由安装配置指定；迁移前停止服务并完整备份data。',
      '后台设置的初始化要求输入指定文字，默认清空创作数据；“填充范例内容”默认不勾选。操作前自动备份内容及上传图片。',
      '账号、安装设置与自动备份保留，方便继续登录空白工作台。',
    ],
    target: 'overview',
  },
  {
    title: '安装、登录与主题',
    text: '首次使用明确选择本地数据库或MySQL。本地模式无需数据库服务；MySQL新建全新专用库，不能选择已有业务库初始化。可由主管理员开启多用户模式；普通用户默认只看公开内容，GM私密资料需要授权。次级管理员管理创作与用户，世界本身和系统设置由主管理员管理。',
    steps: [
      '本机访问仅监听回环地址；服务器访问监听网络地址。公网请按部署文档配置HTTPS反代与安全Cookie。',
      '安装创建GM用户名与密码；后台设置可改密码并使其他会话失效。',
      '主题包括羊皮卷、青玉庭和星夜。主题改变界面，地图画作保持自己的羊皮纸色彩。',
      '后台设置可查看版本、存储方式与运行状态。修改访问方式需要重启服务；关闭服务不会丢失已保存数据。',
    ],
    target: 'dashboard',
  },
];
export function Guide({
  onNavigate,
  onTutorial,
}: {
  onNavigate?: (view: string) => void;
  onTutorial?: () => void;
}) {
  const [mode, setMode] = useState<'creative' | 'reference'>('creative');
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState('');
  const chapters = mode === 'creative' ? creativeChapters : referenceChapters;
  const chapter: {
    title: string;
    text: string;
    steps: string[];
    target: string;
    exercise?: string;
    check?: string;
  } = chapters[active];
  return (
    <section className="guide-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">THE CREATOR'S COMPANION</div>
          <h1>创作指引</h1>
          <p>从第一座村落开始，逐步织成可以游玩的世界。</p>
        </div>
        <div className="button-row">
          <button
            className="btn"
            aria-pressed={mode === 'creative'}
            onClick={() => {
              setMode('creative');
              setActive(0);
              setQuery('');
            }}
          >
            创作路线
          </button>
          <button
            className="btn"
            aria-pressed={mode === 'reference'}
            onClick={() => {
              setMode('reference');
              setActive(0);
              setQuery('');
            }}
          >
            工具速查
          </button>
          {onTutorial && (
            <button className="btn" onClick={onTutorial}>
              开始工具教学
            </button>
          )}
          <BookOpen size={28} />
        </div>
      </div>
      <div className="guide-layout">
        <nav aria-label={mode === 'creative' ? '创作指引目录' : '功能介绍目录'}>
          <input
            aria-label="搜索功能介绍"
            placeholder={mode === 'creative' ? '搜索人物、冲突、线索…' : '搜索地图、条件、备份…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {chapters.map(
            (c, i) =>
              `${c.title}${c.text}${c.steps.join('')}`.includes(query) && (
                <button
                  key={c.title}
                  className={i === active ? 'active' : ''}
                  onClick={() => setActive(i)}
                >
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  {c.title}
                </button>
              ),
          )}
        </nav>
        <article>
          <div className="eyebrow">CHAPTER {String(active + 1).padStart(2, '0')}</div>
          <h2>{chapter.title}</h2>
          <p>{chapter.text}</p>
          <ol>
            {chapter.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {chapter.exercise && (
            <div className="guide-example">
              <strong>动手练习</strong>
              <p>{chapter.exercise}</p>
              <strong>自查问题</strong>
              <p>{chapter.check}</p>
            </div>
          )}
          {onNavigate && (
            <button className="btn primary" onClick={() => onNavigate(chapter.target)}>
              打开对应功能
              <ArrowRight size={16} />
            </button>
          )}
          <div className="guide-example">
            <strong>试着使用月汐范例</strong>
            <p>
              从“青竹村”的标记进入详细地图，悬停“水无濑凛”查看摘要，再到第一卷查看水车停转的祭典。你会看到地图、人物、线索与状态变量如何连在一起。
            </p>
          </div>
        </article>
      </div>
    </section>
  );
}
