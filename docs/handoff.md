# 开发接手入口

此公开源码快照不包含维护者本机的运行记录、数据库配置、私有备份和历史交接日志。先阅读根 AGENTS.md、README.md、架构与需求文档。领域契约在 shared/，写入校验在 server/validation.ts。运行 typecheck、test、build；地图交互测试只使用 3311 临时演示存储。后续改动记录在 development-log.md，不能提交真实数据、凭据或发行私钥。

当前公开版本beta.18。地图相机入口在useMapPanCamera，显示缓存由useMapRasterCache/map-raster-cache维护。最高缩放或渲染层结构变化时应同步检查缓存分辨率、范围、命中和导出；不要让可丢弃缓存改变领域数据。性能/清晰度限制见map-performance.md，保留独立3311 UI测试。

当前公开源码版本beta.19。在线更新契约shared/update.ts、服务server/online-update.ts、流式下载server/update-download.ts与ProgramUpdateService共用程序排他门；最终Ed25519信任不随镜像改变。下载只准备包，应用必须新主管理员请求。程序更新不能恢复旧快照覆盖完成后写入。教程见update-guide.md与update-strategy.md；下载来源配置不改变DATA_DIR或数据库连接。只有下载阶段可取消；验签开始后不允许取消以避免prepared提交竞争。维护者发布时沿用原私钥，公开包只含公钥，不要重新生成信任密钥。


## 原生桌面签名切换（beta.19）

Windows 便携桌面新增帮助菜单自动更新，使用原 Ed25519 信任密钥验证桌面 ZIP 和全文件树，独立目录准备新壳；固定原入口在新版核对原工作台、账号指纹及 revision 后提交。壳切换不恢复任何旧世界快照，不覆盖 workspace 或后端更新指针。只有当前主管理员身份可发起，旧后端仅在配置端点404时使用默认来源，401/403禁止。备份控制使用任务租约，断连后等待快照结束再释放，其他任务不能解除维护门。Electron 对ASAR的虚拟文件系统不用于原始包哈希。后端 ccupdate 与壳 ZIP/签名描述分开，镜像保持同一官方签名；旧壳首次需手动完整换包。各平台实测与未验证项见本版发行附件，不能把通过单测写成所有平台断电验收。
