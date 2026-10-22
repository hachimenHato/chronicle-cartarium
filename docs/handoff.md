# 开发接手入口

此公开源码快照不包含维护者本机的运行记录、数据库配置、私有备份和历史交接日志。先阅读根 AGENTS.md、README.md、架构与需求文档。领域契约在 shared/，写入校验在 server/validation.ts。运行 typecheck、test、build；地图交互测试只使用 3311 临时演示存储。后续改动记录在 development-log.md，不能提交真实数据、凭据或发行私钥。

当前公开版本beta.18。地图相机入口在useMapPanCamera，显示缓存由useMapRasterCache/map-raster-cache维护。最高缩放或渲染层结构变化时应同步检查缓存分辨率、范围、命中和导出；不要让可丢弃缓存改变领域数据。性能/清晰度限制见map-performance.md，保留独立3311 UI测试。

当前公开源码版本beta.19。在线更新契约shared/update.ts、服务server/online-update.ts、流式下载server/update-download.ts与ProgramUpdateService共用程序排他门；最终Ed25519信任不随镜像改变。下载只准备包，应用必须新主管理员请求。程序更新不能恢复旧快照覆盖完成后写入。教程见update-guide.md与update-strategy.md；下载来源配置不改变DATA_DIR或数据库连接。只有下载阶段可取消；验签开始后不允许取消以避免prepared提交竞争。维护者发布时沿用原私钥，公开包只含公钥，不要重新生成信任密钥。
