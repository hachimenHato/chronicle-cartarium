# 安装、部署与下载选择

## 选择安装包

Windows x64 包用于普通 Intel/AMD 64 位电脑。Linux x64/arm64 包用于相应架构的 glibc Linux；不适用于 Alpine/musl。macOS x64 用于 Intel，arm64 用于 Apple Silicon。每个包的运行时只适用于标明的平台；首次启动仍需要网络下载 npm 依赖。源码可在 Node.js 22.18+ 与 npm 环境构建。

Windows：解压到可写目录后双击 `start.cmd`。Linux：执行 `sh start.sh`。macOS：执行 `sh start.sh`，或给予 `start.command` 执行权限后打开；下载的运行时没有 Apple 公证安装器，请按系统安全提示自行核对来源，不应全局关闭系统保护。

浏览器访问 http://localhost:3001/。保持启动终端运行；Ctrl+C 正常停止。安装目录不要放在只读系统目录，不要让多个实例共用同一个数据目录。

## 首次安装

1. 二选一：本地 SQLite（无需数据库软件）或 MySQL 8。
2. 选择本机/服务器访问方式、名称与主题。
3. 设置主管理员账号和至少十字符密码，可选填充完整范例。

MySQL 向导要求新建项目库，库名必须不存在；使用有相应建库权限的账号。不能把其他软件已有数据库作为安装目标。没有统一默认管理员密码。默认空白安装，可从侧栏重新打开工具教学。

## 数据位置

默认 `data/` 包含数据库、上传与私有安装信息。固定启动器首次记录 `.worldloom/current.json` 的绝对 `dataDir`，以后该路径优先。不要移动或删除被指向的数据目录。完整备份与迁移见 [更新与恢复](update-strategy.md)。

## 服务器

推荐在本机完成配置后以专用系统账号运行固定入口 `node scripts/launch.mjs`，工作目录设为安装根。Linux 可交给 systemd，Windows 可交给服务管理器监督。反向代理使用 HTTPS，设置 `COOKIE_SECURE=true`；只在一个可信代理后设置 `TRUST_PROXY=true`。服务器首次公开安装还需随机 `SETUP_TOKEN`（至少 24 字符）。不可把该值发布到仓库或 Issue。

数据库与上传目录必须持久可写；限制端口和文件访问，备份保存在另一处私密存储。此版为单 Node 进程服务，不支持多实例共用数据。

## Docker

需要 Docker Engine / Docker Desktop 与 Compose v2。在安装根私有 `.env` 配置随机 `CHRONICLE_CARTARIUM_SETUP_TOKEN`，然后 `docker compose -f docker-compose.image.yml up -d` 使用公开预构建的 Linux amd64/arm64 镜像；也可用 `docker compose up -d --build` 从源码构建。打开 3001 端口网页完成二选一安装。

Compose 默认以命名卷持久化 `/app/data`，不捆绑 MySQL。容器连宿主机的 MySQL 时，`localhost` 是容器自身，需要使用宿主机可达地址。更新保留 Compose 项目名、卷与私有配置，**不得执行 `down -v` 或清理持久卷**。Docker 使用宿主机更新流程，不使用容器内自动替换程序；详见更新文档。

下载包附带 SHA256SUMS 校验值。普通发行归档不是后台受签名更新包。系统与架构的实机验证范围以该次 Release 说明为准。
