import { DataProtectionError } from './maintenance';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile, rename, access, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config';
import type { ProgramUpdateStatus } from '../shared/update';
import { APPLICATION_VERSION } from '../shared/application';
import { extractBackup } from './backup-recovery';
import { verifyRelease } from './release-package';
import { MaintenanceError } from './maintenance';

export class ProgramUpdateService {
  private busy = false;
  constructor(
    private config: AppConfig,
    private verify = (directory: string) => verifyRelease(directory, APPLICATION_VERSION),
  ) {}
  get mode() {
    return this.config.deployment || 'manual';
  }
  get root() {
    return path.join(this.config.installRoot || this.config.dataDir, '.worldloom');
  }
  async status(): Promise<ProgramUpdateStatus> {
    const fallback: ProgramUpdateStatus = {
      mode: this.mode,
      phase: 'idle',
      message:
        this.mode === 'docker'
          ? '容器部署通过宿主机更新镜像，数据卷和完整备份保持不变。'
          : this.mode === 'manual'
            ? '请通过start.cmd或start.sh启动，以启用受保护的程序更新。'
            : '导入官方受签名更新包，系统将自动备份、验证和更新。',
    };
    const state = await readFile(path.join(this.root, 'update-state.json'), 'utf8').catch(
      () => undefined,
    );
    if (!state) return fallback;
    const saved = JSON.parse(state);
    return {
      ...fallback,
      phase: saved.phase,
      message: saved.message,
      ...(saved.version ? { version: saved.version } : {}),
      ...(saved.packageId ? { packageId: saved.packageId } : {}),
    };
  }
  async prepare(archive: string) {
    return this.exclusive(() => this.prepareUnlocked(archive));
  }
  /** Reserve the same gate for download, offline import and apply; creative writes stay available. */
  async prepareOnline(download: () => Promise<string>, version: string, signal: AbortSignal) {
    return this.exclusive(async () => {
      await this.assertAvailable();
      const archive = await download();
      signal.throwIfAborted();
      return this.prepareUnlocked(archive, version, signal);
    });
  }
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy) throw new MaintenanceError();
    this.busy = true;
    try {
      return await operation();
    } finally {
      this.busy = false;
    }
  }
  private async assertAvailable() {
    if (this.mode !== 'managed')
      throw new DataProtectionError('当前部署方式应使用宿主机更新流程。');
    const status = await this.status();
    if (
      ['preparing', 'backup', 'switching', 'checking'].includes(status.phase) ||
      (await access(path.join(this.root, 'pending-update.json')).then(
        () => true,
        () => false,
      ))
    )
      throw new MaintenanceError();
  }
  private async prepareUnlocked(archive: string, expectedVersion?: string, signal?: AbortSignal) {
    await this.assertAvailable();
    await mkdir(path.join(this.root, 'staged'), { recursive: true, mode: 0o700 });
    const parent = await mkdtemp(path.join(this.root, 'staged', 'package-'));
    const directory = path.join(parent, 'program');
    try {
      await extractBackup(archive, directory, 'RELEASE-MANIFEST.json', 512 * 1024 ** 2);
      const manifest = await this.verify(directory);
      signal?.throwIfAborted();
      if (expectedVersion && manifest.version !== expectedVersion)
        throw new DataProtectionError('下载版本与官方签名版本不一致。');
      const packageId = path.basename(parent);
      await this.writeState({
        mode: this.mode,
        phase: 'prepared',
        message: '更新包签名、文件及数据格式检查通过，可以安全准备更新。',
        version: manifest.version,
        packageId,
      });
      return this.status();
    } catch (error) {
      // Only this invocation's newly created staging directory is disposable.
      await rm(parent, { recursive: true, force: true });
      throw error;
    }
  }
  async apply(packageId: string) {
    return this.exclusive(() => this.applyUnlocked(packageId));
  }
  private async applyUnlocked(packageId: string) {
    const status = await this.status();
    if (
      this.mode !== 'managed' ||
      status.phase !== 'prepared' ||
      status.packageId !== packageId ||
      !/^package-[A-Za-z0-9]+$/.test(packageId)
    )
      throw new DataProtectionError('请先导入并验证兼容更新包。');
    const program = path.join(this.root, 'staged', packageId, 'program');
    const manifest = await this.verify(program);
    const task = { id: randomUUID(), packageId, version: manifest.version };
    const filename = path.join(this.root, 'pending-update.json');
    if (
      await access(filename).then(
        () => true,
        () => false,
      )
    )
      throw new MaintenanceError();
    await writeFile(filename, JSON.stringify(task), { flag: 'wx', mode: 0o600 });
    await this.writeState({
      mode: this.mode,
      phase: 'preparing',
      message: '正在准备新版运行组件；完成后自动备份并更新…',
      version: manifest.version,
      packageId,
    });
    return this.status();
  }
  async writeState(state: ProgramUpdateStatus) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.root, 'state-' + randomUUID() + '.tmp');
    await writeFile(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
    await rename(temporary, path.join(this.root, 'update-state.json'));
  }
}
