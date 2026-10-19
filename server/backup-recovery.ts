import { DataProtectionError } from './maintenance';
import path from 'node:path';
import { mkdir, readFile, copyFile, chmod, lstat } from 'node:fs/promises';
import { list, extract } from 'tar';
import { verifyFullBackup, fileDigest } from './full-backup';
import { SqliteStore } from './sqlite-store';
import { restoreMysqlFresh, verifyMysqlRecovery } from './mysql-backup';
import { validateWorkspace } from './validation';
import { savedInstallationSchema } from './installation';
import type { DatabaseBackupInfo } from './store';

/** Extraction is only into a fresh private staging directory; existing targets are refused. */
export async function extractBackup(
  filename: string,
  target: string,
  required = 'manifest.json',
  maxBytes = 10 * 1024 ** 3,
) {
  if (!(await lstat(filename)).isFile()) throw new DataProtectionError('请选择普通备份文件。');
  const hash = await fileDigest(filename);
  const seen = new Set<string>();
  let bytes = 0;
  let invalid = false;
  const valid = (name: string, type: string, size: number) => {
    const clean = type === 'Directory' ? name.replace(/\/$/, '') : name;
    const key = clean.toLocaleLowerCase();
    const safe =
      clean.length <= 600 &&
      !clean.includes('\\') &&
      !clean.includes(':') &&
      !clean.startsWith('/') &&
      clean
        .split('/')
        .every(
          (part) =>
            part &&
            part !== '.' &&
            part !== '..' &&
            !/[. ]$/.test(part) &&
            !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
        ) &&
      ['File', 'Directory'].includes(type);
    if (!safe || seen.has(key) || !Number.isSafeInteger(size) || size < 0) invalid = true;
    seen.add(key);
    bytes += size;
    if (bytes > maxBytes || seen.size > 100000) invalid = true;
    return safe;
  };
  await list({
    file: filename,
    strict: true,
    maxMetaEntrySize: 16384,
    maxDecompressionRatio: 1000,
    onReadEntry: (entry) => {
      valid(entry.path, entry.type, entry.size);
    },
  });
  if (invalid || !seen.has(required.toLowerCase()))
    throw new DataProtectionError('压缩包包含非法路径、链接、重复文件或超过安全容量。');
  await mkdir(target, { mode: 0o700 });
  await extract({
    file: filename,
    cwd: target,
    strict: true,
    preservePaths: false,
    maxMetaEntrySize: 16384,
    maxDecompressionRatio: 1000,
    noChmod: true,
    filter: (name, entry) =>
      seen.has(name.replace(/\/$/, '').toLocaleLowerCase()) &&
      'type' in entry &&
      ['File', 'Directory'].includes(entry.type),
  });
  if ((await fileDigest(filename)) !== hash)
    throw new DataProtectionError('恢复过程中备份文件发生变化，已停止。');
}

async function readDatabase(directory: string, info: DatabaseBackupInfo, mysqlUrl?: string) {
  if (info.storage === 'sqlite') return SqliteStore.readBackup(path.join(directory, info.file));
  if (info.storage === 'mysql') {
    if (!mysqlUrl) throw new DataProtectionError('恢复MySQL需要私有连接配置。');
    return verifyMysqlRecovery(path.join(directory, info.file), mysqlUrl);
  }
  const saved = JSON.parse(await readFile(path.join(directory, info.file), 'utf8'));
  return { data: validateWorkspace(saved.data), revision: saved.revision, mode: 'demo' as const };
}

/** Original data is never replaced. Activation is a separate explicit operation. */
export async function recoverBackup(
  directory: string,
  newDataDirectory: string,
  newMysqlName?: string,
) {
  const saved = savedInstallationSchema.parse(
    JSON.parse(await readFile(path.join(directory, 'data/installation.json'), 'utf8')),
  );
  const manifest = await verifyFullBackup(directory, (root, info) =>
    readDatabase(root, info, saved.databaseUrl),
  );
  if (manifest.storage === 'demo')
    throw new DataProtectionError('演示备份只能用于测试，不作为正式安装恢复。');
  if (manifest.storage === 'mysql' && (!saved.databaseUrl || !newMysqlName))
    throw new DataProtectionError('请指定全新的MySQL恢复库名。');
  const source = path.resolve(directory);
  const target = path.resolve(newDataDirectory);
  if (
    target === source ||
    target.startsWith(source + path.sep) ||
    source.startsWith(target + path.sep)
  )
    throw new DataProtectionError('恢复目标必须独立于备份目录。');
  await mkdir(target, { mode: 0o700 }); // No recursive/force: an existing destination is always refused.
  for (const entry of manifest.entries.filter((item) => item.path.startsWith('data/'))) {
    const relative = entry.path.slice(5);
    if (relative === 'installation.json') continue;
    const destination = path.join(target, relative);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(path.join(source, entry.path), destination);
    await chmod(destination, 0o600);
  }
  if (manifest.storage === 'sqlite') {
    await copyFile(
      path.join(source, manifest.database.file),
      path.join(target, 'worldloom.sqlite'),
    );
    await chmod(path.join(target, 'worldloom.sqlite'), 0o600);
  } else {
    const restored = await restoreMysqlFresh(
      path.join(source, manifest.database.file),
      saved.databaseUrl!,
      newMysqlName!,
    );
    saved.databaseUrl = restored.databaseUrl;
  }
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(target, 'installation.json'), JSON.stringify(saved, null, 2), {
    flag: 'wx',
    mode: 0o600,
  });
  if (manifest.entries.some((entry) => entry.path === 'private/environment.env')) {
    await copyFile(
      path.join(source, 'private/environment.env'),
      path.join(target, 'environment.env'),
    );
    await chmod(path.join(target, 'environment.env'), 0o600);
  }
  return { target, storage: manifest.storage, revision: manifest.revision, verified: true };
}
