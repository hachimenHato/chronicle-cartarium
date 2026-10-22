import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';

const REPOSITORY = 'https://github.com/hachimenHato/chronicle-cartarium';
const VERSION = /^\d{1,9}\.\d{1,9}\.\d{1,9}(?:-(?:alpha|beta|rc)\.\d{1,9})?$/;
const MAX_PACKAGE = 128 * 1024 ** 2;
const MAX_CATALOG = 1024 ** 2;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

async function sha256(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function publicRelease(value) {
  requireValue(
    value && typeof value === 'object' && !Array.isArray(value),
    '发行清单包含无效项目。',
  );
  if (value.draft === true) return undefined;
  const version = typeof value.tag_name === 'string' ? value.tag_name.replace(/^v/, '') : '';
  requireValue(VERSION.test(version) && value.tag_name === `v${version}`, '发行标签格式无效。');
  requireValue(
    value.draft === false && typeof value.prerelease === 'boolean',
    '发行状态格式无效。',
  );
  requireValue(value.prerelease === version.includes('-'), '发行标签与预发行状态不一致。');
  requireValue(
    value.html_url === `${REPOSITORY}/releases/tag/v${version}`,
    '发行页面必须属于官方仓库。',
  );
  requireValue(typeof value.name === 'string' && value.name.length <= 200, '发行名称格式无效。');
  requireValue(typeof value.body === 'string' && value.body.length <= 100000, '发行说明格式无效。');
  requireValue(
    typeof value.published_at === 'string' &&
      value.published_at.length <= 40 &&
      Number.isFinite(Date.parse(value.published_at)),
    '发行时间格式无效。',
  );
  requireValue(Array.isArray(value.assets) && value.assets.length <= 100, '发行附件清单格式无效。');
  const names = new Set();
  const assets = [];
  for (const asset of value.assets) {
    requireValue(asset && typeof asset === 'object' && !Array.isArray(asset), '发行附件格式无效。');
    if (typeof asset.name !== 'string' || !asset.name.endsWith('.ccupdate')) continue;
    const prefix = `chronicle-cartarium-${version}-`;
    requireValue(
      asset.name.startsWith(prefix) &&
        /^(?:win|linux|darwin)-(?:x64|arm64)\.ccupdate$/.test(asset.name.slice(prefix.length)),
      '更新包名称不符合系统与架构规范。',
    );
    requireValue(!names.has(asset.name.toLowerCase()), '同一发行包含重复更新包。');
    names.add(asset.name.toLowerCase());
    requireValue(asset.state === 'uploaded', '更新包尚未上传完成。');
    requireValue(
      Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= MAX_PACKAGE,
      '更新包大小无效或超过128MiB。',
    );
    requireValue(
      typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(asset.digest),
      '更新包缺少有效SHA-256摘要。',
    );
    requireValue(
      asset.browser_download_url === `${REPOSITORY}/releases/download/v${version}/${asset.name}`,
      '更新包下载地址必须属于官方仓库。',
    );
    assets.push({
      name: asset.name,
      size: asset.size,
      digest: asset.digest,
      browser_download_url: asset.browser_download_url,
      state: 'uploaded',
    });
  }
  return {
    version,
    release: {
      tag_name: `v${version}`,
      name: value.name,
      body: value.body,
      html_url: value.html_url,
      draft: false,
      prerelease: value.prerelease,
      published_at: value.published_at,
      assets,
    },
  };
}

/** Build only from a saved public catalog and original signed packages; never publish or sign. */
export async function createUpdateMirror({ catalog, packages, output }) {
  const catalogPath = path.resolve(catalog);
  const catalogInfo = await lstat(catalogPath);
  requireValue(
    catalogInfo.isFile() && !catalogInfo.isSymbolicLink() && catalogInfo.size <= MAX_CATALOG,
    '发行清单必须是1MiB以内的普通JSON文件。',
  );
  const values = JSON.parse(await readFile(catalogPath, 'utf8'));
  requireValue(
    Array.isArray(values) && values.length <= 100,
    '发行清单必须是最多100项的GitHub Releases数组。',
  );
  const releases = values.map(publicRelease).filter(Boolean);
  const versions = new Set();
  for (const { version } of releases) {
    requireValue(!versions.has(version), '发行清单包含重复版本。');
    versions.add(version);
  }
  const packageInfo = await lstat(path.resolve(packages));
  requireValue(
    packageInfo.isDirectory() && !packageInfo.isSymbolicLink(),
    '更新包目录必须是真实目录。',
  );
  const packageRoot = await realpath(path.resolve(packages));
  const requestedOutput = path.resolve(output);
  // Resolve the existing parent too: Windows short paths and symlinked parents must
  // not make a nested output appear to be outside the input directory.
  const destination = path.join(
    await realpath(path.dirname(requestedOutput)),
    path.basename(requestedOutput),
  );
  const relative = path.relative(packageRoot, destination);
  requireValue(
    relative !== '' && (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)),
    '输出目录不能位于更新包源目录内。',
  );
  const files = [];
  for (const { version, release } of releases) {
    for (const asset of release.assets) {
      const source = path.join(packageRoot, asset.name);
      const info = await lstat(source);
      requireValue(
        info.isFile() && !info.isSymbolicLink() && info.size === asset.size,
        '本地更新包不是普通文件或大小不符。',
      );
      requireValue((await sha256(source)) === asset.digest.slice(7), '本地更新包SHA-256不符。');
      files.push({ source, version, asset });
    }
  }
  requireValue(files.length > 0, '清单中没有可镜像的受签名更新包。');
  const sanitized =
    JSON.stringify(
      releases.map(({ release }) => release),
      null,
      2,
    ) + '\n';
  requireValue(Buffer.byteLength(sanitized) <= MAX_CATALOG, '净化后的发行清单超过1MiB。');
  // Non-recursive mkdir refuses an existing output, including symlinks; failures retain evidence.
  await mkdir(destination, { mode: 0o755 });
  for (const { source, version, asset } of files) {
    const directory = path.join(destination, `v${version}`);
    await mkdir(directory, { recursive: true, mode: 0o755 });
    const target = path.join(directory, asset.name);
    await copyFile(source, target, constants.COPYFILE_EXCL);
    const copied = await lstat(target);
    requireValue(
      copied.isFile() &&
        copied.size === asset.size &&
        (await sha256(target)) === asset.digest.slice(7),
      '复制后更新包检查失败，请勿发布此输出目录。',
    );
  }
  await writeFile(path.join(destination, 'releases.json'), sanitized, { flag: 'wx', mode: 0o644 });
  return { releases: releases.length, packages: files.length };
}

function argumentsFrom(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, '');
    requireValue(
      ['catalog', 'packages', 'output'].includes(key) &&
        values[index].startsWith('--') &&
        values[index + 1] &&
        !Object.hasOwn(result, key),
      '请提供 --catalog 发行清单.json --packages 更新包目录 --output 全新输出目录。',
    );
    result[key] = values[index + 1];
  }
  requireValue(
    ['catalog', 'packages', 'output'].every((key) => result[key]),
    '请提供 --catalog、--packages 和 --output。',
  );
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await createUpdateMirror(argumentsFrom(process.argv.slice(2)));
    console.log(
      `已生成镜像：${result.releases}个版本，${result.packages}个更新包。尚未上传或发布。`,
    );
  } catch (error) {
    console.error(`镜像生成失败：${error instanceof Error ? error.message : '无效输入。'}`);
    process.exitCode = 1;
  }
}
