import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile, rename, unlink, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { APPLICATION_VERSION } from '../shared/application';
import {
  UPDATE_SOURCES,
  updateMirrorBaseUrl,
  updateSourceChoice,
  updateSourceLabel,
} from '../shared/update-sources';
import type {
  OnlineUpdateSettings,
  OnlineUpdateStatus,
  OnlineUpdateRelease,
  OnlineUpdateTask,
} from '../shared/update';
import { DataProtectionError, MaintenanceError } from './maintenance';
import { ProgramUpdateService } from './program-update';
import { compareVersions } from './release-package';
import { readUpdateJson, downloadUpdateFile, validateUpdateUrl } from './update-download';

export const UPDATE_REPOSITORY = 'https://github.com/hachimenHato/chronicle-cartarium';
export const UPDATE_CATALOG =
  'https://api.github.com/repos/hachimenHato/chronicle-cartarium/releases';
const MAX_PACKAGE_BYTES = 128 * 1024 ** 2;
const versionPattern = /^\d{1,9}\.\d{1,9}\.\d{1,9}(?:-(?:alpha|beta|rc)\.\d{1,9})?$/;
const settingsSchema = z
  .object({
    channel: z.enum(['stable', 'preview']),
    source: z.enum(['github', 'china', 'mirror']),
    mirrorBaseUrl: z.string().max(1500).optional(),
  })
  .strict();

export function parseOnlineSettings(input: unknown): OnlineUpdateSettings {
  const settings = settingsSchema.parse(input);
  if (settings.source === 'china') {
    return {
      channel: settings.channel,
      source: 'mirror',
      mirrorBaseUrl: UPDATE_SOURCES.china.baseUrl,
    };
  }
  const base = settings.mirrorBaseUrl?.trim();
  if (settings.source === 'mirror' && !base)
    throw new DataProtectionError('请填写自己管理的 HTTPS 镜像地址。');
  if (base) {
    if (/%|\\/.test(base)) throw new DataProtectionError('镜像地址不能包含编码路径或反斜杠。');
    let url: URL;
    try {
      url = validateUpdateUrl(base);
    } catch {
      throw new DataProtectionError('镜像地址必须是无凭据的公开 HTTPS 地址。');
    }
    if (url.search || url.hash || url.port || /%|\\/.test(url.pathname))
      throw new DataProtectionError('镜像地址只能包含 HTTPS 域名和目录，不包含端口、参数或凭据。');
    settings.mirrorBaseUrl = url.href.replace(/\/+$/, '');
  } else delete settings.mirrorBaseUrl;
  return { ...settings, source: settings.source };
}

/** Catalog metadata is untrusted. Only a precisely named asset in the fixed official repository is eligible. */
export function selectOnlineRelease(
  input: unknown,
  channel: OnlineUpdateSettings['channel'],
  platform: string,
  architecture: string,
): OnlineUpdateRelease | undefined {
  if (!Array.isArray(input) || input.length > 100)
    throw new DataProtectionError('更新清单格式无效。');
  const candidates: OnlineUpdateRelease[] = [];
  for (const row of input) {
    if (!row || typeof row !== 'object' || row.draft !== false || typeof row.tag_name !== 'string')
      continue;
    const version = row.tag_name.startsWith('v') ? row.tag_name.slice(1) : '';
    if (
      !versionPattern.test(version) ||
      (channel === 'stable' && (version.includes('-') || row.prerelease !== false))
    )
      continue;
    if (typeof row.published_at !== 'string' || !Number.isFinite(Date.parse(row.published_at)))
      continue;
    const releaseUrl = `${UPDATE_REPOSITORY}/releases/tag/v${version}`;
    if (row.html_url !== releaseUrl) continue;
    const name = `chronicle-cartarium-${version}-${platform === 'win32' ? 'win' : platform}-${architecture}.ccupdate`;
    const assets = Array.isArray(row.assets)
      ? row.assets.filter(
          (asset: unknown) =>
            !!asset && typeof asset === 'object' && (asset as { name?: string }).name === name,
        )
      : [];
    const asset = assets.length === 1 ? assets[0] : undefined;
    const eligible =
      asset &&
      asset.state === 'uploaded' &&
      Number.isSafeInteger(asset.size) &&
      asset.size > 0 &&
      asset.size <= MAX_PACKAGE_BYTES &&
      typeof asset.digest === 'string' &&
      /^sha256:[a-f0-9]{64}$/.test(asset.digest) &&
      asset.browser_download_url === `${UPDATE_REPOSITORY}/releases/download/v${version}/${name}`;
    candidates.push({
      version,
      name: typeof row.name === 'string' ? row.name.slice(0, 200) : `v${version}`,
      notes: typeof row.body === 'string' ? row.body.slice(0, 12000) : '',
      publishedAt: new Date(row.published_at).toISOString(),
      releaseUrl,
      ...(eligible ? { asset: { name, bytes: asset.size, sha256: asset.digest.slice(7) } } : {}),
    });
  }
  candidates.sort((left, right) => compareVersions(right.version, left.version));
  if (candidates.length > 1 && candidates[0].version === candidates[1].version)
    throw new DataProtectionError('更新清单存在重复版本，暂不安装。');
  return candidates[0];
}

interface OnlineDependencies {
  readJson?: typeof readUpdateJson;
  download?: typeof downloadUpdateFile;
  currentVersion?: string;
  platform?: string;
  architecture?: string;
  now?: () => number;
}

export class OnlineUpdateService {
  private settings: OnlineUpdateSettings;
  private ready: Promise<void>;
  private checking?: Promise<void>;
  private saving = false;
  private lastAttempt?: number;
  private checkedAt?: string;
  private checkError?: string;
  private notice?: string;
  private release?: OnlineUpdateRelease;
  private task?: OnlineUpdateTask;
  private controller?: AbortController;
  private taskDone?: Promise<void>;
  private readonly currentVersion: string;
  private readonly platform: string;
  private readonly architecture: string;
  private readonly now: () => number;
  constructor(
    private program: ProgramUpdateService,
    private dependencies: OnlineDependencies = {},
  ) {
    this.currentVersion = dependencies.currentVersion || APPLICATION_VERSION;
    this.platform = dependencies.platform || process.platform;
    this.architecture = dependencies.architecture || process.arch;
    this.now = dependencies.now || Date.now;
    this.settings = {
      channel: this.currentVersion.includes('-') ? 'preview' : 'stable',
      source: 'github',
    };
    this.ready = this.loadSettings();
  }
  private get settingsFile() {
    return path.join(this.program.root, 'online-update-settings.json');
  }
  private async loadSettings() {
    try {
      this.settings = parseOnlineSettings(JSON.parse(await readFile(this.settingsFile, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.checkError = '更新源配置无法读取，已使用 GitHub 默认设置，请重新保存下载源。';
    }
  }
  private get active() {
    return !!this.controller;
  }
  async status(): Promise<OnlineUpdateStatus> {
    await this.ready;
    const available =
      !!this.release && compareVersions(this.release.version, this.currentVersion) > 0;
    const supported =
      this.program.mode === 'managed' &&
      ['win32', 'linux', 'darwin'].includes(this.platform) &&
      ['x64', 'arm64'].includes(this.architecture) &&
      !!this.release?.asset;
    return structuredClone({
      currentVersion: this.currentVersion,
      platform: this.platform,
      architecture: this.architecture,
      settings: this.settings,
      checking: !!this.checking,
      checkedAt: this.checkedAt,
      checkError: this.checkError,
      notice: this.notice,
      release: this.release,
      upToDate: !!this.checkedAt && !this.checkError && !available,
      supported,
      supportMessage:
        this.program.mode === 'docker'
          ? '容器请由宿主机备份后更新镜像；网页不会替换运行中的容器。'
          : this.program.mode !== 'managed'
            ? '请使用安装根目录 start.cmd / start.sh 启动受管理实例后更新。'
            : this.release && !this.release.asset
              ? '此版本尚未提供适配当前系统与架构的签名更新包，可查看发行说明；普通安装包不能直接用于在线更新。'
              : undefined,
      task: this.task,
    });
  }
  async saveSettings(input: unknown) {
    await this.ready;
    if (this.active || this.checking || this.saving) throw new MaintenanceError();
    const settings = parseOnlineSettings(input);
    this.saving = true;
    const temporary = this.settingsFile + '.' + randomUUID() + '.tmp';
    try {
      await mkdir(this.program.root, { recursive: true, mode: 0o700 });
      await writeFile(temporary, JSON.stringify(settings), { flag: 'wx', mode: 0o600 });
      await rename(temporary, this.settingsFile);
      this.settings = settings;
      this.lastAttempt = undefined;
      this.checkedAt = undefined;
      this.checkError = undefined;
      this.release = undefined;
      this.notice = undefined;
      this.task = undefined;
    } finally {
      this.saving = false;
      await unlink(temporary).catch(() => undefined);
    }
    return this.status();
  }
  async check() {
    await this.ready;
    if (this.active || this.saving) throw new MaintenanceError();
    if (this.checking) {
      await this.checking;
      return this.status();
    }
    // No background GitHub polling: cache successful checks and back off failed requests.
    if (
      this.lastAttempt !== undefined &&
      this.now() - this.lastAttempt < (this.checkError ? 60_000 : 15 * 60_000)
    )
      return this.status();
    this.lastAttempt = this.now();
    this.checking = this.checkCatalog();
    try {
      await this.checking;
    } finally {
      this.checking = undefined;
    }
    return this.status();
  }
  private async checkCatalog() {
    this.checkError = undefined;
    this.notice = undefined;
    const read = this.dependencies.readJson || readUpdateJson;
    try {
      let catalog: unknown;
      const mirror = updateMirrorBaseUrl(this.settings);
      if (mirror) {
        try {
          catalog = await read(`${mirror}/releases.json`);
          // Validate before trusting a response; malformed mirrors also fall back.
          selectOnlineRelease(catalog, this.settings.channel, this.platform, this.architecture);
        } catch {
          this.notice = `${updateSourceLabel(this.settings)}清单暂不可用，已改用 GitHub 官方源。`;
          catalog = await read(UPDATE_CATALOG);
        }
      } else catalog = await read(UPDATE_CATALOG);
      this.release = selectOnlineRelease(
        catalog,
        this.settings.channel,
        this.platform,
        this.architecture,
      );
      this.checkedAt = new Date(this.now()).toISOString();
    } catch {
      this.checkError =
        '暂时无法检查新版本，可能是网络不可用或下载源限流。原程序和数据不受影响；一分钟后可重试，也可离线导入官方更新包。';
      this.release = undefined;
    }
  }
  async startDownload(version: string) {
    await this.ready;
    const state = await this.status();
    if (this.active || this.checking || this.saving) throw new MaintenanceError();
    if (
      !state.supported ||
      state.upToDate ||
      this.checkError ||
      !this.checkedAt ||
      !this.release?.asset ||
      this.release.version !== version ||
      this.now() - Date.parse(this.checkedAt) > 30 * 60_000 ||
      compareVersions(version, this.currentVersion) <= 0
    )
      throw new DataProtectionError('请先检查新版本，并选择适合当前系统的官方签名更新包。');
    const release = structuredClone(this.release);
    const asset = release.asset!;
    const controller = new AbortController();
    this.controller = controller;
    const task: OnlineUpdateTask = {
      id: randomUUID(),
      phase: 'downloading',
      version,
      received: 0,
      total: asset.bytes,
      source: updateSourceChoice(this.settings),
      message: '正在下载更新包，原程序和数据保持可用…',
    };
    this.task = task;
    const directory = path.join(this.program.root, 'online-incoming');
    let ownedDirectory: string | undefined;
    const cleanup = async () => {
      if (ownedDirectory) await rm(ownedDirectory, { recursive: true, force: true });
    };
    // This promise only stages verified files. Applying requires a fresh authenticated request.
    this.taskDone = this.program
      .prepareOnline(
        async () => {
          await mkdir(directory, { recursive: true, mode: 0o700 });
          ownedDirectory = await mkdtemp(path.join(directory, 'download-'));
          const archive = path.join(ownedDirectory, 'update.ccupdate');
          const download = this.dependencies.download || downloadUpdateFile;
          const official = `${UPDATE_REPOSITORY}/releases/download/v${version}/${asset.name}`;
          const fetch = async (url: string) =>
            download(
              url,
              archive,
              { bytes: asset.bytes, sha256: asset.sha256 },
              (received) => {
                task.received = received;
              },
              controller.signal,
            );
          const mirror = updateMirrorBaseUrl(this.settings);
          if (mirror) {
            try {
              await fetch(`${mirror}/v${version}/${asset.name}`);
            } catch {
              controller.signal.throwIfAborted();
              // The downloader owns/deletes partial files before another source can be tried.
              task.source = 'github';
              task.received = 0;
              task.message = `${updateSourceLabel(this.settings)}下载未通过，正在改用 GitHub 官方源…`;
              await fetch(official);
            }
          } else await fetch(official);
          controller.signal.throwIfAborted();
          task.phase = 'verifying';
          task.message = '下载完成，正在验证官方签名、文件及版本兼容性…';
          return archive;
        },
        version,
        controller.signal,
      )
      .then(async (prepared) => {
        await cleanup();
        task.phase = 'prepared';
        task.packageId = prepared.packageId;
        task.message = '下载与官方签名验证完成，等待安全更新。';
      })
      .catch(() => {
        task.phase = controller.signal.aborted ? 'cancelled' : 'error';
        task.message = controller.signal.aborted
          ? '已取消下载，原程序和数据保留。'
          : '下载或官方签名校验未通过，未应用更新，原程序和数据保留。请稍后重试或导入官方更新包。';
      })
      .finally(async () => {
        await cleanup().catch(() => undefined);
        this.controller = undefined;
      });
    return this.status();
  }
  async cancel(id: string) {
    // Once verification starts, its prepared-state commit must finish atomically.
    if (!this.active || this.task?.id !== id || this.task.phase !== 'downloading')
      throw new DataProtectionError('下载已结束或正在验证，无法取消；验证完成后可选择是否安装。');
    this.controller!.abort();
    await this.taskDone;
    return this.status();
  }
}
