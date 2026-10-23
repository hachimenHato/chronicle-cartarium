# 维护者 COS 上传依赖

仅供官方更新镜像发布，不属于应用、桌面安装包或 Docker 运行依赖。

在本目录运行 `npm ci --ignore-scripts`，或在仓库根运行 `npm ci --prefix tools/cos-publisher --ignore-scripts`。固定使用腾讯云官方 `cos-nodejs-sdk-v5` 3.0.0（ISC 许可），上游地址：<https://github.com/tencentyun/cos-nodejs-sdk-v5>。完整许可位于安装后 SDK 的 LICENSE 中。

不要在此目录放 SecretId、SecretKey、临时令牌、上传配置或真实备份。GitHub 发布器仅在最终上传步骤从 Environment Secrets 读取凭据，普通用户只需要公开镜像地址。

配置操作见 [COS 教程](../../docs/tencent-cos.md)。`prepare` 下载固定官方 GitHub 附件；`publish` 只允许已经净化且经原公钥验证的镜像文件，永不全目录同步或删除对象。
