// Maintainer packaging guard. Inspects names and file types only, never file contents.
import path from 'node:path';
import { lstat, readdir } from 'node:fs/promises';

const excludedDirectories = new Set([
  'node_modules',
  '.git',
  '.runtime',
  '.worldloom',
  '.desktop',
  'workspace',
  'data',
  'uploads',
  'backups',
  'test-results',
  'playwright-report',
  'coverage',
  '.aws',
  '.tccli',
  '.coscli',
]);

const privateNames = new Set([
  '.env',
  '.npmrc',
  'mysql.txt',
  'installation.json',
  'users.json',
  'runner.key',
  '.cos.yaml',
  '.cos.yml',
  '.cos.json',
  '.cos.conf',
  '.cosconfig',
  '.cosrc',
  '.cosrc.json',
  'cos.yaml',
  'cos.yml',
  'cos.conf',
  'cosconfig.json',
  'cosfs_passwd',
  '.cosfs_passwd',
  'credentials',
  '.credentials',
  'credentials.json',
  'credentials.yaml',
  'credentials.yml',
  'secrets.json',
  'secrets.yaml',
  'secrets.yml',
]);

function partsOf(relative) {
  if (typeof relative !== 'string' || relative.includes('\0')) return undefined;
  const normalized = relative.replaceAll('\\', '/');
  if (!normalized) return [];
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes(':')))
    return undefined;
  return parts.map((part) => part.toLowerCase());
}

/** Credential/configuration names are forbidden at every depth; .env.example stays public. */
export function isPrivateReleasePath(relative) {
  const parts = partsOf(relative);
  if (!parts) return true;
  return parts.some(
    (name) =>
      privateNames.has(name) ||
      (name.startsWith('.env.') && name !== '.env.example') ||
      /\.(?:pem|key|pfx|p12|sqlite(?:-.*)?|db|ccbackup|wlbackup|log)$/.test(name) ||
      /^\.?(?:cos|tencent(?:[._-]cos)?)[._-](?:config|credentials?|secrets?)(?:[._-].*)?$/.test(
        name,
      ),
  );
}

/** Local state/dependencies and the root maintainer tools are never part of an app payload. */
export function isExcludedReleaseDirectory(relative) {
  const parts = partsOf(relative);
  return !parts || parts[0] === 'tools' || parts.some((part) => excludedDirectories.has(part));
}

export function shouldIncludeReleasePath(relative) {
  return !isPrivateReleasePath(relative) && !isExcludedReleaseDirectory(relative);
}

/** Filter for fs.cp, rooted at the same public source tree used by the assertion. */
export function createReleaseCopyFilter(root) {
  const base = path.resolve(root);
  return (filename) => shouldIncludeReleasePath(path.relative(base, path.resolve(filename)));
}

/**
 * Refuse private files/links in public source trees, while skipping local-only directories.
 * `entries` limits inspection to a packager's existing allow-list: the private project root
 * can contain .env/data without this function opening or traversing either of them.
 */
export async function assertPublicReleaseTree(root, { entries = [''] } = {}) {
  const base = path.resolve(root);
  const baseInfo = await lstat(base);
  if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink())
    throw new Error('发布源必须是普通目录，不能是链接。');
  let files = 0;
  let excluded = 0;
  async function inspect(relative) {
    if (!partsOf(relative)) throw new Error('发布白名单包含无效路径。');
    if (isExcludedReleaseDirectory(relative)) {
      excluded += 1;
      return;
    }
    if (isPrivateReleasePath(relative))
      throw new Error(`发布源包含禁止公开的私有文件：${relative}`);
    const info = await lstat(path.join(base, relative));
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
      throw new Error(`发布源不能包含链接或特殊文件：${relative || '.'}`);
    if (info.isFile()) {
      files += 1;
      return;
    }
    for (const name of await readdir(path.join(base, relative)))
      await inspect(relative ? `${relative}/${name}` : name);
  }
  for (const relative of entries) await inspect(relative);
  return { files, excluded };
}
