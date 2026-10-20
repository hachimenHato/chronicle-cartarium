# 编年图志 · Chronicle Cartarium

**为 TRPG 主持人与世界构建者准备的地图、设定、人物关系与剧情工作台。**

通过浏览器使用，部署在自己的电脑或服务器。首次安装明确选择 **本地 SQLite** 或 **MySQL**，本地模式无需另装数据库。中文界面，目前为 **0.2.0-beta.16 公开测试版**。

[下载发行版](https://github.com/hachimenHato/chronicle-cartarium/releases) · [安装与部署](docs/installation.md) · [更新与数据保护](docs/update-strategy.md) · [问题反馈](https://github.com/hachimenHato/chronicle-cartarium/issues)

<img src="public/covers/moon-town.png" alt="应用自带的月夜城镇封面插画，并非地图生成截图" width="280">

## 可以做什么

- **地图工坊**：世界、区域、城镇三种尺度；随机或色块生成，图片识别色块、种子与经纬范围。地形、海拔、板块、气温、降水共同参与生成，提供三级编辑、地形纹理、聚落、港口、道路和航路。
- **疆域与推演**：按小区域划分国家、文化和信仰并关联设定；边界、前线、防御线、进攻箭头与地名可编辑，聚落和交通线可单独隐藏。
- **世界知识库**：可自定义的设定类型与字段模板、Markdown、封面、标签、搜索、关联跳转与延时锁定的多层悬浮词条。
- **人物与剧情**：角色立绘、展开式人物关系图、剧情路线、条件和变量、GM 计划与团务记录。条件以受限规则计算，不执行任意代码。
- **创作辅助**：仪表盘、创作指引、首次工具教学、主题、可收起侧栏和地图全屏。
- **自主管理**：登录、可选多用户、模块与逐条权限、GM 私密内容控制、Markdown/JSON/SVG 导出、完整备份与受签名程序更新。

安装时可选原创日式中世纪剑与魔法范例：85 条世界设定、20 位人物、4 张地图、30 条关系、18 个剧情场景及 GM 计划等。默认不填充。

## 快速开始

### 下载使用

Windows 另提供独立窗口的**桌面版 ZIP**：完整解压后双击 `Chronicle Cartarium.exe`，无需 CMD、系统浏览器或首次联网安装依赖。原 CMD 版继续保留；桌面版数据与已有工作台使用方式见 [桌面版说明](docs/desktop.md)。

在 [Releases](https://github.com/hachimenHato/chronicle-cartarium/releases) 选择匹配系统和 CPU 的包，解压到**可写的新目录**。Windows 双击 `start.cmd`；Linux 执行 `sh start.sh`；macOS 双击 `start.command` 或执行 `sh start.sh`。

访问 **http://localhost:3001/**，按向导选择数据库、访问方式和主题，创建自己的主管理员账号。没有通用默认密码。首次启动准备 npm 依赖需要联网；带运行时的包无需另装 Node.js。不要混用各系统的运行时或 `node_modules`。

### 从源码运行

需要 Node.js **22.18+** 和 npm，推荐 Node.js 22 LTS 最新维护版。

```sh
npm ci
npm run build
node scripts/launch.mjs
```

开发时执行 `npm run dev`，前端在 5173 端口。源码也可使用启动文件。安装向导通常无需 `.env`，高级配置参考 [.env.example](.env.example)。

### Docker 与服务器

在私有 `.env` 设置至少 24 字符的随机 `CHRONICLE_CARTARIUM_SETUP_TOKEN` 后，可直接使用已发布的 Linux amd64/arm64 镜像：

```sh
docker compose -f docker-compose.image.yml up -d
```

也可执行 `docker compose up -d --build` 从源码构建。在向导中输入授权码，选择 SQLite 或自己的 MySQL。Compose 使用持久数据卷，不捆绑 MySQL 服务。公网部署应使用 HTTPS、`COOKIE_SECURE=true`，仅在可信代理后设置 `TRUST_PROXY=true`。详见 [安装说明](docs/installation.md)。不要删除数据卷来升级。

## 数据保护与更新

新安装数据默认在 `data/`；受管理启动器将实际绝对数据路径固定在 `.worldloom/current.json`。数据库、图片、安装配置与账号权限均需保留。MySQL 安装只创建确认不存在的**新项目专用库**，不复用或清空其他库。

后台完整 `.ccbackup` 包含账号密码哈希与数据库凭据，**目前不加密，请私密保存**。JSON/Markdown 不包含上传原图，不能代替完整备份。

已有实例优先使用后台受签名 `.ccupdate`：校验、排空写入、备份并验证后切换。同系统、同架构、兼容数据格式才允许更新，尚无联网自动更新。普通 ZIP/TAR 是新安装包，不能当作更新包。迁机、Docker 更新和恢复见 [更新说明](docs/update-strategy.md)。已有数据却出现安装向导时先检查路径，**不要重新初始化**。

## 当前边界

- 地理气候是创作近似模型，不是科学预测或 GIS 测量结果；见 [气候模型](docs/climate-model.md) 和 [生成说明](docs/geographic-generation.md)。
- 单 Node.js 实例、完整工作区快照与 revision 冲突检查；尚无实时协作或多实例部署。超大地图仍有保存与矢量绘制成本。
- 登录会话在内存中，重启后需重新登录。首次启动和更新准备依赖需要联网。
- Windows 本机通过功能验证；Linux、macOS、Docker 的原生测试状态以具体发行说明为准，打包成功不等于完整生产或断电恢复验收。

## 开发

React 19 + TypeScript + Vite、Node.js + Express、SQLite / MySQL。领域契约在 `shared/`，服务端在 `server/`，界面在 `src/`。

```sh
npm run typecheck
npm test
npm run build
# 地图/悬浮改动另运行；只使用 3311 临时演示存储
npm run test:ui
```

真实 MySQL 测试以 `npm run test:mysql` 显式启用，只操作测试自身创建的新临时库。

[架构](docs/architecture.md) · [范例地图](docs/example-maps.md) · [素材来源](docs/cover-presets.md) · [安全说明](SECURITY.md) · [接手入口](docs/handoff.md)

## 许可

原创代码采用 [0BSD](LICENSE)：允许商用、修改、分发和闭源使用，无强制署名或公开衍生源码要求。[0BSD 是 OSI 批准的零条款许可](https://opensource.org/license/0bsd)。

第三方组件保持各自许可，见 [完整依赖许可](DEPENDENCY_LICENSES.md) 和 [补充声明](THIRD_PARTY_NOTICES.md)。随包 Node.js/npm 的声明位于 `runtime/`。四张封面为本项目生成插画，不主张独占权；不包含用户上传或商业 TRPG 规则文本。项目名称与标志不代表对衍生产品的背书。
