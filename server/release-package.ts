import { DataProtectionError } from './maintenance';
import path from 'node:path';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { verify as verifySignature } from 'node:crypto';
import { z } from 'zod';
import { fileDigest, digest } from './full-backup';
import { releasePublicKeys } from '../shared/release-trust';
const version = z.string().regex(/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/);
export const releaseManifestSchema = z
  .object({
    format: z.literal('worldloom-release'),
    formatVersion: z.literal(1),
    version,
    minimumVersion: version,
    platform: z.enum(['win32', 'linux', 'darwin']),
    architecture: z.enum(['x64', 'arm64']),
    mysqlSchema: z.literal(5),
    sqliteSchema: z.literal(1),
    workspaceFormat: z.literal(1),
    installationFormat: z.literal(1),
    userFormat: z.literal(1),
    keyId: z.string().regex(/^[a-f0-9]{16}$/),
    entries: z
      .array(
        z
          .object({
            path: z.string().min(1).max(600),
            bytes: z.number().int().nonnegative().safe(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(100000),
  })
  .strict();
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;
export function compareVersions(left: string, right: string) {
  const values = (text: string) => {
    version.parse(text);
    const [base, pre] = text.split('-');
    const [stage, serial] = (pre || '').split('.');
    return [
      ...base.split('.').map(Number),
      stage ? ['alpha', 'beta', 'rc'].indexOf(stage) : 3,
      Number(serial || 0),
    ];
  };
  const a = values(left),
    b = values(right);
  for (let index = 0; index < a.length; index++)
    if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  return 0;
}
export async function releaseFiles(root: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()))
      throw new DataProtectionError('发行包不能包含链接或特殊文件。');
    if (entry.isDirectory()) result.push(...(await releaseFiles(root, relative)));
    else result.push(relative);
  }
  return result.sort();
}
export async function verifyRelease(
  root: string,
  currentVersion: string,
  keys = releasePublicKeys,
  platform: string = process.platform,
  architecture: string = process.arch,
  preparedDependencies = false,
) {
  const signed = z
    .object({
      manifest: releaseManifestSchema,
      signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .strict()
    .parse(JSON.parse(await readFile(path.join(root, 'RELEASE-MANIFEST.json'), 'utf8')));
  const m = signed.manifest;
  const key = keys[m.keyId];
  if (
    !key ||
    !verifySignature(null, Buffer.from(digest(m)), key, Buffer.from(signed.signature, 'base64'))
  )
    throw new DataProtectionError('更新包的发布签名无效。');
  if (m.platform !== platform || m.architecture !== architecture)
    throw new DataProtectionError('更新包与当前系统或处理器不匹配。');
  if (
    compareVersions(currentVersion, m.minimumVersion) < 0 ||
    compareVersions(m.version, currentVersion) <= 0
  )
    throw new DataProtectionError('版本不满足升级条件，请使用兼容的更新包。');
  const actual = (await releaseFiles(root)).filter(
    (file) =>
      file !== 'RELEASE-MANIFEST.json' &&
      !(preparedDependencies && file.startsWith('node_modules/')),
  );
  if (
    new Set(m.entries.map((entry) => entry.path.toLowerCase())).size !== m.entries.length ||
    digest(actual) !== digest(m.entries.map((entry) => entry.path).sort())
  )
    throw new DataProtectionError('更新包文件清单不一致。');
  for (const entry of m.entries) {
    if (
      entry.path.includes('\\') ||
      entry.path.includes(':') ||
      entry.path.startsWith('/') ||
      entry.path.split('/').some((part) => !part || part === '.' || part === '..') ||
      /^(data|\.runtime|\.worldloom)(\/|$)/i.test(entry.path) ||
      /(^|\/)(\.env|mysql\.txt|users\.json|installation\.json|\.npmrc|runner\.key)(\/|$)/i.test(
        entry.path,
      )
    )
      throw new DataProtectionError('更新包包含禁止分发的私有文件或目录。');
    const filename = path.join(root, entry.path);
    if (
      (await lstat(filename)).size !== entry.bytes ||
      (await fileDigest(filename)) !== entry.sha256
    )
      throw new DataProtectionError('更新包文件已损坏。');
  }
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const build = JSON.parse(await readFile(path.join(root, 'dist/app-version.json'), 'utf8'));
  const sourceVersion = /APPLICATION_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(
    await readFile(path.join(root, 'shared/application.ts'), 'utf8'),
  )?.[1];
  if (
    pkg.version !== m.version ||
    build.applicationVersion !== m.version ||
    sourceVersion !== m.version ||
    !actual.includes('dist/index.html') ||
    !actual.includes('server/index.ts') ||
    !actual.includes('scripts/launch.mjs')
  )
    throw new DataProtectionError('更新包缺少完整程序或版本不一致。');
  return m;
}
