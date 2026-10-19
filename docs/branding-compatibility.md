# 名称与旧安装兼容

2026-10-13起产品名称为 **编年图志 Chronicle Cartarium**，英文简称 **CC**，发行/包名称为 `chronicle-cartarium`。`shared/brand.json`保存唯一品牌定义，`shared/branding.ts`提供展示、默认名称、导出和数据库名称约束。Chronicle Atlas已有同名应用，因此英文采用图志词根构成的Cartarium，未声称全网绝对唯一。

对外更名包含安装/登录/导航/页脚/教学、浏览器标题、地图SVG说明、JSON档案文件名与格式标记、备份与更新包扩展、启动日志、npm包名、发行目录、当前使用说明。旧默认工作台标题仅在显示时映射为新名称，私人配置、密码、签名密钥及用户自定义的工作台标题不被批量改写。地图、人物和世界正文中作者自行写的词语不属于品牌替换目标。

新创作JSON标记为 `chronicle-cartarium`，导入同时接受旧 `worldloom` 格式；v1创作结构未变化。私有备份使用 `.ccbackup`，更新包使用 `.ccupdate`；旧 `.wlbackup` / `.wlupdate`继续可用，归档内容与签名版本保持兼容。新项目库建议 `chronicle_cartarium_` 前缀，旧 `worldloom_` 名称仍可识别。既有数据库名称不改、不迁移、不重填，也不操作其他数据库。

以下旧技术标识**刻意保留**，不得进行字符串全局替换，否则可能破坏已有数据、签名验证或beta.5启动器更新：

- `data/worldloom.sqlite`及WAL/SHM：现有SQLite路径契约，恢复工具与安装读取沿用。
- 安装根/数据目录 `.worldloom`：现有绝对数据指针、程序历史、运行令牌及恢复记录位置。
- 私有备份、MySQL快照、签名清单内部的 `worldloom-full-backup` / `worldloom-mysql` / `worldloom-release`：原格式协议，品牌变化不升级格式。
- `worldloom_session`会话cookie、`worldloom_schema_`数据库锁、原Compose `worldloom_data`卷：继续识别原实例，不新挂空卷。
- `X-Worldloom-*`请求头、`/_worldloom/update/…`路由、`WORLDLOOM_*`更新环境、`io.worldloom.*`镜像标签：旧启动器兼容别名；新增品牌的客户端/安装头、控制路由、配置环境和镜像标签已有对应入口。新前端同时发旧版本头，以便旧API明确拒绝版本不匹配的写入。
- `worldloom-build`网页元信息和原侧栏偏好：保留读兼容，同时提供新的 `chronicle-cartarium-build` 与偏好键。

原签名私钥和受信公钥保持不变，新版本最低受支持起点仍为beta.5。不要重新生成密钥，不修改已签名历史发行包。历史开发日志中的旧产品称呼、文件路径和测试夹具保留用于溯源；当前文档与界面使用新名。测试和发布需同时验证旧版更新、旧JSON导入、账号/授权/图片、默认及自定义标题，并继续只用全新临时测试库或3311演示服务。
