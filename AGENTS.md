# 编年图志 Chronicle Cartarium — 接手约定

1. 开始修改前先读 `docs/handoff.md`、`docs/development-log.md` 和本文件，再按需读需求与架构。
2. **用户要求只在新建的项目专用数据库工作，绝对不能修改、迁移、清空或删除服务器上其他已有数据库。** 本机 `.env` 指向本项目创建的独立库；不要改为默认库。新环境初始化必须先确认新名称不存在，使用 CREATE DATABASE（不带 IF NOT EXISTS），成功后才迁移。
3. `.env`、`mysql.txt`、`DATA_DIR/installation.json`、`DATA_DIR/users.json`、`.worldloom/runner.key`、私有完整备份与 `.runtime/release-signing-private.pem` 包含凭据、密码哈希或私钥：不要打印、提交、复制到文档、打包到镜像或发往外部。发行签名私钥需要独立私密备份，换电脑沿用，不能重新生成公钥替代。
4. 保留 React + TypeScript + Node.js 架构，依用户要求首次安装明确二选一本地 SQLite / MySQL。`shared/model.ts` 与 `shared/cartography.ts` 是领域契约，`server/validation.ts` 是写入校验，结构变化需同步存储、SQL、导出、测试和文档。
5. 多用户由主管理员显式开启；普通用户默认仅查看公开内容，GM私密资料需要授权。角色、模块、作者范围与逐条授权必须由服务端筛选和写入校验，不能用前端隐藏替代权限。次级管理员只能管理创作内容、档案导出与用户；世界CRUD、备份迁移、安装/数据库/后台名称/访问方式/主题/初始化仅主管理员可用。
6. 工作区写入必须在事务内检查 revision。不能静默覆盖冲突或把保存失败显示为成功。严禁 eval 执行剧情条件。
7. 运行 `npm run typecheck`、`npm test`、`npm run build`。真实数据库测试通过 `npm run test:mysql` 显式启用，只建/删测试自身创建的全新临时库。涉及地图或悬浮交互时运行 `npm run test:ui`；该测试只使用 3311 端口新建的临时演示存储，不能改成实际应用服务地址。
8. 完成有意义的改动后更新开发日志与 handoff：真实修改、实测结果、未验证项、已知限制。不要把待开发写成已完成。
9. 界面面向中文用户，重视可读性、响应式、关联导航、空状态和错误提示。地图数据、手绘笔画和标记均需持久化。
10. 上传资源位于 `DATA_DIR/uploads`，默认 `data/uploads`。JSON/Markdown 不含图片原始文件，迁移时同时备份目录。
11. 受管理实例由安装根 `scripts/launch.mjs` 启动；`.worldloom/current.json` 的绝对dataDir优先于环境变量。程序更新先排空写入、完整备份并验证，完成记录持久化后不允许恢复升级前快照覆盖新版写入。未知数据格式在写入前拒绝。完整恢复只使用全新目录/全新项目库，保留原数据；Linux/Docker未实机验证的限制需如实记录。
12. 正式名称“编年图志 Chronicle Cartarium”，品牌唯一源shared/brand.json。旧数据路径/格式标记/数据库与卷/签名密钥/控制别名必须保持兼容，详细清单见docs/branding-compatibility.md；不能为“清除旧名称”全局替换私有或历史技术标识。
