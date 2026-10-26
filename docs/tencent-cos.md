# 腾讯云 COS 国内更新镜像

本文供项目维护者配置发布流水线。**beta.20 用户在“工作台设置 → 程序更新 → 更新来源与渠道”直接选择“国内下载源（腾讯云）”并保存**，无需填写地址，不需要腾讯云账号或密钥。GitHub 仍是默认来源，自建镜像保留；Windows 桌面壳共享该偏好。beta.19 可先在线升级到 beta.20，或暂用自建镜像填写本文根地址。

方案使用一个**新建的项目专用存储桶**和 GitHub Actions；正式发布 GitHub Release 后，把已签名的更新附件同步到 COS，继续使用程序内置公钥验签。它不访问创作数据库、不上传用户资料，也不需要把发行签名私钥交给 GitHub 或腾讯云。

内置域名为 `files.hachimen.info`，但**内置选项不代表每个版本已同步完成**。GitHub Release 发布后才排队同步，全部文件上传并匿名全文校验后最后提交清单；以[同步任务](https://github.com/hachimenHato/chronicle-cartarium/actions/workflows/cos-mirror.yml)最终成功及公开回读结果为准，不以任务已开始或域名可访问代替验收。失败会尝试 GitHub；同一清单尚未出现新版时可稍后再查或改用 GitHub。桶名、APPID 和地域均以维护者实际创建的值为准，不需要填入用户程序。

国内源覆盖五平台 `.ccupdate`、Windows 桌面完整 ZIP 与配套签名描述，共七个更新文件及净化清单。Windows 桌面 ZIP 同步后也可用于首次下载；Windows CMD / Linux / macOS 完整首次安装包、Docker 镜像、npm 依赖暂不在此镜像内，仍使用各自官方入口。详见[首次下载与平台范围](update-guide.md#首次下载安装与国内源覆盖范围)。

## 1. 新建专用存储桶

在[腾讯云 COS 控制台](https://console.cloud.tencent.com/cos)创建一个新桶，建议如下：

| 项目         | 设置                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| 名称         | 可填写 `chronicle-cartarium-updates`，控制台自动附加你的 APPID；记录完整的 `chronicle-cartarium-updates-APPID` |
| 地域         | 可选上海 `ap-shanghai`，也可选你常用的中国大陆地域；后续配置必须一致                                           |
| 存储类型     | 标准存储，不使用需要解冻的归档存储                                                                             |
| 访问权限     | **私有读写**；下一节只公开更新目录的下载权限                                                                   |
| 版本控制     | **这个新专用桶不启用**；不调整其他桶的版本控制                                                                 |
| 更新目录前缀 | `chronicle-cartarium/updates`，不带开头或结尾 `/`                                                              |

不要复用存放私人文件、网站资料或备份的桶，不要上传完整工作台目录。先保留默认配置，不需要开启静态网站、全球加速、CDN、对象锁定或自动过期删除。

本发布器依赖 `x-cos-forbid-overwrite` 保护已经存在的版本文件。腾讯云在**启用版本控制的桶中会忽略这个请求头**，因此发布器会先查询桶的版本控制状态，拒绝已开启或已暂停版本控制的桶。旧发行包保留在各自版本目录，而不是靠同名文件的历史版本保留。[腾讯云 PUT Object 说明](https://cloud.tencent.com/document/product/436/7749)

## 2. 只允许匿名下载更新目录

在新桶的“权限管理 → 存储桶访问权限 / Policy 权限设置”中添加下面的桶策略。界面名称可能随控制台版本略有变化。将 `REGION`、`APPID`、`BUCKET-APPID` 替换成实际值；`APPID` 是桶名末尾的开发商 APPID，不是 SecretId 或账号 UIN。

```json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "principal": {
        "qcs": ["qcs::cam::anonymous:anonymous"]
      },
      "action": ["name/cos:GetObject", "name/cos:HeadObject"],
      "resource": ["qcs::cos:REGION:uid/APPID:BUCKET-APPID/chronicle-cartarium/updates/*"],
      "condition": {
        "bool_equal": { "cos:secure-transport": "true" }
      }
    }
  ]
}
```

这只允许通过 HTTPS 下载和查询指定目录的文件；不允许匿名上传、删除、列出桶内容或读取其他路径。桶本身仍保持私有读写，不要改成公有读写。若控制台有“禁止公共访问”总开关，应仅针对**这个新建专用桶**按提示允许上述公开规则，不改变其他桶。[COS 访问策略语言](https://cloud.tencent.com/document/product/436/18023)、[HTTPS 条件键](https://cloud.tencent.com/document/product/436/71307)

更新请求由本地或服务器的 Node 程序发送，不依赖浏览器跨域，因此本方案**不需要开放 CORS**。防盗链如启用，必须允许空 Referer，否则桌面和服务器更新请求可能收到 403。公开下载会消耗请求次数和外网流量，建议设置费用和流量告警；Referer 不能作为可靠的客户端身份认证。[COS 跨域设置](https://cloud.tencent.com/document/product/436/13318)、[防盗链设置](https://cloud.tencent.com/document/product/436/13319)

## 3. 将 files.hachimen.info 绑定到新桶

中国大陆地域的 COS 自定义域名要求完成网站 / 域名 ICP 备案；只有 App 备案不足以接入。先核对 `hachimen.info` 对应的网站备案状态，未完成时先办理，不要假设有域名就能直接接入国内桶。[腾讯云自定义域名与备案要求](https://cloud.tencent.com/document/product/436/102509)

1. 在新桶的“域名与传输管理 → 自定义源站域名”添加 `files.hachimen.info`，**源站类型选择默认源站**。不需要开启静态网站或 CDN。
2. 复制控制台给出的 CNAME 目标。在 `hachimen.info` 的 DNS 服务商添加主机记录 `files`、类型 `CNAME`、默认线路，记录值填写该目标域名；不要带 `https://` 或路径。若 `files` 已有记录或用于其他服务，先核实用途，避免覆盖。
3. 为 `files.hachimen.info` 申请或选用有效的 HTTPS 证书，在 COS 自定义源站域名的“绑定证书”中配置，开启强制 HTTPS。证书和私钥只交给腾讯云证书管理界面，不放进仓库或聊天。
4. 按控制台提示完成域名所有权验证，等待 DNS、域名和证书生效。最终以实际 HTTPS 请求成功为准，不通过关闭证书校验绕过错误。

COS 支持直接托管源站域名的 HTTPS 证书，因此这套基础方案不需要另外租服务器或运行加速代理。[自定义源站域名配置](https://cloud.tencent.com/document/product/436/36638)

最终地址应为：

```text
镜像根地址：https://files.hachimen.info/chronicle-cartarium/updates
版本清单：  https://files.hachimen.info/chronicle-cartarium/updates/releases.json
版本附件：  https://files.hachimen.info/chronicle-cartarium/updates/vVERSION/标准附件名
```

`files.hachimen.info` 不负责自动映射目录；URL 中的 `chronicle-cartarium/updates` 必须与对象键前缀一致。可以以后再加 CDN，但先验证 COS 直连；接入后应让 `releases.json` 不缓存或短缓存，版本附件长期缓存，避免清单滞后。

## 4. 创建仅能发布本项目更新的子账号

在[腾讯云 CAM 控制台](https://console.cloud.tencent.com/cam)创建专用子用户，例如 `chronicle-cartarium-publisher`，仅开启程序访问。不要使用腾讯云主账号密钥，不要关联 `AdministratorAccess`、`QcloudCOSFullAccess` 或包含其他项目权限的用户组。

按“策略 → 新建自定义策略 → 按策略语法创建”，填写以下模板，替换三个占位符后绑定到这个子用户：

```json
{
  "version": "2.0",
  "statement": [
    {
      "effect": "allow",
      "action": [
        "name/cos:PutObject",
        "name/cos:HeadObject",
        "name/cos:GetObject",
        "name/cos:InitiateMultipartUpload",
        "name/cos:UploadPart",
        "name/cos:CompleteMultipartUpload",
        "name/cos:AbortMultipartUpload"
      ],
      "resource": ["qcs::cos:REGION:uid/APPID:BUCKET-APPID/chronicle-cartarium/updates/*"]
    },
    {
      "effect": "allow",
      "action": ["name/cos:GetBucketVersioning"],
      "resource": ["qcs::cos:REGION:uid/APPID:BUCKET-APPID/*"]
    }
  ]
}
```

第一条只允许在更新前缀上传、核对文件及处理本项目的分块上传；第二条只读检查这个桶的版本控制状态，资源格式依腾讯云桶级 API 规定包含 `/*`，**没有授予全桶对象读取**。没有授予删除已完成对象、列桶、修改 ACL、桶策略、版本控制或其他桶权限。`AbortMultipartUpload` 只用于舍弃发布器本轮创建但未完成的分块任务，不删除已完成版本。程序不列举或接管其他上传任务，也不需要 `ListParts` / `ListMultipartUploads`。[CAM 用户策略配置](https://cloud.tencent.com/document/product/436/68280)、[COS API 授权指引](https://cloud.tencent.com/document/product/436/31923)、[GetBucketVersioning 资源格式](https://cloud.tencent.com/document/product/598/69901)

**按旧教程配置过的维护者**：在现有项目专用策略的第一条 `action` 数组中，补充上面四个分块动作，保留原来的资源范围和其他读取动作；不需要重新创建桶、换密钥或把密钥发给任何人。腾讯云把分块动作与 `PutObject` 分别授权，只有简单上传权限不能完成分块上传。更新后的发布器用短分块处理大文件，权限不足时会明确报 `COS_MULTIPART_PERMISSION`，不会悄悄退回耗时的整包上传或启用收费加速。[腾讯云分块授权说明](https://cloud.tencent.com/document/product/436/65644)

为这个子用户创建 API 密钥。**不要把 SecretId、SecretKey 或临时 Token 发到聊天、Issue、README、源码或 Release。** 下一节由你直接填入 GitHub 的加密 Secrets。此专用子账号的长期密钥便于无人值守发布；应定期轮换。临时凭据也可用，但必须同时填 Token，过期后需要更新；它们不会自行续期。[腾讯云 SDK 凭据建议](https://cloud.tencent.com/document/product/436/8629)

## 5. 配置 GitHub 自动同步

打开项目仓库的 **Settings → Environments**，创建环境 `cos-production`。在 **Deployment branches and tags** 选择 **Selected branches and tags**，分别添加分支规则 `main` 和标签规则 `v*`，只允许本项目正式维护的版本标签；同时用仓库 Rulesets 限制这些标签的创建、修改和删除权限，不给任意分支或外部 PR 开放凭据。

不能只允许 `main`：手动运行选择 `main`，但 Release 事件的 `GITHUB_REF` 是对应版本标签，GitHub 按这个事件引用检查环境权限，**不会因为脚本检出 `main` 就把事件视为 main 部署**。工作流始终从受信任的 `main` 读取发布脚本，不执行下载包或 Release 标签中的代码。首次接入可开启 Required reviewers，核对一次后批准；运行稳定且需要全自动时，可取消每次人工审批，保留分支和标签限制。[GitHub 环境部署规则](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#deployment-branches-and-tags)、[Release 事件引用](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release)

在这个环境中添加下面的 **Environment secrets**，每个密钥单独存，不粘贴整份 JSON：

| Secret 名称                 | 内容                                     |
| --------------------------- | ---------------------------------------- |
| `TENCENT_COS_SECRET_ID`     | 专用子用户的 SecretId                    |
| `TENCENT_COS_SECRET_KEY`    | 同一子用户的 SecretKey                   |
| `TENCENT_COS_SESSION_TOKEN` | 仅使用临时凭据时填写；长期子用户密钥留空 |

在同一环境添加 **Environment variables**，这些配置不包含密码：

| Variable 名称           | 内容                                                                       |
| ----------------------- | -------------------------------------------------------------------------- |
| `COS_BUCKET`            | 你的完整新桶名，包含 APPID 后缀                                            |
| `COS_REGION`            | 你的实际地域代码，例如 `ap-shanghai`                                       |
| `COS_PREFIX`            | `chronicle-cartarium/updates`                                              |
| `COS_PUBLIC_BASE_URL`   | `https://files.hachimen.info/chronicle-cartarium/updates`                  |
| `COS_UPLOAD_ACCELERATE` | 可选，默认留空或 `false`；确认启用桶的收费全球加速后才填 `true`，见第 9 节 |

最后到 **Settings → Secrets and variables → Actions → Variables** 添加**仓库级变量** `COS_ENABLED`，值为 `true`。它是独立的启用开关，不能只建成 Environment variable。未设置或不是 `true` 时，自动同步不运行；准备阶段建议先不启用，等桶、策略、域名与 Secrets 配完后再开启。

Secrets 不会随正常源码下载公开，但有仓库写入权限的人可以修改工作流来调用凭据；仅给可信维护者写权限，保护 `main`，审查发布脚本和工作流修改。工作流只在上传步骤注入 COS 凭据，不把它们传给程序构建，也不产出包含凭据的配置或日志。GitHub 日志遮罩不是绝对保证，不能用打印密钥来检查配置。[GitHub Secrets 设置](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)、[GitHub Actions 安全建议](https://docs.github.com/en/actions/reference/security/secure-use)

## 6. 首次补传旧版，以及以后怎样发布

新桶最初是空的；以前已经发布的 beta.19 不会因为新增工作流而自动补传。在仓库 **Actions → 同步腾讯云更新镜像 → Run workflow**，选择 `main`，输入目标标签 `v0.2.0-beta.19` 后运行一次。

后续 beta.20 等版本继续按下面的正式发布流程触发；已有旧版任务时排队等待，不并行写同一前缀，也不要为普通发布取消仍在持续传输的任务。

流水线从本项目的**公开 GitHub Release**下载允许的更新附件，核对大小和 SHA-256，并验证官方签名。仅上传五个平台的 `.ccupdate`、Windows 桌面 ZIP、配套 `.update.json` 和净化后的 `releases.json`；不会把源码目录、GitHub 其他附件、数据库、图片、私有备份或发行私钥同步到桶。

版本附件先上传并校验，清单最后切换；已有同名同内容附件可复用，同名不同内容会拒绝，不覆盖旧版本文件，也不执行远端删除。固定并发组防止两次本仓库发布互相穿插；这个专用前缀请只交给此发布器写入，不同时使用手动上传或其他同步程序。

以后仍按原流程构建、扫描、签名、先上传全部 Release 附件，再将 Release 正式发布。工作流监听 `release.published` 自动同步，包含预发行版；草稿不触发。同步失败不会删除 GitHub 的发行或已存在的 COS 文件，修好配置后对相同标签手动重跑。

**在 GitHub Actions 中使用默认 `GITHUB_TOKEN` 创建 / 发布 Release，不会再触发另一个 `release.published` 工作流。** 如果将来把发行也改成 CI 自动化，发布步骤完成后必须显式触发本同步工作流的 `workflow_dispatch`（这是 GitHub 允许的例外，并需相应 Actions 权限），或在同一受保护的发布流程中显式执行同步步骤；也可改用受限 GitHub App / 维护者 PAT 发布以产生下游事件。不要仅配置“Release published”就假设任何 CI 发布都会同步。当前维护者通过本机已授权的 GitHub CLI / API 或 GitHub 网页发布，可正常触发该事件；Actions 里的 `gh release` 如果使用的仍是 `GITHUB_TOKEN`，同样受上述限制。[GitHub 工作流触发规则](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow)

首次成功后确认：

1. Actions 结果成功，显示已核验的版本与文件数量。
2. 未登录的浏览器可下载 `https://files.hachimen.info/chronicle-cartarium/updates/releases.json`；清单只包含公开发行信息，不含腾讯云凭据或用户资料。
3. 从清单中选一个已上传附件，确认同一域名与版本路径可下载；程序仍执行签名校验。
4. 用主管理员在 beta.20 的“工作台设置 → 程序更新 → 更新来源与渠道”选择“国内下载源（腾讯云）”，保存后重新检查，无需填写地址。beta.19 后端仍可选“自建镜像”填写上面的**镜像根地址**。Windows 桌面“帮助 → 检查桌面程序更新…”沿用同一设置；后端升级到 beta.20 并选好国内源后，原 beta.19 壳也能直接读取并升级，无需先升级壳或重新填地址。旧壳可能将它显示为“自建镜像”。

清单中没有高于当前版本的兼容包时，显示已是最新版是正常的；同步中也可能暂时只有旧版。镜像不加速 Docker 镜像、Electron 首次构建或 npm 依赖下载；不更改用户的资料目录或数据库。维护者应先完成该版本实际 COS 上传、匿名下载及程序取包验证，再声明该版本已在国内源可用。程序选择来源本身不保证网络速度或可用性。

## 7. 本机手动发布（可选）

推荐使用 GitHub Secrets，让换电脑后的发布不需要复制腾讯云密钥。需要本机应急时，可在项目私有 `.runtime/cos-publisher.env` 保存上述 `TENCENT_COS_*` 和 `COS_*` 项，限制该文件访问权限。`.runtime/` 已忽略，但不要把忽略规则当成打包安全边界；只上传发布器核验后的白名单。

以下命令在**项目源码根目录**执行，需 Node 22.18+。准备阶段只读取公开发行，不需要 COS 密钥；输出必须是尚不存在的新目录：

```sh
npm ci
npm ci --prefix tools/cos-publisher --ignore-scripts
node --import tsx scripts/publish-cos-mirror.ts prepare --tag v0.2.0-beta.20 --output .runtime/cos-stage-first
```

准备目录内会生成 `packages`、`catalog.json` 和可发布的 `mirror`，上传时明确指定后者：

```sh
node --env-file=.runtime/cos-publisher.env --import tsx scripts/publish-cos-mirror.ts publish --directory .runtime/cos-stage-first/mirror
```

不要把密钥写在命令参数里，也不要执行输出全部环境变量的诊断。若准备目录已存在，换一个新名称；不要为重新准备而清空真实数据目录。上传步骤不会为你创建桶、配置 DNS、修改公共访问策略或启用版本控制；这些操作由你在控制台完成。

## 8. 常见问题和密钥轮换

首次同步时桶里还没有 `releases.json`，发布器会把 SDK 的空响应 `404` 视为正常的“尚无清单”，核验完版本文件后自动创建；不需要手动上传空清单。权限错误、桶不存在或其他服务错误不会被当作空桶忽略。

首次同步会上传各平台更新文件，再逐个匿名下载核对完整内容，跨境网络较慢时需要等待。日志显示当前文件序号、上传 MiB 进度及回读校验阶段；上传进度限频输出。普通线路最多并行处理三个不同文件，每个文件仍完整上传并核验，全部成功后才提交清单。维护者工作流最多等待 360 分钟，公开回读单文件总时限为 3 小时，连接/响应头和无数据等待仍受原超时保护。应用自身的更新下载等待设置不受影响。

不降低完整性校验或改成公开写入。文件完成上传或分块合并后才作为完整对象可见，上传期间看到该文件 404 不代表失败；以工作流最终状态为准。若任务被中断，已完整上传的相同文件可在重跑时复用并重新核验。大文件按 4 MiB 分块，本轮中断只重试失败分块，已经成功的块不重复上传；不跨云端执行机续传，新的工作流仍需重新开始未完成文件。同步由 GitHub 云端执行，关闭个人电脑、退出浏览器不会终止任务。

已知网络中断、超时与可重试的服务端 5xx 允许有界重试；大文件的每个分块最多进行 3 次应用层上传尝试，每次创建该分块的新只读流。小文件仍采用简单上传和原来的 HEAD 复核；已完整对象复用后仍须匿名全文 SHA 校验。未识别的 HTTP 400、权限 403、同名对象长度冲突等永久错误不盲目重试，不覆盖版本文件；明确识别为请求超时或请求体不完整的 400 才在白名单内。初始化与完成等小请求还受固定 SDK 自身的有界重试约束。只看到 HTTP 400 时不能据此断定具体是超时，需要保留安全诊断进一步核查。

分块初始化保存整文件 SHA 元数据，本地所有块的整文件 SHA 与已验证的发行摘要一致后才请求合并，完成请求再次携带禁止覆盖头；合并后仍匿名下载核验，全部版本文件通过后才发布清单。发布器只舍弃自己本轮创建且收到 ID 的分块会话，不枚举、删除或接管其他任务；已完成会话的舍弃请求只会返回不存在，不删除已完成对象。初始化回执丢失时，SDK 的内部重试可能创建未返回 ID 的会话，发布器无法确认其归属；这类会话及强制终止后未清理的分块需由维护者在专用桶控制台检查处理，不要删除已完成版本文件。SDK 高级自动分块接口未被采用，避免其完成请求丢失禁止覆盖头。[Complete Multipart Upload 防覆盖说明](https://cloud.tencent.com/document/product/436/7742)

失败日志只输出固定诊断代码、合法 HTTP 状态与白名单中的腾讯云错误名称，不输出原始 SDK 异常、签名链接、请求头或凭据。例如 `COS_BUCKET / HTTP_403 / AccessDenied` 表示检查桶版本控制时被拒绝，`COS_HEAD / HTTP_403` 表示查询对象被拒绝，`COS_WRITE / HTTP_403 / AccessDenied` 表示上传被拒绝；先检查对应子账号权限，不要通过公开写入权限来绕过。

| 现象                                 | 先检查                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 工作流没运行                         | 仓库级 `COS_ENABLED=true`；首次旧版需手动运行；工作流是否已在 `main`                             |
| 等待审批、环境被拒绝或找不到 Secrets | 是否使用 `cos-production` 环境；是否分别允许分支 `main` 与标签 `v*`；是否等待 Required reviewers |
| 上传 403                             | 子用户策略中的 APPID、地域、完整桶名和目录是否一致；上方策略动作是否齐全，尤其四项分块权限       |
| 匿名下载 403                         | prefix 公共策略、HTTPS 条件、桶的公共访问阻止设置及空 Referer；不能用加进公开链接的临时签名绕过  |
| 证书或域名错误                       | CNAME 指向新桶；COS 绑定的是 `files.hachimen.info`；证书覆盖此域名且未过期                       |
| 版本控制检查失败                     | 是否误选已有桶或已启用版本控制；使用全新的专用桶，不更改其他业务桶                               |
| 同名内容冲突                         | 保留现场并核查发行附件，使用新版本修复；不要覆盖同标签旧包或禁用无覆盖保护                       |
| 清单仍旧                             | 等待程序检查缓存；若另接 CDN，核对清单缓存规则，勿把清单设为永久缓存                             |

密钥轮换时，创建同一专用子用户的新密钥，替换 GitHub Environment 中的两个 Secret；手动重跑并验证成功后禁用旧密钥。若怀疑泄漏，先禁用泄漏密钥、检查 COS 操作记录和公开内容，再处理日志与配置，不仅删除聊天或文件。COS 上传密钥与软件发行签名私钥用途不同：**不得为配置镜像而更换软件信任公钥或上传发行私钥。**

仓库提供的是发布工具和配置教程；真实桶权限、域名证书、流量费用，以及接入后的端到端结果需维护者实际核验。尚无可用 COS 配置或凭据时，只能完成本地与模拟测试，不能声称已经部署国内加速站。

## 9. GitHub 上传很慢时：可选的全球加速

GitHub 执行机向中国大陆 COS 上传可能受到跨境网络速度限制。发布器提供**默认关闭**的官方全球加速开关，仅供维护者上传；它不是下载用户必须开启的服务，也不会更改 `files.hachimen.info` 的公开下载地址。

**全球加速会产生额外流量费用，请先查看控制台当前价格并自行决定是否开启。** 首次同步 beta.19 约有 650 MB 更新文件需要上传，重试可能增加传输量，不能把它视为固定总价。[腾讯云全球加速概述](https://cloud.tencent.com/document/product/436/38866)、[流量费用](https://cloud.tencent.com/document/product/436/53863)

1. 在这个项目专用桶的“域名与传输管理 → 全球加速”中，阅读计费说明并确认开启。不要调整其他桶。
2. 在 GitHub 的 `cos-production` Environment variables 中，将 `COS_UPLOAD_ACCELERATE` 设为 `true`。仅配置变量不会替你开通腾讯云服务；桶必须先开通。
3. 下一次同步任务会用独立 SDK 实例的 `UseAccelerate: true` 上传文件。版本控制检查、HEAD / GET 查询和匿名公开回读继续走普通线路，不把不支持的桶级 API 发到加速域名。沿用相同子用户权限，不需要新增 CAM 权限或开放匿名上传。[Node.js SDK 全球加速设置](https://cloud.tencent.com/document/product/436/55438)
4. 只运行同一个串行工作流，输入同一标签重试即可。已存在的相同文件会复用并校验，不覆盖或删除不同内容的版本文件。新变量不会改变已经开始的旧任务。
5. 需要停用时，把 GitHub 变量改为 `false` 或删除；后续任务恢复普通上传。桶侧开关由你在腾讯云控制台管理。

加速是否有效仍以实际任务速率为准。软件继续执行原签名和 SHA 校验，清单仍在所有文件公开回读通过后才提交；加速无法替代正确的访问权限、域名证书或数据备份。
