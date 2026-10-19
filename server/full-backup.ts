import { DataProtectionError } from './maintenance';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  copyFile,
  chmod,
  rename,
  lstat,
  statfs,
  access,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { create as createTar } from 'tar';
import { z } from 'zod';
import { APPLICATION_VERSION } from '../shared/application';
import { PRIVATE_BACKUP_EXTENSION } from '../shared/branding';
import type { FullBackupSummary, BackupProgress, BackupStatus } from '../shared/backup';
import type { WorkspaceEnvelope } from '../shared/model';
import { InstallationManager, savedInstallationSchema } from './installation';
import { savedUserDirectorySchema, type UserDirectoryStore } from './users';
import { validateWorkspace } from './validation';
import { workspaceImages } from './permissions';
import type { DatabaseBackupInfo } from './store';

const safePath = z
  .string()
  .min(1)
  .max(600)
  .refine(
    (value) =>
      !value.includes('\\') &&
      !value.includes(':') &&
      !value.startsWith('/') &&
      value.split('/').every((part) => part && part !== '.' && part !== '..'),
  );
const manifestSchema = z
  .object({
    format: z.literal('worldloom-full-backup'),
    version: z.literal(1),
    id: z.string().regex(/^full-[0-9]+-[a-f0-9-]{36}$/),
    createdAt: z.string().datetime(),
    applicationVersion: z.string(),
    storage: z.enum(['sqlite', 'mysql', 'demo']),
    revision: z.number().int().nonnegative().safe(),
    verified: z.literal(true),
    database: z
      .object({
        storage: z.enum(['sqlite', 'mysql', 'demo']),
        file: safePath,
        schemaVersion: z.number().int(),
      })
      .strict(),
    workspaceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    entries: z
      .array(
        z
          .object({
            path: safePath,
            bytes: z.number().int().nonnegative().safe(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(100000),
  })
  .strict();
export type FullBackupManifest = z.infer<typeof manifestSchema>;
export function digest(value: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, item]) => item !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export async function fileDigest(filename: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
async function regularFiles(root: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    safePath.parse(relative);
    if (entry.isSymbolicLink())
      throw new DataProtectionError('数据包含符号链接，无法安全自动备份。');
    if (entry.isDirectory()) files.push(...(await regularFiles(root, relative)));
    else if (entry.isFile()) files.push(relative);
    else throw new DataProtectionError('数据目录包含不支持的文件类型。');
    if (files.length > 100000) throw new DataProtectionError('备份文件数量超过安全限制。');
  }
  return files.sort();
}
export async function verifyFullBackup(
  directory: string,
  readDatabase: (directory: string, info: DatabaseBackupInfo) => Promise<WorkspaceEnvelope>,
) {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')),
  );
  const paths = manifest.entries.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length || manifest.storage !== manifest.database.storage)
    throw new DataProtectionError('备份清单重复或存储类型不一致。');
  const actual = (await regularFiles(directory)).filter((name) => name !== 'manifest.json');
  if (digest(actual) !== digest([...paths].sort()))
    throw new DataProtectionError('备份文件清单不完整。');
  for (const entry of manifest.entries) {
    const filename = path.join(directory, entry.path);
    const info = await lstat(filename);
    if (
      !info.isFile() ||
      info.size !== entry.bytes ||
      (await fileDigest(filename)) !== entry.sha256
    )
      throw new DataProtectionError('备份校验失败，文件缺失或已损坏。');
  }
  for (const required of [
    manifest.database.file,
    'workspace.json',
    'data/installation.json',
    'data/users.json',
  ])
    if (!paths.includes(required)) throw new DataProtectionError('备份缺少数据库或私有账号配置。');
  const saved = JSON.parse(await readFile(path.join(directory, 'workspace.json'), 'utf8'));
  const workspace = validateWorkspace(saved.data);
  if (saved.revision !== manifest.revision || digest(workspace) !== manifest.workspaceDigest)
    throw new DataProtectionError('备份工作区摘要不一致。');
  const installation = savedInstallationSchema.parse(
    JSON.parse(await readFile(path.join(directory, 'data/installation.json'), 'utf8')),
  );
  savedUserDirectorySchema.parse(
    JSON.parse(await readFile(path.join(directory, 'data/users.json'), 'utf8')),
  );
  if (manifest.storage !== 'demo' && installation.storage !== manifest.storage)
    throw new DataProtectionError('备份安装与数据库类型不一致。');
  for (const url of workspaceImages(workspace)) {
    if (url.startsWith('/uploads/') && !paths.includes('data' + url))
      throw new DataProtectionError('备份缺少工作区引用的图片。');
  }
  const restored = await readDatabase(directory, manifest.database);
  if (restored.revision !== manifest.revision || digest(restored.data) !== manifest.workspaceDigest)
    throw new DataProtectionError('数据库恢复验证未得到相同工作区。');
  return manifest;
}
function summary(manifest: FullBackupManifest): FullBackupSummary {
  return {
    id: manifest.id,
    createdAt: manifest.createdAt,
    applicationVersion: manifest.applicationVersion,
    storage: manifest.storage,
    revision: manifest.revision,
    verified: manifest.verified,
    files: manifest.entries.length,
    bytes: manifest.entries.reduce((total, entry) => total + entry.bytes, 0),
  };
}

/** Private local backups: no account hashes or paths are returned in API summaries. */
export class FullBackupService {
  private progress: BackupProgress = {
    phase: 'idle',
    message: '完整备份会包含创作、图片、账号和权限。',
  };
  private running = false;
  constructor(
    private manager: InstallationManager,
    private users: UserDirectoryStore,
  ) {}
  private get root() {
    return path.join(this.manager.config.dataDir, 'backups');
  }
  async status(): Promise<BackupStatus> {
    const backups: FullBackupSummary[] = [];
    for (const item of await readdir(this.root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    })) {
      if (!/^full-[0-9]+-[a-f0-9-]{36}$/.test(item)) continue;
      try {
        backups.push(
          summary(
            manifestSchema.parse(
              JSON.parse(await readFile(path.join(this.root, item, 'manifest.json'), 'utf8')),
            ),
          ),
        );
      } catch {
        /* Incomplete or damaged backups must never be labelled verified. */
      }
    }
    return {
      busy: this.running,
      progress: this.progress,
      backups: backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }
  async create(revision: number, alreadyLocked = false): Promise<FullBackupSummary> {
    if (this.running) throw new DataProtectionError('已有完整备份任务正在进行。');
    this.running = true;
    this.progress = { phase: 'waiting', message: '正在等待已开始的保存完成…' };
    try {
      const operation = async () => {
        const before = await this.manager.read();
        if (before.revision !== revision) {
          const { ConflictError } = await import('./store');
          throw new ConflictError();
        }
        if (this.manager.setupRequired) throw new DataProtectionError('完成安装后才能完整备份。');
        await mkdir(this.root, { recursive: true, mode: 0o700 });
        const id = `full-${Date.now()}-${randomUUID()}`;
        const temporary = path.join(this.root, '.' + id + '.pending');
        await mkdir(temporary, { mode: 0o700 });
        const source = this.manager.config.dataDir;
        const sourceFiles: string[] = [];
        for (const entry of await readdir(source, { withFileTypes: true })) {
          if (
            [
              'backups',
              'updates',
              '.worldloom',
              'worldloom.sqlite',
              'worldloom.sqlite-wal',
              'worldloom.sqlite-shm',
              'installation.json',
              'users.json',
            ].includes(entry.name) ||
            entry.name.startsWith('server.lock') ||
            entry.name.endsWith('.lock') ||
            entry.name.endsWith('.tmp')
          )
            continue;
          if (entry.isSymbolicLink())
            throw new DataProtectionError('数据目录包含链接，备份已停止。');
          if (entry.isDirectory())
            sourceFiles.push(
              ...(await regularFiles(path.join(source, entry.name))).map(
                (file) => entry.name + '/' + file,
              ),
            );
          else if (entry.isFile()) sourceFiles.push(entry.name);
          else throw new DataProtectionError('数据目录包含不支持的文件。');
        }
        const bytes = (
          await Promise.all(sourceFiles.map((file) => lstat(path.join(source, file))))
        ).reduce((sum, file) => sum + file.size, 0);
        const databaseBytes =
          before.mode === 'sqlite'
            ? (await lstat(path.join(source, 'worldloom.sqlite'))).size +
              (await lstat(path.join(source, 'worldloom.sqlite-wal')).catch(() => ({ size: 0 })))
                .size
            : Buffer.byteLength(JSON.stringify(before)) * 4;
        const space = await statfs(source);
        if (space.bavail * space.bsize < (bytes + databaseBytes) * 2 + 64 * 1024 * 1024)
          throw new DataProtectionError('空间不足，完整备份已停止，请释放空间后重试。');
        this.progress = { phase: 'database', message: '正在生成数据库一致性快照…' };
        const database = await this.manager.backupDatabase(temporary);
        await writeFile(path.join(temporary, 'workspace.json'), JSON.stringify(before), {
          flag: 'wx',
          mode: 0o600,
        });
        this.progress = { phase: 'files', message: '正在备份图片、账号和权限…' };
        await mkdir(path.join(temporary, 'data'), { mode: 0o700 });
        await this.manager.backupPrivate(path.join(temporary, 'data/installation.json'));
        await this.users.backupPrivate(path.join(temporary, 'data/users.json'));
        for (const file of sourceFiles) {
          safePath.parse(file);
          const destination = path.join(temporary, 'data', file);
          await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
          await copyFile(path.join(source, file), destination);
          await chmod(destination, 0o600);
        }
        const envFile = this.manager.config.envFile;
        if (
          envFile &&
          (await access(envFile).then(
            () => true,
            () => false,
          ))
        ) {
          await mkdir(path.join(temporary, 'private'), { mode: 0o700 });
          await copyFile(envFile, path.join(temporary, 'private/environment.env'));
          await chmod(path.join(temporary, 'private/environment.env'), 0o600);
        }
        const entries = [];
        for (const file of await regularFiles(temporary))
          entries.push({
            path: file,
            bytes: (await lstat(path.join(temporary, file))).size,
            sha256: await fileDigest(path.join(temporary, file)),
          });
        const manifest = manifestSchema.parse({
          format: 'worldloom-full-backup',
          version: 1,
          id,
          createdAt: new Date().toISOString(),
          applicationVersion: APPLICATION_VERSION,
          storage: before.mode,
          revision: before.revision,
          database,
          verified: true,
          workspaceDigest: digest(before.data),
          entries,
        });
        await writeFile(path.join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2), {
          flag: 'wx',
          mode: 0o600,
        });
        this.progress = { phase: 'verifying', message: '正在恢复到独立副本并核对全部内容…' };
        await verifyFullBackup(temporary, (directory, info) =>
          this.manager.verifyDatabaseBackup(directory, info),
        );
        const destination = path.join(this.root, id);
        await rename(temporary, destination);
        this.progress = { phase: 'complete', message: '完整备份和恢复验证成功。' };
        return summary(manifest);
      };
      if (alreadyLocked) {
        if (!this.manager.maintenance.busy) throw new DataProtectionError('更新备份缺少维护锁。');
        return await operation();
      }
      return await this.manager.maintenance.exclusive(operation);
    } catch (error) {
      this.progress = {
        phase: 'error',
        message: '备份未完成，原内容保留。请检查磁盘空间、文件权限和数据库权限后重试。',
      };
      throw error;
    } finally {
      this.running = false;
    }
  }
  async archive(id: string) {
    if (!/^full-[0-9]+-[a-f0-9-]{36}$/.test(id)) throw new DataProtectionError('备份编号无效。');
    const directory = path.join(this.root, id);
    await verifyFullBackup(directory, (target, info) =>
      this.manager.verifyDatabaseBackup(target, info),
    );
    const downloadDirectory = path.join(this.root, 'downloads');
    await mkdir(downloadDirectory, { recursive: true, mode: 0o700 });
    const filename = path.join(
      downloadDirectory,
      id + '-' + randomUUID() + PRIVATE_BACKUP_EXTENSION,
    );
    const files = await regularFiles(directory);
    await createTar(
      {
        gzip: true,
        file: filename,
        cwd: directory,
        portable: true,
        strict: true,
        noMtime: true,
        mode: 0o600,
      },
      files,
    );
    await chmod(filename, 0o600);
    return filename;
  }
}
