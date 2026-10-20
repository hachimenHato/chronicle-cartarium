import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { hash, compare } from 'bcryptjs';
import { z } from 'zod';
import { moduleLabels, ownerAccount, type UserAccount, type UserDirectory } from '../shared/access';
import { ConflictError } from './store';
import { PermissionError, requireAdministrator, requireOwner } from './permissions';
import { MaintenanceGate } from './maintenance';

const username = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[\p{L}\p{N}_.-]+$/u);
const password = z
  .string()
  .min(10)
  .max(72)
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72);
const scope = z.enum(['none', 'own', 'any']);
const module = z.enum(
  Object.keys(moduleLabels) as [keyof typeof moduleLabels, ...(keyof typeof moduleLabels)[]],
);
export const grantsSchema = z.partialRecord(
  module,
  z.object({ create: z.boolean(), update: scope, delete: scope }).strict(),
);
const recordsSchema = z
  .record(
    z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    z
      .object({
        read: z.boolean().optional(),
        update: z.boolean().optional(),
        delete: z.boolean().optional(),
      })
      .strict(),
  )
  .refine((v) => Object.keys(v).length <= 20_000);
const accountSchema = z
  .object({
    id: z.string().regex(/^user_[a-f0-9-]{36}$/),
    username,
    role: z.enum(['moderator', 'user']),
    disabled: z.boolean(),
    grants: grantsSchema,
    records: recordsSchema,
    canExport: z.boolean(),
    canViewPrivate: z.boolean(),
    tourCompleted: z.boolean(),
    passwordHash: z.string().regex(/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/),
  })
  .strict();
export const savedUserDirectorySchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    revision: z.number().int().nonnegative(),
    ownerTourCompleted: z.boolean(),
    users: z.array(accountSchema).max(200),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.users.map((u) => u.id)).size === v.users.length &&
      new Set(v.users.map((u) => u.username.toLocaleLowerCase())).size === v.users.length,
  );
type Saved = z.infer<typeof savedUserDirectorySchema>;
const editable = accountSchema.omit({ id: true, passwordHash: true, tourCompleted: true });
export const userWriteSchema = editable
  .extend({
    id: z.string().optional(),
    password: password.optional(),
    revision: z.number().int().nonnegative(),
  })
  .strict();

/** Credentials and authorization are private installation data, never part of creative exports. */
export class UserDirectoryStore {
  private current: Saved = {
    version: 1,
    enabled: false,
    revision: 0,
    ownerTourCompleted: false,
    users: [],
  };
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(
    private filename: string,
    private primary: () => { username: string; hash: string } | undefined,
    private maintenance?: MaintenanceGate,
  ) {}
  static async open(
    filename: string,
    primary: () => { username: string; hash: string } | undefined,
    maintenance?: MaintenanceGate,
  ) {
    const directory = new UserDirectoryStore(filename, primary, maintenance);
    try {
      directory.current = savedUserDirectorySchema.parse(
        JSON.parse(await readFile(filename, 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return directory;
  }
  get enabled() {
    return this.current.enabled;
  }
  async initializeForInstallation(enabled: boolean) {
    return this.serial(async () => {
      if (this.current.revision !== 0 || this.current.users.length)
        throw new PermissionError('已有用户配置，不能作为全新安装覆盖。');
      const before = this.current;
      await this.persist({ ...before, enabled });
      return () => this.serial(() => this.persist(before));
    });
  }
  actor(id: string): UserAccount | undefined {
    if (id === 'owner')
      return {
        ...ownerAccount(this.primary()?.username),
        tourCompleted: this.current.ownerTourCompleted,
      };
    if (!this.current.enabled) return undefined;
    const account = this.current.users.find((u) => u.id === id && !u.disabled);
    if (!account) return undefined;
    const { passwordHash: _hash, ...safe } = account;
    return structuredClone(safe);
  }
  publicDirectory(): UserDirectory {
    return {
      enabled: this.current.enabled,
      loginEnabled: Boolean(this.primary()),
      revision: this.current.revision,
      users: [
        this.actor('owner')!,
        ...this.current.users.map(({ passwordHash: _hash, ...account }) =>
          structuredClone(account),
        ),
      ],
    };
  }
  async read(): Promise<UserDirectory> {
    await this.queue;
    return this.publicDirectory();
  }
  async backupPrivate(filename: string) {
    await this.queue;
    await writeFile(filename, JSON.stringify(this.current, null, 2), { flag: 'wx', mode: 0o600 });
  }
  async privateFingerprint() {
    const { digest } = await import('./full-backup');
    return digest(this.current);
  }
  async authenticate(name: string, value: string): Promise<string | undefined> {
    if (Buffer.byteLength(value, 'utf8') > 72) return undefined;
    const primary = this.primary();
    if (!primary) return undefined;
    const account = this.current.enabled
      ? this.current.users.find((u) => u.username === name && !u.disabled)
      : undefined;
    const expected =
      name === primary.username ? primary.hash : (account?.passwordHash ?? primary.hash);
    const valid = await compare(value, expected);
    return valid ? (name === primary.username ? 'owner' : account?.id) : undefined;
  }
  private serial<T>(operation: () => Promise<T>) {
    const enqueue = () => {
      const task = this.queue.then(operation);
      this.queue = task.catch(() => undefined);
      return task;
    };
    return this.maintenance ? this.maintenance.write(enqueue) : enqueue();
  }
  private async persist(next: Saved) {
    const valid = savedUserDirectorySchema.parse(next);
    const temporary = `${this.filename}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(valid, null, 2), { flag: 'wx', mode: 0o600 });
    await rename(temporary, this.filename);
    this.current = valid;
  }
  setEnabled(actor: UserAccount, enabled: boolean, revision: number) {
    requireOwner(actor);
    return this.serial(async () => {
      if (revision !== this.current.revision) throw new ConflictError();
      if (enabled && !this.primary())
        throw new PermissionError('请先在后台开启登录并设置主管理员账号密码。');
      await this.persist({ ...this.current, enabled, revision: revision + 1 });
      return this.publicDirectory();
    });
  }
  write(actor: UserAccount, value: unknown, validRecordIds: Set<string>) {
    requireAdministrator(actor);
    const input = userWriteSchema.parse(value);
    return this.serial(async () => {
      if (input.revision !== this.current.revision) throw new ConflictError();
      if (!this.current.enabled) throw new PermissionError('请先由主管理员开启多用户模式。');
      if (input.id === 'owner') throw new PermissionError('主管理员不能通过用户管理修改。');
      if (input.id === actor.id && (input.disabled || input.role !== actor.role))
        throw new PermissionError('不能禁用或降级当前登录账户。');
      if (Object.keys(input.records).some((id) => !validRecordIds.has(id)))
        throw new PermissionError('单独授权的条目不存在，请重新加载。');
      if (
        input.username.toLocaleLowerCase() === this.primary()?.username.toLocaleLowerCase() ||
        this.current.users.some(
          (u) =>
            u.id !== input.id &&
            u.username.toLocaleLowerCase() === input.username.toLocaleLowerCase(),
        )
      )
        throw new PermissionError('用户名已存在。');
      const existing = this.current.users.find((u) => u.id === input.id);
      if (input.id && !existing) throw new PermissionError('账户不存在。');
      if (!existing && !input.password) throw new PermissionError('创建账户需要设置初始密码。');
      const { revision: _revision, password: secret, ...properties } = input;
      const next = {
        ...properties,
        id: existing?.id ?? `user_${randomUUID()}`,
        passwordHash: secret ? await hash(secret, 12) : existing!.passwordHash,
        tourCompleted: existing?.tourCompleted ?? false,
      };
      await this.persist({
        ...this.current,
        users: existing
          ? this.current.users.map((u) => (u.id === existing.id ? next : u))
          : [...this.current.users, next],
        revision: input.revision + 1,
      });
      return this.publicDirectory();
    });
  }
  remove(actor: UserAccount, id: string, revision: number) {
    requireAdministrator(actor);
    return this.serial(async () => {
      if (revision !== this.current.revision) throw new ConflictError();
      if (id === 'owner' || id === actor.id)
        throw new PermissionError('不能删除主管理员或当前登录账户。');
      if (!this.current.users.some((u) => u.id === id)) throw new PermissionError('账户不存在。');
      await this.persist({
        ...this.current,
        users: this.current.users.filter((u) => u.id !== id),
        revision: revision + 1,
      });
      return this.publicDirectory();
    });
  }
  completeTour(id: string) {
    return this.serial(async () => {
      if (!this.actor(id)) throw new PermissionError();
      await this.persist({
        ...this.current,
        revision: this.current.revision + 1,
        ...(id === 'owner'
          ? { ownerTourCompleted: true }
          : {
              users: this.current.users.map((u) =>
                u.id === id ? { ...u, tourCompleted: true } : u,
              ),
            }),
      });
      return this.actor(id);
    });
  }
  changePassword(id: string, value: unknown) {
    const input = z
      .object({ currentPassword: z.string().max(1024), password })
      .strict()
      .parse(value);
    return this.serial(async () => {
      const account = this.current.users.find((u) => u.id === id && !u.disabled);
      if (!account || !(await compare(input.currentPassword, account.passwordHash)))
        throw new PermissionError('当前密码不正确。');
      const passwordHash = await hash(input.password, 12);
      await this.persist({
        ...this.current,
        revision: this.current.revision + 1,
        users: this.current.users.map((u) => (u.id === id ? { ...u, passwordHash } : u)),
      });
    });
  }
}
