# Windows 桌面窗口版

桌面版是 **额外下载项**，原 Windows CMD、Linux、macOS 和 Docker 发布方式继续保留。使用相同的 React/Node 后端、SQLite/MySQL 选择、账号权限和文件格式。

## 使用

完整解压桌面 ZIP 到可写目录，双击 `Chronicle Cartarium.exe`。无需打开 CMD、系统浏览器，也无需联网安装 Node/npm 依赖。不要只复制 EXE，其旁边的资源和 DLL 也必须保留。

首次启动在程序旁的 `workspace` 准备工作台，新安装的数据默认在 `workspace/data`。在窗口内明确选择本地 SQLite 或 MySQL；登录默认开启，需自行设置主管理员账号，也可关闭登录后直接使用而无需账号密码。安装时可选多用户，必须同时开启登录；之后可在后台调整。首次准备运行组件可能需要片刻；默认不填充范例。

窗口提供工作台、编辑、视图和帮助菜单。文件下载显示原生保存对话框；F11 切换窗口全屏。网页内的地图全屏、上传、导出、登录、权限和备份功能保持不变。

## 使用已有 CMD 工作台

在“工作台 → 打开已有工作台…”选择原程序根目录，必须包含 `scripts/launch.mjs` 与 `package.json`，**不能只选 data 目录**。

已运行的实例必须通过该目录的控制钥匙验证身份才会连接；不会只看到 3001 端口就附接，也不会结束其他 Node 进程。窗口关闭时，外部 CMD 启动器仍继续运行。由桌面版自己启动的本机服务会在退出时正常停止，更新/恢复过程中拒绝强行退出。

原 `.worldloom/current.json` 中绝对 `dataDir` 优先，桌面版不会把它换成空白目录或覆盖已有程序。没有固定指针的目录沿用其私有 `.env` 中 DATA_DIR。账号和登录流程继续生效，桌面窗口不绕过管理员或权限校验。

桌面版自己启动的服务仅监听 `127.0.0.1`。如需长期服务器或远程共享，请继续使用 CMD/服务器发行版；附接已运行的服务器不更改其监听配置。

## 更新和备份

完整的文件选择和逐步操作见 **[各平台更新教程](update-guide.md)**。beta.18 及之前的工作台先离线导入同架构 Windows `.ccupdate` 升级到 beta.19；之后可在后台“检查更新 → 下载并安全更新”。没有兼容新版或签名附件时不会强行安装，离线入口继续保留。

beta.19 起，桌面壳可从 **帮助 → 检查桌面程序更新…** 自动下载、验签、完整备份、退出并重开新版。需要主管理员身份（开启登录时先登录）、保存全部编辑和至少3GB空闲空间；下载可取消，验证/备份阶段请等待。程序放在原 `.desktop/releases/` 的新目录，验证原工作台后才切换桌面指针；具备此功能的原 EXE 保留为固定入口，`workspace` 与数据路径不被覆盖。原生自动更新与手动备用步骤见[桌面更新教程](update-guide.md#windows-桌面-exe-外壳怎样更新)。

beta.18 及以前的 EXE 需要先完整解压 beta.19 到新目录，**保留原 workspace 与 .desktop**，通过“打开已有工作台”选择原 workspace，才能获得新原生菜单。不要删除数据或重新初始化，也不要把包含自己资料的整个程序目录发到公开网盘。桌面自动更新不回退世界资料；若新窗口失败但尚未退出，先关闭该窗口再从原 EXE 重开。旧程序和备份暂不自动清理。

此版未提供会自动删安装目录的卸载器，不会为更新清空数据。桌面 EXE 没有商业代码签名，Windows 可能显示未知发布者提示；官方 Electron/Chromium 与 Node/npm 许可随包保留，原创代码仍为 0BSD。

已有 workspace 不会被新桌面模板覆盖；替换桌面 EXE 并不自动升级该 workspace 的后端。后端版本仍通过主管理员后台受签名更新，不能删除 workspace 来强行使用新模板。

## 构建与验证

先在隔离的公开源码目录执行 `npm ci`、类型检查、单测和构建。Windows 上在源码根执行 `npm ci --prefix desktop --ignore-scripts` 准备构建工具；`package-desktop.mjs` 会下载校验对应 Electron 发行版。然后提供公开构建目录和已验证的 Windows Node/npm runtime 目录：

```sh
node scripts/package-desktop.mjs .runtime/publishing/PUBLIC_SOURCE PATH_TO_WINDOWS_RUNTIME
```

构建输出只在 `.runtime/desktop-work/`。只使用明确的代码/运行时白名单，不复制任何 data、安装配置、账号、真实上传、日志或签名私钥。启动器单测覆盖原目录不覆盖、私有模板拒绝、隔离继承环境及外部实例不被停止；最终桌面功能和发行检查结果以该次附件验证报告为准。

执行 `npm run test:desktop` 在独立临时 SQLite 工作台检验真实 EXE：安装二选一、范例、地图生成、Markdown 下载、沙箱、导航拦截、未保存关闭、正常停止、重启登录和完整资料/revision 保持；再启动测试自身的 CMD 实例，验证附接窗口关闭不会停止该服务或改变资料。测试使用专用 3313/3314 端口，不连接实际数据库。原 `test:ui` 继续只使用 3311 新 DemoStore。

开发环境可设置 `DESKTOP_BUILD_TOOLS` 指向独立构建工具目录。如果直连 GitHub 下载受限，可通过官方 GitHub CLI 下载对应 Electron ZIP，将 `DESKTOP_ELECTRON_ZIPS` 指向该目录；脚本会与 `desktop/runtime.json` 中的官方固定 SHA-256 核对，不能使用未验证镜像替代。
