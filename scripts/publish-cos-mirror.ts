import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { createUpdateDownloader, readUpdateJson } from '../server/update-download';
import { formatCosDiagnostic } from './lib/cos-diagnostics';
import { createCosProgressLogger } from './lib/cos-progress';
import { createPublicVerifier } from './lib/cos-public-verifier';

export { createPublicVerifier } from './lib/cos-public-verifier';

const REPOSITORY = 'https://github.com/hachimenHato/chronicle-cartarium';
const RELEASE_API = 'https://api.github.com/repos/hachimenHato/chronicle-cartarium/releases/tags/';
const TAG = /^v\d{1,9}\.\d{1,9}\.\d{1,9}(?:-(?:alpha|beta|rc)\.\d{1,9})?$/;
const MAX_FILE = 512 * 1024 ** 2;
const PREPARE_USAGE = 'prepare --tag v版本号 --output 全新准备目录';
const PUBLISH_USAGE = 'publish --directory 已准备的mirror目录';

interface PublicAsset {
  name: string;
  size: number;
  digest: string;
  browser_download_url: string;
  state: 'uploaded';
}

interface PublicRelease {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  draft: false;
  prerelease: boolean;
  published_at: string;
  assets: PublicAsset[];
}

interface MirrorBuilder {
  publicRelease(value: unknown): { version: string; release: PublicRelease } | undefined;
  createUpdateMirror(options: {
    catalog: string;
    packages: string;
    output: string;
  }): Promise<{ releases: number; packages: number }>;
}

// The existing builder is an ESM maintainer tool. Use its public sanitizer rather
// than maintaining another interpretation of the application mirror format.
async function mirrorBuilder(): Promise<MirrorBuilder> {
  return import(
    pathToFileURL(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'create-update-mirror.mjs'),
    ).href
  );
}

function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new Error('COS_INPUT_INVALID');
}

export type CosCliArguments =
  { action: 'prepare'; tag: string; output: string } | { action: 'publish'; directory: string };

/** No arbitrary repository, source URL, command, or credential CLI arguments. */
export function parseCosArguments(values: string[]): CosCliArguments {
  const [action, ...options] = values;
  requireValue(action === 'prepare' || action === 'publish');
  requireValue(options.length > 0 && options.length % 2 === 0);
  const result: Record<string, string> = {};
  const allowed = action === 'prepare' ? ['--tag', '--output'] : ['--directory'];
  for (let index = 0; index < options.length; index += 2) {
    const key = options[index];
    const value = options[index + 1];
    requireValue(
      allowed.includes(key) &&
        !Object.hasOwn(result, key) &&
        value &&
        value === value.trim() &&
        !value.startsWith('--') &&
        !/[\u0000-\u001f\u007f]/u.test(value),
    );
    result[key] = value;
  }
  requireValue(allowed.every((key) => result[key]));
  if (action === 'prepare') {
    requireValue(TAG.test(result['--tag']));
    return { action, tag: result['--tag'], output: result['--output'] };
  }
  return { action, directory: result['--directory'] };
}

interface PrepareDependencies {
  readJson?: typeof readUpdateJson;
  download?: ReturnType<typeof createUpdateDownloader>['downloadUpdateFile'];
}

/** Prepare public artifacts only. This stage never reads COS credentials. */
export async function prepareCosMirror(
  options: { tag: string; output: string },
  dependencies: PrepareDependencies = {},
) {
  requireValue(TAG.test(options.tag));
  const builder = await mirrorBuilder();
  const raw = await (dependencies.readJson ?? readUpdateJson)(RELEASE_API + options.tag);
  const sanitized = builder.publicRelease(raw);
  requireValue(sanitized && sanitized.release.tag_name === options.tag);
  requireValue(sanitized.release.html_url === `${REPOSITORY}/releases/tag/${options.tag}`);
  const version = sanitized.version;
  const prefix = `chronicle-cartarium-${version}-`;
  const canonical = new Set([
    ...['win-x64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'].map(
      (target) => `${prefix}${target}.ccupdate`,
    ),
    `${prefix}windows-desktop-x64.zip`,
    `${prefix}windows-desktop-x64.update.json`,
  ]);
  requireValue(sanitized.release.assets.length > 0 && sanitized.release.assets.length <= 7);
  requireValue(sanitized.release.assets.every((asset) => canonical.has(asset.name)));

  // Resolve an existing real parent and create exactly one new directory. An
  // existing directory, symlink, or previous failed run is never overwritten.
  const requested = path.resolve(options.output);
  const parent = await realpath(path.dirname(requested));
  const parentInfo = await lstat(parent);
  requireValue(parentInfo.isDirectory() && !parentInfo.isSymbolicLink());
  const directory = path.join(parent, path.basename(requested));
  await mkdir(directory, { mode: 0o700 });
  const packages = path.join(directory, 'packages');
  const catalog = path.join(directory, 'catalog.json');
  const mirror = path.join(directory, 'mirror');
  await mkdir(packages, { mode: 0o700 });
  await writeFile(catalog, JSON.stringify([sanitized.release]) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  const download =
    dependencies.download ?? createUpdateDownloader({ fileLimit: MAX_FILE }).downloadUpdateFile;
  for (const asset of sanitized.release.assets) {
    await download(
      asset.browser_download_url,
      path.join(packages, asset.name),
      { bytes: asset.size, sha256: asset.digest.slice(7) },
      () => {},
    );
  }
  const result = await builder.createUpdateMirror({ catalog, packages, output: mirror });
  return { directory: mirror, version, releases: result.releases, packages: result.packages };
}

export async function runCosCli(values = process.argv.slice(2)): Promise<void> {
  let phase = 'COS_ARGUMENTS';
  try {
    const options = parseCosArguments(values);
    if (options.action === 'prepare') {
      phase = 'COS_PREPARE';
      const result = await prepareCosMirror(options);
      console.log(
        `公开更新包已准备：${result.releases} 个版本、${result.packages} 个文件。尚未上传 COS。`,
      );
      console.log(`准备目录：${result.directory}`);
    } else {
      phase = 'COS_PUBLISH';
      // Keep credentials outside download/preparation, build scripts and app
      // packaging. The SDK is loaded only by this final publishing operation.
      const { loadCosConfig, createCosStore, publishCosMirror } =
        await import('./lib/cos-publisher');
      const config = loadCosConfig(process.env);
      const store = await createCosStore(config, process.env);
      if (process.env.COS_UPLOAD_ACCELERATE === 'true')
        console.log('上传使用腾讯云全球加速；存储桶查询和公开下载继续使用普通线路。');
      await publishCosMirror({
        directory: options.directory,
        config,
        store,
        verifyPublic: createPublicVerifier(),
        onProgress: createCosProgressLogger(),
        concurrency: 3,
      });
      console.log('COS 更新镜像已发布，公开下载校验通过。');
    }
  } catch (error) {
    // SDK and HTTP errors can contain signed URLs, authorization headers, or
    // SecretId. Never log the error object, message, stack, URL, or environment.
    console.error(
      phase === 'COS_ARGUMENTS'
        ? `COS 操作参数无效（COS_ARGUMENTS）。用法：${PREPARE_USAGE}；${PUBLISH_USAGE}。`
        : phase === 'COS_PREPARE'
          ? '公开更新包准备失败（COS_PREPARE）。请检查公开发行标签、GitHub 网络与全新输出目录。'
          : 'COS 发布或公开下载校验失败（COS_PUBLISH）。请检查专用权限、存储桶、HTTPS 域名与网络；敏感错误详情未输出。',
    );
    const diagnostic = formatCosDiagnostic(error);
    if (diagnostic) console.error(`诊断代码：${diagnostic}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await runCosCli();
