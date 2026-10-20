import path from 'node:path';
import { mkdir, readFile, writeFile, rename, cp, readdir, unlink, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { hash, compare } from 'bcryptjs';
import { z } from 'zod';
import type { AppConfig } from './config';
import { ConflictError, MysqlStore, type WorkspaceStore } from './store';
import { SqliteStore } from './sqlite-store';
import { createEmptyWorkspace } from '../shared/empty';
import { createExampleWorkspace } from '../shared/example';
import {
  RESET_CONFIRMATION,
  type ApplicationSettings,
  type ResetResult,
} from '../shared/application';
import type { Workspace, WorkspaceEnvelope } from '../shared/model';
import { mergeAuthorizedWorkspace } from './permissions';
import type { UserAccount } from '../shared/access';
import { MaintenanceGate } from './maintenance';
import { savedUserDirectorySchema } from './users';
import {
  BRAND_TITLE,
  CREATIVE_BACKUP_FORMAT,
  validProjectDatabaseName,
  displayApplicationTitle,
} from '../shared/branding';

export const settingsSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    theme: z.enum(['parchment', 'jade', 'midnight']),
    access: z.enum(['local', 'server']),
  })
  .strict();
const accountSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[\p{L}\p{N}_.-]+$/u),
  password: z
    .string()
    .min(10)
    .max(72)
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= 72,
      '密码的 UTF-8 长度不能超过 72 字节。',
    ),
});
export const installationSchema = settingsSchema
  .extend({
    storage: z.enum(['sqlite', 'mysql']),
    loginEnabled: z.boolean().default(true),
    multiUser: z.boolean().default(false),
    username: accountSchema.shape.username.optional(),
    password: accountSchema.shape.password.optional(),
    fillExample: z.boolean(),
    mysql: z
      .object({
        host: z
          .string()
          .min(1)
          .max(255)
          .regex(/^[a-zA-Z0-9.:-]+$/),
        port: z.number().int().min(1).max(65535),
        username: z.string().min(1).max(100),
        password: z.string().max(256),
        database: z
          .string()
          .refine(
            validProjectDatabaseName,
            '请输入64字符内、以chronicle_cartarium_开头的全新项目库名。',
          ),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.loginEnabled && (!value.username || !value.password))
      ctx.addIssue({
        code: 'custom',
        path: ['username'],
        message: '开启登录需要设置用户名和密码。',
      });
    if (!value.loginEnabled && value.multiUser)
      ctx.addIssue({ code: 'custom', path: ['multiUser'], message: '多用户模式需要开启登录。' });
  });
export const loginSettingsSchema = z.discriminatedUnion('enabled', [
  accountSchema
    .extend({ enabled: z.literal(true), currentPassword: z.string().max(1024).optional() })
    .strict(),
  z
    .object({ enabled: z.literal(false), currentPassword: z.string().max(1024).optional() })
    .strict(),
]);
export const savedInstallationSchema = z
  .object({
    version: z.literal(1),
    storage: z.enum(['sqlite', 'mysql']),
    databaseUrl: z.string().optional(),
    loginEnabled: z.boolean().default(true),
    username: accountSchema.shape.username.optional(),
    passwordHash: z
      .string()
      .regex(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/)
      .optional(),
    sessionSecret: z.string().min(32),
    settings: settingsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.loginEnabled && (!value.username || !value.passwordHash))
      ctx.addIssue({ code: 'custom', path: ['username'], message: '登录配置缺少主管理员凭据。' });
  });
type Installation = z.infer<typeof savedInstallationSchema>;
async function openMysql(databaseUrl: string) {
  const store = new MysqlStore(databaseUrl, createEmptyWorkspace);
  try {
    return await store.initialize();
  } catch (error) {
    await store.close();
    throw error;
  }
}

/** Serializes configuration, reset and normal writes. The API never exposes stored secrets. */
export class InstallationManager implements WorkspaceStore {
  readonly maintenance = new MaintenanceGate();
  private installed?: Installation;
  private active?: WorkspaceStore;
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(
    readonly config: AppConfig,
    private localStore: (filename: string) => Promise<WorkspaceStore>,
  ) {}
  get mode() {
    return this.active?.mode || ('sqlite' as const);
  }
  get setupRequired() {
    return !this.installed;
  }
  get credentials() {
    return this.installed?.loginEnabled && this.installed.username && this.installed.passwordHash
      ? { username: this.installed.username, hash: this.installed.passwordHash }
      : undefined;
  }
  get loginEnabled() {
    return this.installed?.loginEnabled ?? true;
  }
  get settings(): ApplicationSettings {
    return this.installed
      ? {
          ...this.installed.settings,
          title: displayApplicationTitle(this.installed.settings.title),
        }
      : { title: BRAND_TITLE, theme: 'parchment', access: 'local' };
  }
  get configuredStorage() {
    return this.config.databaseUrl || this.active?.mode === 'mysql'
      ? ('mysql' as const)
      : undefined;
  }
  private get filename() {
    return path.join(this.config.dataDir, 'installation.json');
  }
  static async open(
    config: AppConfig,
    localStore: (filename: string) => Promise<WorkspaceStore> = (filename) =>
      new SqliteStore(filename).initialize(),
  ) {
    const manager = new InstallationManager(config, localStore);
    await mkdir(config.dataDir, { recursive: true });
    // Unknown private formats must fail before opening or migrating the creative database.
    try {
      savedUserDirectorySchema.parse(
        JSON.parse(await readFile(path.join(config.dataDir, 'users.json'), 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      manager.installed = savedInstallationSchema.parse(
        JSON.parse(await readFile(manager.filename, 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      for (const name of ['worldloom.sqlite', 'instance.json']) {
        const exists = await access(path.join(config.dataDir, name)).then(
          () => true,
          () => false,
        );
        if (exists) throw new Error('安装配置缺失但已有数据，请恢复配置，不能重新初始化。');
      }
    }
    if (manager.installed) {
      config.sessionSecret = manager.installed.sessionSecret;
      const url = manager.installed.databaseUrl || config.databaseUrl;
      if (manager.installed.storage === 'mysql') {
        if (!url) throw new Error('Installed MySQL connection is missing.');
        manager.active = await openMysql(url);
      } else
        manager.active = await manager.localStore(path.join(config.dataDir, 'worldloom.sqlite'));
    }
    return manager;
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    return this.maintenance.write(() => {
      const task = this.queue.then(operation);
      this.queue = task.catch(() => undefined);
      return task;
    });
  }
  private async persist(installation: Installation) {
    const temporary = `${this.filename}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(installation, null, 2), { flag: 'wx', mode: 0o600 });
    await rename(temporary, this.filename);
    this.installed = installation;
  }
  async install(
    value: unknown,
    initializeUsers?: (enabled: boolean) => Promise<() => Promise<void>>,
  ) {
    const input = installationSchema.parse(value);
    return this.serial(async () => {
      if (this.installed) throw new ConflictError();
      if (input.multiUser && !initializeUsers)
        throw new InstallationError('当前启动方式尚未准备多用户管理，请通过安装接口配置。');
      const passwordHash = input.loginEnabled ? await hash(input.password!, 12) : undefined;
      let next = this.active;
      let databaseUrl: string | undefined;
      if (input.storage === 'sqlite' && next?.mode !== 'sqlite')
        next = await this.localStore(path.join(this.config.dataDir, 'worldloom.sqlite'));
      if (input.storage === 'mysql' && next?.mode !== 'mysql') {
        if (this.config.databaseUrl) {
          databaseUrl = this.config.databaseUrl;
          next = await openMysql(databaseUrl);
        } else {
          if (!input.mysql)
            throw new z.ZodError([
              { code: 'custom', path: ['mysql'], message: '请填写 MySQL 连接信息。' },
            ]);
          const connection = await mysql.createConnection({
            host: input.mysql.host,
            port: input.mysql.port,
            user: input.mysql.username,
            password: input.mysql.password,
            charset: 'utf8mb4',
          });
          try {
            const [rows] = await connection.query<mysql.RowDataPacket[]>(
              'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',
              [input.mysql.database],
            );
            if (rows.length)
              throw new InstallationError(
                '数据库名称已存在，请换一个全新的 chronicle_cartarium_ 开头名称。现有库未被修改。',
              );
            // The validated identifier is deliberately created WITHOUT IF NOT EXISTS.
            await connection.query(
              `CREATE DATABASE \`${input.mysql.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
            );
          } finally {
            await connection.end();
          }
          const { username, password, host, port, database } = input.mysql;
          databaseUrl = `mysql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host.includes(':') ? `[${host}]` : host}:${port}/${database}`;
          next = await openMysql(databaseUrl);
        }
      }
      if (!next) throw new Error('No installation store selected.');
      const existing = this.active ? await this.active.read() : undefined;
      try {
        const target = await next.read();
        if (!target.data.worlds.length) {
          // Upgrading an existing install preserves content; a fresh install is truly empty unless requested.
          await next.save(
            existing?.data.worlds.length
              ? existing.data
              : input.fillExample
                ? createExampleWorkspace()
                : createEmptyWorkspace(),
            target.revision,
          );
        }
        const rollbackUsers = await initializeUsers?.(input.multiUser);
        try {
          await this.persist({
            version: 1,
            storage: input.storage,
            databaseUrl:
              databaseUrl || (input.storage === 'mysql' ? this.config.databaseUrl : undefined),
            loginEnabled: input.loginEnabled,
            username: input.loginEnabled ? input.username : undefined,
            passwordHash,
            sessionSecret: this.config.sessionSecret,
            settings: { title: input.title, theme: input.theme, access: input.access },
          });
        } catch (error) {
          await rollbackUsers?.();
          throw error;
        }
      } catch (error) {
        if (next !== this.active) await next.close();
        throw error;
      }
      if (this.active && this.active !== next) await this.active.close();
      this.active = next;
      return { installed: true, settings: this.settings };
    });
  }
  async read(): Promise<WorkspaceEnvelope> {
    await this.queue;
    return this.active
      ? this.active.read()
      : { data: createEmptyWorkspace(), revision: 0, mode: 'sqlite' };
  }
  save(data: Workspace, revision: number) {
    return this.serial(async () => {
      if (!this.active) throw new Error('Installation is required.');
      return this.active.save(data, revision);
    });
  }
  saveAuthorized(
    data: Workspace,
    revision: number,
    actor: () => UserAccount,
    check?: (before: Workspace, actor: UserAccount) => void,
  ) {
    return this.serial(async () => {
      if (!this.active) throw new Error('Installation is required.');
      const before = await this.active.read();
      if (before.revision !== revision) throw new ConflictError();
      const current = actor();
      check?.(before.data, current);
      return this.active.save(mergeAuthorizedWorkspace(before.data, data, current), revision);
    });
  }
  async updateSettings(value: unknown) {
    const settings = settingsSchema.parse(value);
    return this.serial(async () => {
      if (!this.installed) throw new Error('Installation is required.');
      await this.persist({ ...this.installed, settings });
      return settings;
    });
  }
  /** Shares the configuration queue with login changes so concurrent toggles cannot violate policy. */
  configureSecurity<T>(operation: () => Promise<T>) {
    return this.serial(operation);
  }
  async updateLogin(
    value: unknown,
    directory: () => { enabled: boolean; usernames: string[] },
    authorize: () => void = () => undefined,
  ) {
    const input = loginSettingsSchema.parse(value);
    return this.serial(async () => {
      authorize();
      if (!this.installed) throw new InstallationError('请先完成安装。');
      const users = directory();
      if (!input.enabled && users.enabled)
        throw new InstallationError('多用户模式开启时不能关闭登录，请先关闭多用户模式。');
      if (this.loginEnabled && !(await this.verifyOwnerPassword(input.currentPassword ?? '')))
        throw new InstallationError('请填写主管理员当前密码以修改登录设置。', 401);
      if (
        input.enabled &&
        users.usernames.some(
          (name) => name.toLocaleLowerCase() === input.username.toLocaleLowerCase(),
        )
      )
        throw new InstallationError('此登录名已被其他用户使用。');
      await this.persist({
        ...this.installed,
        loginEnabled: input.enabled,
        ...(input.enabled
          ? { username: input.username, passwordHash: await hash(input.password, 12) }
          : {}),
      });
      return { loginEnabled: this.loginEnabled, username: this.credentials?.username };
    });
  }
  async changePassword(value: unknown) {
    const input = z
      .object({ currentPassword: z.string().max(1024), password: accountSchema.shape.password })
      .strict()
      .parse(value);
    return this.serial(async () => {
      if (
        !this.installed ||
        !this.credentials ||
        !(await compare(input.currentPassword, this.credentials.hash))
      )
        throw new InstallationError('当前密码不正确。', 401);
      await this.persist({ ...this.installed, passwordHash: await hash(input.password, 12) });
    });
  }
  async reset(value: unknown): Promise<ResetResult> {
    const input = z
      .object({
        confirmation: z.literal(RESET_CONFIRMATION),
        fillExample: z.boolean(),
        revision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(value);
    return this.serial(async () => {
      if (!this.active) throw new Error('Installation is required.');
      const before = await this.active.read();
      if (before.revision !== input.revision) throw new ConflictError();
      const backup = path.join(
        this.config.dataDir,
        'backups',
        `before-reset-${Date.now()}-${randomUUID().slice(0, 8)}`,
      );
      await mkdir(backup, { recursive: true });
      await writeFile(path.join(backup, 'workspace.json'), JSON.stringify(before), {
        flag: 'wx',
        mode: 0o600,
      });
      await writeFile(
        path.join(backup, 'chronicle-cartarium-backup.json'),
        JSON.stringify({ format: CREATIVE_BACKUP_FORMAT, version: 1, data: before.data }),
        { flag: 'wx', mode: 0o600 },
      );
      const uploads = path.join(this.config.dataDir, 'uploads');
      await cp(uploads, path.join(backup, 'uploads'), {
        recursive: true,
        dereference: false,
        errorOnExist: true,
      });
      // Backup is complete before the revision-checked transaction replaces any content.
      const envelope = await this.active.save(
        input.fillExample ? createExampleWorkspace() : createEmptyWorkspace(),
        input.revision,
      );
      let cleanupWarning = false;
      const entries = await readdir(uploads, { withFileTypes: true }).catch(() => {
        cleanupWarning = true;
        return [];
      });
      for (const entry of entries) {
        if (entry.isFile() && /^[a-f0-9-]+\.(png|jpg|webp)$/i.test(entry.name)) {
          try {
            await unlink(path.join(uploads, entry.name));
          } catch {
            cleanupWarning = true;
          }
        }
      }
      return { envelope, backup: path.basename(backup), cleanupWarning };
    });
  }
  upload<T>(operation: () => Promise<T>) {
    return this.serial(operation);
  }
  async close() {
    await this.queue;
    await this.active?.close();
  }
  async backupDatabase(directory: string) {
    if (!this.active?.backupDatabase) throw new Error('当前存储尚不支持完整备份。');
    return this.active.backupDatabase(directory);
  }
  async verifyDatabaseBackup(directory: string, info: import('./store').DatabaseBackupInfo) {
    if (info.storage === 'sqlite') return SqliteStore.readBackup(path.join(directory, info.file));
    if (info.storage === 'demo') {
      const value = JSON.parse(await readFile(path.join(directory, info.file), 'utf8'));
      const { validateWorkspace } = await import('./validation');
      return {
        data: validateWorkspace(value.data),
        revision: value.revision,
        mode: 'demo' as const,
      };
    }
    const url = this.installed?.databaseUrl || this.config.databaseUrl;
    if (!url) throw new Error('MySQL连接配置缺失。');
    const { verifyMysqlRecovery } = await import('./mysql-backup');
    return verifyMysqlRecovery(path.join(directory, info.file), url);
  }
  async verifyOwnerPassword(password: string) {
    if (this.installed && !this.loginEnabled) return password === '';
    return Boolean(
      this.credentials &&
      Buffer.byteLength(password, 'utf8') <= 72 &&
      (await compare(password, this.credentials.hash)),
    );
  }
  async backupPrivate(filename: string) {
    if (!this.installed) throw new Error('安装尚未完成。');
    const saved = {
      ...this.installed,
      ...(this.installed.storage === 'mysql'
        ? { databaseUrl: this.installed.databaseUrl || this.config.databaseUrl }
        : {}),
    };
    await writeFile(filename, JSON.stringify(saved, null, 2), { flag: 'wx', mode: 0o600 });
  }
  async privateFingerprint() {
    const { digest } = await import('./full-backup');
    return digest({
      ...this.installed,
      ...(this.installed?.storage === 'mysql'
        ? { databaseUrl: this.installed.databaseUrl || this.config.databaseUrl }
        : {}),
    });
  }
}
export class InstallationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
