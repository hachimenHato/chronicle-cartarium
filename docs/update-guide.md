# 各平台更新教程

本指南对应 **0.2.0-beta.19**。下载文件以[本版发行页](https://github.com/hachimenHato/chronicle-cartarium/releases/tag/v0.2.0-beta.19)实际列出的附件为准。它仍是公开测试版；Linux、macOS 和 Docker 的完整升级、失败恢复及断电场景尚未全部实机验收。签名包可校验、源码 CI 通过，不等于这些场景已经全部通过。

## 先选择自己的情况

| 目前怎样使用                                     | 更新到 beta.19                                                                 | 以后日常更新                                    | 另外要注意                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------------- |
| Windows 桌面窗口版，后端 beta.5～18              | 在原工作台离线导入 `win-x64.ccupdate`                                          | 后台“检查更新 → 下载并安全更新”，或继续离线导入 | 更新的是工作台后端；EXE 窗口壳另按下文更新                     |
| Windows CMD 版，beta.5～18                       | 用原 `start.cmd` 启动后，离线导入 `win-x64.ccupdate`                           | 同上                                            | 不用解压新版 ZIP 覆盖原目录                                    |
| Linux x64 / arm64，beta.5～18                    | 用原 `start.sh` 启动，离线导入相同架构的 Linux `.ccupdate`                     | 有兼容签名包时使用在线按钮，或离线导入          | 两种架构不能混用；完整升级恢复实测范围见 Release               |
| macOS Intel / Apple Silicon，beta.5～18          | 用原 `start.command` 或 `start.sh` 启动，离线导入相同架构的 Darwin `.ccupdate` | 有兼容签名包时使用在线按钮，或离线导入          | Intel 是 x64；Apple Silicon 通常是 arm64，仍以实际运行架构为准 |
| 从源码直接 `npm start`，或由服务管理器直接跑 API | 先改为固定安装根的 `scripts/launch.mjs`，再采用兼容签名包                      | 受管理启动器运行时可用在线/离线入口             | 见“源码与长期服务器”                                           |
| Docker，公开镜像或自行构建                       | 由宿主机更换镜像并保留原卷，见 Docker 专节                                     | 网页可检查版本，不能自行更换容器                | 不导入 `.ccupdate`，不挂载 Docker socket                       |
| beta.4 及更早、未知格式、换系统/架构             | 维护者先核对数据格式，按完整备份恢复到新目录过渡                               | 过渡成功后按新部署方式更新                      | 不直接套用同系统增量更新，也不要让旧程序读取未知新格式         |

**beta.18 及更早版本没有联网更新按钮。** 第一次先用离线包升级到 beta.19；之后新版本有兼容包时才可点击在线更新。升级到 beta.19 后检查不到更高版本是正常的，不表示安装失败。

## 所有方式都先做这几件事

1. 保存条目、地图等编辑器草稿，等到“所有更改已保存”。多用户部署通知其他人暂停编辑，安排短暂维护时间。
2. 主管理员在“工作台设置”创建并验证**完整备份**，确认显示恢复验证通过，再下载私有 `.ccbackup` 到另一处私人存储。JSON/Markdown 不包含原图片和完整安装资料，不能替代它。
3. 记录当前程序版本、世界和地图数量，并抽查一张含上传图片的条目。保留原安装根、实际数据位置和私有配置。完整备份含密码哈希、权限及数据库凭据，目前不加密，不要上传到 GitHub、公共镜像或公开网盘。
4. 确认磁盘空间足以同时保留旧程序、新程序和完整备份，且能下载 npm 运行组件。更新包镜像不负责加速 npm 依赖下载。

新安装的 `data/` 不一定是现有实例的实际数据位置。受管理实例以安装根 `.worldloom/current.json` 中的绝对 `dataDir` 为准；这个路径优先于环境变量。**已有资料却看到安装向导时，立即停止并核对路径，不要重新安装、填充范例或初始化。**

## Windows、Linux、macOS：第一次离线升级

### 1. 下载匹配的更新包

从[发行页](https://github.com/hachimenHato/chronicle-cartarium/releases)下载对应系统和**实际后端进程架构**的文件。beta.19 的标准名称如下；没有对应附件时先等待发行完善，不要拿 ZIP/TAR 代替。

| 系统 / 架构               | 更新包                                                    |
| ------------------------- | --------------------------------------------------------- |
| Windows x64，含桌面版后端 | `chronicle-cartarium-0.2.0-beta.19-win-x64.ccupdate`      |
| Linux x64                 | `chronicle-cartarium-0.2.0-beta.19-linux-x64.ccupdate`    |
| Linux arm64               | `chronicle-cartarium-0.2.0-beta.19-linux-arm64.ccupdate`  |
| macOS Intel x64           | `chronicle-cartarium-0.2.0-beta.19-darwin-x64.ccupdate`   |
| macOS Apple Silicon arm64 | `chronicle-cartarium-0.2.0-beta.19-darwin-arm64.ccupdate` |

普通 ZIP/TAR 是**新安装包**，不能改后缀冒充更新包。Windows 桌面 ZIP 与 CMD ZIP 也不作为后台更新包使用。可先按发行页的 `SHA256SUMS.txt` 核对下载，后台还会用内置公钥验证官方签名、每个文件、版本和数据格式；不需要导入任何新公钥。

### 2. 在原工作台导入

1. Windows CMD 版双击**原安装根**的 `start.cmd`。Linux 在原根目录执行 `sh start.sh`；macOS 双击原 `start.command` 或执行 `sh start.sh`。当前平台发行包含匹配的运行时；不要把 Windows `node.exe` 搬到其他系统。
2. 桌面版直接打开原窗口。如工作台在别处，用“工作台 → 打开已有工作台…”选择包含 `scripts/launch.mjs` 和 `package.json` 的原程序根目录，不能只选 `data`。
3. 使用主管理员账号进入“工作台设置 → 程序更新”。旧界面直接点“选择更新包”；新界面展开“离线导入更新包”。选刚下载的 `.ccupdate`。
4. 等待签名、文件和兼容检查通过，确认目标版本为 beta.19，再点击“备份并更新至 …”。系统自动准备运行组件、暂停写入、备份与恢复验证、切换和核对资料。
5. 等待完成提示。更新过程中不要关启动终端、退出桌面应用、重启服务器或手动删除 `.worldloom`。

### 旧 Linux/macOS 首次过渡的 npm 查找

beta.18 及之前的 Unix 更新工作器可能从系统查找 npm；仅带便携运行时、没有系统 npm 的电脑，需要在**原安装根**用终端启动一次。先退出旧实例，然后执行：

```sh
export npm_execpath="$PWD/runtime/node_modules/npm/bin/npm-cli.js"
./runtime/node "$npm_execpath" --version
sh start.sh
```

第一条必须在原安装根执行，使路径固定为原包内的 npm CLI；第二条用于确认这个文件可由附带 Node 正常运行。然后在该次启动的网页中离线导入 beta.19，保持这个终端运行直到完成。若前置版本来自源码且没有 `runtime/`，确认系统的 `node --version` 为 22.18+、`npm --version` 能成功，再用原 `sh start.sh` 启动即可。不要为此更改数据库连接或数据目录。

beta.19 起改为直接使用已验签更新包中的 npm CLI，不再依赖系统 PATH 或此临时变量；本次更新完成后正常退出临时终端，以后正常使用原 `start.sh` / `start.command`。Windows 不需要这个 Unix 过渡步骤。

后台 `.ccupdate` 更新继续沿用当前启动器使用的 Node，不覆盖工作台安装根的运行时文件。桌面壳的完整更新包另带窗口及运行组件，但也不会用新模板覆盖已有 `workspace`；附接外部 CMD 服务时不替换该服务的运行时。需要另外维护工作台 Node 大版本时，单独备份、停机并验证，不能混用各系统或架构的运行组件。

## beta.19 起：在线更新与离线备用

主管理员打开“工作台设置 → 程序更新”，点击“检查更新”。有适配当前系统与架构的更高版本时，点击“下载并安全更新”，随后自动下载、验证并进入同一保护流程。无需 GitHub 账号或令牌。

测试版默认使用“预览版”渠道；切换“稳定版”后不会显示 alpha/beta/rc。成功检查缓存约 15 分钟，网络失败至少等待 1 分钟再重试；任务进度轮询只读取本机，不持续请求 GitHub。没有兼容签名附件时会说明原因，不能用普通安装包绕过。

下载期间仍可以创作，最终备份包含安装前已经保存的新内容。为避免意外重启，建议保存后留在更新页面：若下载途中出现未保存内容、切到后台/隐藏窗口、关闭设置或刷新页面，自动安装意图会清除。下载包保留，回到页面保存完毕后手动点击“备份并更新”继续；恢复保存状态不会突然续装。只允许取消下载，开始验签后不可取消；提交安装后不能用下载取消按钮中断备份或切换。

更新完成不会强制刷新正在编辑的网页。其他旧窗口若仍有草稿，应先复制保留，再刷新并重新登录；旧页面直接写入新版会被拒绝。若网络不可用，始终可以采用上一节的离线导入。

### 使用国内镜像

默认从 GitHub 下载，目前没有内置的国内加速站。项目维护者可以搭建公开 HTTPS 静态镜像，普通用户不必各自搭站。

在“更新来源与渠道”选择“自建镜像”，填写维护者给出的根地址，例如 `https://downloads.example.com/chronicle-cartarium`，保存后重新检查。地址不含账号、密码、查询参数或片段；内网地址不支持。镜像失败会尝试 GitHub，两个来源都必须通过同一套官方签名验证。没有镜像地址就继续使用 GitHub，不要填写来源不明的代理地址。

镜像目录、生成工具与安全边界见[镜像维护说明](update-strategy.md#github与国内镜像)。镜像可同时转发桌面 ZIP 和对应的 `.update.json` 签名描述；不包含它们时桌面更新会尝试 GitHub。此镜像不加速 Docker 镜像或 npm 依赖。

维护者使用腾讯云 COS 时，按[专用桶、域名与 GitHub 自动同步教程](tencent-cos.md)配置即可。凭据只交给维护者的发布环境；普通用户只填写经维护者验证可用的 HTTPS 镜像根地址，不提供腾讯云密钥，也不需要自建存储桶。

## Windows 桌面 EXE 外壳怎样更新

后台在线或离线更新的是原 `workspace` 中的工作台后端，**不会替换 Electron 窗口壳**。如果发行说明要求更新桌面壳：

### beta.19 起：在窗口里自动下载、安装和重开

1. 确认桌面壳与当前打开的原 `workspace` 后端都已是 beta.19 或以后版本。旧工作台先在后台离线导入对应 Windows `.ccupdate` 升到 beta.19；仅换新 EXE 不会升级后端，缺少新维护接口时菜单会拒绝更新并提示先升级后端。保存编辑内容，等待保存完成，以主管理员身份操作；开启登录时先登录主管理员账号。
2. 在原生菜单选择 **帮助 → 检查桌面程序更新…**。它会沿用后台设置的渠道/镜像偏好；没有镜像就使用官方 GitHub。
3. 有兼容新版时点“下载并安装”。关闭下载小窗可以取消下载；进入验签、解压和备份后请等待。完整桌面 ZIP 最大512MiB，解压最大2GiB，安装位置需至少3GB空闲空间。
4. 程序验证独立的官方 Ed25519 桌面签名清单、ZIP 摘要和全部解压文件，自动创建并验证完整工作台备份，然后退出窗口。
5. 独立助手等待旧窗口退出，启动新版并核对原账号、工作台路径及资料摘要；确认后才切换桌面启动指针。重新登录，在“帮助 → 关于编年图志”查看实际运行的桌面版本。

新版完整程序放在原安装根 `.desktop/releases/` 的独立目录，原 EXE 作为固定入口继续保留。以后双击原 EXE 会自动转到已验证新版；这里的原 EXE 指首次具备自动更新功能的 beta.19 或以后入口，未手动换壳的 beta.18 EXE 没有此转发能力。原入口文件的 Windows 属性可能仍显示旧版本，以“关于”中的实际运行版本为准。原 `workspace`、`.desktop/settings.json`、账号、图片、数据库连接及后端 `.worldloom/current.json` 不会被模板覆盖。旧程序目录与备份保留，暂不自动清理。

未保存内容会阻止桌面安装，普通用户和次级管理员不能发起。附接外部 CMD 服务时不会停止该服务；自己的服务会正常停止并由新版连接原工作台。若新版未能启动，原入口指针保留；已经退出的新进程会尝试自动重开原程序，未退出的失败窗口需先关闭再从原 EXE 重开。此流程**不会恢复旧资料快照**，也不会把确认更新后产生的新创作覆盖成旧内容。强退/断电/安全软件干预的所有组合尚未完整验收，遇到中断先保留目录和备份。

桌面包仍没有 Windows 商业 Authenticode 签名；应用内官方更新签名与 Windows 发布者证书是不同的机制。

### beta.18 及以前的一次手动过渡，或手动备用

旧桌面 EXE 不会因为后端升级而出现新菜单。需要先将原工作台后端用签名 `.ccupdate` 升到 beta.19，再按下面步骤换成 beta.19 桌面壳一次；两者都升级后才可使用窗口自动更新。已经先换好新壳的用户，打开原工作台后先完成后台签名升级，再使用原生菜单。程序不会为了兼容旧后端而跳过维护租约。网络不便或需要手动处理时也可沿用此方法。

1. 保存资料、下载验证过的完整备份，记下当前工作台根目录，然后正常退出桌面窗口；等待它自己启动的服务结束。若连接的是外部 CMD 服务，按原方式停止该服务。
2. 将新版桌面 ZIP **完整解压到新的可写目录**，保留所有 DLL 和资源，不能只换一个 EXE。
3. 运行新 EXE，使用“工作台 → 打开已有工作台…”选择原 `workspace`（或原 CMD 程序根）。新位置最初出现的是它自己的空工作台时，先打开原工作台，不要把空白状态当作资料丢失。
4. 用原账号检查版本、世界、地图及图片。原 `workspace`、原 `.desktop` 和完整备份都保留，验收前不要删除旧桌面目录。

不要把新模板复制覆盖已有 `workspace`，也不要删 `workspace` 来强迫使用新版。换壳不等于后端已更新：仍需按前面流程单独升级后端。详细行为见[桌面说明](desktop.md)。

## 源码与长期服务器

### 启用受保护更新

`npm start` 或直接运行 `server/index.ts` 属于手动管理，后台只会提示改用启动器。保存和备份后，先正常停止原进程，再从**同一个安装根**启动：

```sh
node scripts/launch.mjs
```

已有 `.worldloom/current.json` 保留，不能删它来重置版本。Linux/macOS 发行包也可用 `sh start.sh`，Windows 可用 `start.cmd`。之后采用相同系统/架构的在线或离线更新。

systemd 或 Windows 服务管理器应监督固定安装根的 `node scripts/launch.mjs`，工作目录也固定在该安装根。服务账号需能写 `.worldloom` 和实际数据目录；更新只重启启动器自己的 API 子进程，不需要服务管理器杀掉所有 Node 进程。保留原环境、HTTPS、反向代理和访问端口。不要把服务指向某个 `.worldloom/releases/...` 子目录，因为它会随版本变化。

systemd 中应把 `ExecStart` 设为 Node 的绝对路径加固定 `scripts/launch.mjs`，`WorkingDirectory` 指向固定安装根。Windows 服务同理，不能把会暂停等待键盘的 `start.cmd` 当服务入口。修改服务定义后的重载/重启用原服务名执行，不使用会影响其他应用的全局进程清理命令。

### 没有兼容更新包、旧版过渡或需要换安装根

优先使用签名更新器。手动迁移时不要直接覆盖运行目录；尤其不要把整个新目录的空 `data/`、`.worldloom` 或示例配置盖到旧目录。

以下方式保留原实例和原数据，适合由维护者操作：

1. 核对新程序与备份的格式兼容；取得完整 `.ccbackup`，正常停止原实例，保留旧程序、实际数据及私有配置。
2. 将新平台包解压到独立新安装根；源码发行则在新根执行 `npm ci` 和 `npm run build`。**先不要运行新程序或安装向导。**
3. 在新根用附带的匹配运行时恢复备份到全新绝对目录。恢复工具在目标已有时会拒绝，不会覆盖原数据。Windows 把下例 `node` 换成 `runtime\node.exe`；Linux/macOS 可换成 `./runtime/node`。首次依赖尚未准备时，先执行 `./runtime/node ./runtime/node_modules/npm/bin/npm-cli.js ci`（Windows 为 `.\runtime\node.exe .\runtime\node_modules\npm\bin\npm-cli.js ci`），仅准备锁定组件，不启动向导；不能借用旧系统的 `node_modules`。

```sh
node --import tsx scripts/recover.ts /private/verified-backup.ccbackup /private/new-cartarium-data
```

Windows 便携包的 PowerShell 例子如下；路径仅为占位示例，目标目录必须尚不存在：

```powershell
.\runtime\node.exe --import tsx scripts/recover.ts 'D:\Cartarium-private\verified-backup.ccbackup' 'D:\Cartarium-private\new-data'
```

MySQL 再提供一个**尚不存在的新项目库名**，必须可连接备份中配置的服务器并有建新库权限；不能填原库或其他已有库：

```sh
node --import tsx scripts/recover.ts /private/verified-backup.ccbackup /private/new-cartarium-data cartarium_recovery_new_unique
```

4. 恢复验证成功后，在新根首次启动前设置绝对 `DATA_DIR` 为恢复目录。若新根已经有 `.worldloom/current.json`，停机后只将其 `dataDir` 改成这个恢复目录，并保留正确 `program` 指针；该指针优先于环境变量。私有 `environment.env` 不自动应用，维护者需私密核对原环境、端口及 HTTPS 设置，不把原数据库连接重新注入到另一份已恢复实例。
5. 只启动新实例，检查原账号、权限、图片和内容数量。验收前不允许他人继续创作，保留原数据和旧程序。切换域名或服务定义后，确认仍指向此新根及恢复目录。

上例是占位路径，需替换成自己的私有绝对路径。备份迁往另一个 MySQL 服务器不是自动换库向导，需要另行维护连接配置。beta.4 或更早的数据格式应由维护者先验证对应恢复路径，不把未知格式强行送给当前恢复器。

## Docker：由宿主机操作

Docker 网页不能更换容器，也不要给网页容器挂载 Docker socket。`.ccupdate` 不用于 Docker；容器用镜像更新。公开镜像为 `ghcr.io/hachimenhato/chronicle-cartarium`，版本及完整摘要从官方 Release 取得。镜像摘要固定内容，但目前没有 OCI 发布者签名验证，来源仍需维护者确认。

### 每次先确认原项目、文件和数据位置

下面使用占位项目名 `YOUR_PROJECT`，必须替换为**现有** Compose 项目名；不要临时换新名字。如果最初未显式指定项目名，先从现有应用容器的 `com.docker.compose.project` 标签确认，不猜测或用新的目录名代替。

先在原部署目录查看应用容器和数据挂载：

```sh
docker compose -p YOUR_PROJECT -f docker-compose.image.yml ps -q app
```

将上一步的容器 ID 填入下例；输出仅供私人维护记录，不要公开完整 inspect 或环境变量：

```sh
docker inspect --format '{{.Image}}' CONTAINER_ID
docker inspect --format '{{range .Mounts}}{{println .Type .Name .Source .Destination}}{{end}}' CONTAINER_ID
docker compose -p YOUR_PROJECT -f docker-compose.image.yml exec -T app node -e 'console.log(process.env.DATA_DIR)'
```

记下旧镜像 ID、卷名或绑定源、容器目标路径与有效 `DATA_DIR`。源码 Compose 将以上 `-f docker-compose.image.yml` 换成原 `-f docker-compose.yml`。若已经使用 `.worldloom/docker-update.json` 或自己的其他覆盖文件，**每个后续 Compose 命令继续追加原来的 `-f` 文件**，不要丢掉它们；覆盖文件可能保存失败恢复后使用的新数据路径。

以下手动例子针对原始单文件 `docker-compose.image.yml`、数据在 `/app/data` 的部署。自定义位置、多个配置文件或失败恢复过的实例，维护者必须相应替换路径与完整参数；不要原样复制命令后忽略这些差异。

### 方式 A：使用公开镜像的手动保护流程

1. 全部用户保存并停止编辑，按本指南开头下载一份已经验证的完整私有备份。保留旧镜像，记录原项目和卷；本节宿主机流程尚未完成全场景实机验收，先在副本演练。
2. 在原 Compose 文件中**只更新 `app.image`** 到官方本版版本/可信摘要，保留端口、环境、卷及项目身份。拉取不会启动新容器，[Docker pull 说明](https://docs.docker.com/reference/cli/docker/compose/pull/)：

```sh
docker compose -p YOUR_PROJECT -f docker-compose.image.yml pull app
```

3. 在仍运行的原应用中进入维护并创建完整、验证过的备份。记录返回的 `full-...` 备份 ID；这一步会暂停写入，后续未成功前不要让用户重新编辑：

```sh
docker compose -p YOUR_PROJECT -f docker-compose.image.yml exec -T app node --import tsx scripts/docker-maintenance.ts backup
```

4. 把这份新备份复制到宿主机的私人目录；将 `FULL_BACKUP_ID` 替换成上一步返回的 ID，`private-backup` 目录先自行创建且限制访问。备份是包含 `manifest.json` 的目录，整目录保留，不能只复制数据库文件：

```sh
docker compose -p YOUR_PROJECT -f docker-compose.image.yml cp app:/app/data/backups/FULL_BACKUP_ID ./private-backup/FULL_BACKUP_ID
```

5. 确认复制完成后只停止并替换 `app`，不删除卷、不换项目名。新容器会读取原卷中的维护状态，继续禁止写入：

```sh
docker compose -p YOUR_PROJECT -f docker-compose.image.yml stop app
docker compose -p YOUR_PROJECT -f docker-compose.image.yml up -d --no-deps --no-build app
```

6. 核对新容器的卷身份与刚才记录相同，等待应用就绪，再检查完整资料。检查失败时保持维护，不执行下一条 `complete`，转到下文失败处理：

```sh
docker compose -p YOUR_PROJECT -f docker-compose.image.yml exec -T app node --import tsx scripts/docker-maintenance.ts check FULL_BACKUP_ID
```

7. 只有检查明确成功后，才持久化完成状态并开放保存：

```sh
docker compose -p YOUR_PROJECT -f docker-compose.image.yml exec -T app node --import tsx scripts/docker-maintenance.ts complete
```

8. 重新登录并按文末清单验收。普通 `pull` / `up` 本身没有上述完整备份和资料校验；不要跳过中间步骤。[Compose up 会重建变化的容器并保留挂载卷](https://docs.docker.com/reference/cli/docker/compose/up/)，前提是仍使用正确的原配置和原卷。

### 方式 B：从源码构建镜像

保留原部署目录、原 `docker-compose.yml`、私有 `.env`、项目名及卷配置。先取得官方目标版本源码，审阅并保留自己的 Compose 配置；如果使用 Git 且有本地修改，先私密保存、合并这些修改，不使用强制 reset/clean 清理安装目录。

若已有覆盖文件将 `app.image` 固定为旧镜像，构建前把该项改为一个新的本地标签，例如 `chronicle-cartarium-local:0.2.0-beta.19`，保留原 `DATA_DIR`、维护字段和其他配置；构建与启动都使用同一组 `-f` 文件。否则 `up --no-build` 可能继续使用覆盖文件指定的旧镜像，而不是刚构建的内容。

先构建，不先替换正在运行的容器：

```sh
docker compose -p YOUR_PROJECT -f docker-compose.yml build --pull app
```

`build --pull` 更新构建基础镜像并构建本地应用，它不同于拉取本项目预构建镜像，[Docker build 说明](https://docs.docker.com/reference/cli/docker/compose/build/)。构建成功后，按方式 A 的第 3～8 步执行维护备份、宿主复制、停止、`up --no-build`、`check` 和 `complete`；**把所有 `-f docker-compose.image.yml` 换成原 `-f docker-compose.yml`，并保留已有覆盖文件。** 不要把原源码项目改成一个新 Compose 项目。

### 方式 C：固定 Compose 的宿主机更新工具

仓库另提供 `scripts/update-docker.mjs`，会拉取目标镜像、核对实例和挂载、备份与验证宿主副本、切换、检查并尝试失败恢复。它只读取当前目录的 **`docker-compose.yml`**；没有 `--compose-file` / `-f` 选项，不能直接用来更新仅有 `docker-compose.image.yml` 的部署。它也只接受可拉取的可信完整摘要镜像，不用于刚构建、尚未发布的本地镜像。

仅当部署本来就使用这份固定文件、实例身份及挂载核对无误，且在副本演练过时，宿主机安装 Node 22.18+ 后可在原目录运行：

```sh
node scripts/update-docker.mjs YOUR_PROJECT ghcr.io/hachimenhato/chronicle-cartarium@sha256:REPLACE_WITH_64_HEX_DIGEST
```

该摘要是占位符，替换成官方 Release 的完整 64 位十六进制摘要。脚本不能代替 OCI 身份签名；宿主机更新、断电续作与失败恢复尚未全部实机验收。成功后其输出的 `.worldloom/docker-update.json` 必须继续参与以后的 Compose 命令，否则可能丢掉所选镜像或恢复数据路径。

### Docker 更新中断或检查失败

先保持现有卷和维护状态，保存原镜像 ID、配置、备份 ID和错误信息。不要用删除卷、重建项目或重新初始化来“修复”。方式 A/B 的手动流程不提供自动回滚；方式 C 若报告自动恢复未完成，也需要维护者处理。

在新版尚未开放写入时，维护者使用原镜像和刚才的完整备份，恢复到原持久卷内的**全新数据目录**；MySQL 恢复使用全新项目库，不能覆盖原库。容器内的 `scripts/docker-maintenance.ts recover` 接受只读挂载的已验证备份目录并返回新数据路径；需要沿用原网络、原卷挂载与数据库访问。然后在原 Compose 覆盖配置中将 `DATA_DIR` 指向返回的新目录，再用旧镜像启动并核对。绑定挂载、多网络、远程数据库等自定义情况由维护者按原实例适配，不能猜测卷名或网络名。

新版已显示完成并允许编辑后，不要自动恢复更新前快照覆盖新内容；应先为当前资料另做备份并诊断。仅缺少“开放保存”确认时，检查维护状态后重试 `complete` 或正常重启，不把网络回应丢失当作资料损坏。

**任何更新流程都不要执行 `docker compose down -v` 或删除数据卷。** `-v` 会删除相关命名卷，[Docker down 说明](https://docs.docker.com/reference/cli/docker/compose/down/)。也不要使用 `up -V` 重建匿名卷；本项目需要保持原持久挂载。

## 更新完成怎样确认

1. 程序更新区域显示成功；重新登录后版本是目标版本，原账号和权限仍在。
2. 世界、地图、角色和剧情数量与维护前相符，随机打开几项；上传的封面、立绘和地图底图能显示。
3. 原私密内容仍按权限隐藏，主管理员的完整备份列表可查看；下载备份保存在私人位置。
4. 在确认无异常后才恢复多人编辑。需要测试保存时先做一个可撤销的小修改并确认真实保存成功，不以界面按钮变色代替落盘成功。

## 失败时先做什么

下载失败、签名不符或不兼容会在安装前拒绝，原程序与资料保留。可稍后重试官方源或离线包；不要关闭验签、导入新公钥、改包版本号或删除安装配置绕过检查。

受管理更新在新版开放写入前失败，会尝试恢复可运行旧版和完整资料，保留原目录与备份；若提示恢复未完成，就保留现场停止继续写入，按[完整恢复说明](update-strategy.md#3-完整备份与迁机)恢复到新目录/新项目库。原版成功恢复也要再核对账号、图片与内容，不能仅看到页面打开就继续。

报告问题可提供版本、系统与架构、部署方式和不含隐私的错误提示。不要公开 `.env`、`mysql.txt`、安装/用户配置、控制钥匙、完整备份、真实创作目录或未脱敏日志。
