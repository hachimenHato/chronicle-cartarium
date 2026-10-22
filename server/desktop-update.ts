import path from 'node:path';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, lstat, readdir, writeFile, rm, statfs } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { z } from 'zod';
import { createUpdateDownloader } from './update-download';
import { fileDigest } from './full-backup';
import { UPDATE_CATALOG, UPDATE_REPOSITORY, parseOnlineSettings } from './online-update';
import type { OnlineUpdateSettings } from '../shared/update';
const { digest, compare, verifyDesktopManifest, releaseDirectory } = createRequire(import.meta.url)(
  '../shared/desktop-update-security.cjs',
);
const downloader = createUpdateDownloader({ fileLimit: 512 * 1024 ** 2 });
const versionPattern = /^\d{1,9}\.\d{1,9}\.\d{1,9}(?:-(?:alpha|beta|rc)\.\d{1,9})?$/;
export interface DesktopCandidate {
  version: string;
  name: string;
  notes: string;
  bytes: number;
  sha256: string;
}
export interface DesktopManifest {
  version: string;
  archive: { name: string; bytes: number; sha256: string };
  treeSha256: string;
  entrypoints: Record<string, string>;
}
interface Dependencies {
  readJson?: typeof downloader.readUpdateJson;
  download?: typeof downloader.downloadUpdateFile;
  extract?: (archive: string, destination: string) => Promise<void>;
  trust?: Record<string, string>;
}
export function selectDesktopRelease(
  input: unknown,
  current: string,
  channel: 'stable' | 'preview',
): DesktopCandidate | undefined {
  if (!Array.isArray(input) || input.length > 100 || !versionPattern.test(current))
    throw new Error('桌面发行清单格式无效');
  const candidates: DesktopCandidate[] = [];
  for (const row of input) {
    if (!row || row.draft !== false || typeof row.tag_name !== 'string') continue;
    const version = row.tag_name.startsWith('v') ? row.tag_name.slice(1) : '';
    if (
      !versionPattern.test(version) ||
      compare(version, current) <= 0 ||
      (channel === 'stable' && (version.includes('-') || row.prerelease !== false)) ||
      row.html_url !== `${UPDATE_REPOSITORY}/releases/tag/v${version}` ||
      !Array.isArray(row.assets)
    )
      continue;
    const archive = `chronicle-cartarium-${version}-windows-desktop-x64.zip`;
    const metadata = `chronicle-cartarium-${version}-windows-desktop-x64.update.json`;
    const matching = (name: string, max: number) => {
      const list = row.assets.filter((asset: { name?: string }) => asset?.name === name);
      const asset = list.length === 1 ? list[0] : undefined;
      return asset?.state === 'uploaded' &&
        Number.isSafeInteger(asset.size) &&
        asset.size > 0 &&
        asset.size <= max &&
        /^sha256:[a-f0-9]{64}$/.test(asset.digest || '') &&
        asset.browser_download_url === `${UPDATE_REPOSITORY}/releases/download/v${version}/${name}`
        ? asset
        : undefined;
    };
    const asset = matching(archive, 512 * 1024 ** 2);
    if (!asset || !matching(metadata, 1024 ** 2)) continue;
    candidates.push({
      version,
      name: typeof row.name === 'string' ? row.name.slice(0, 200) : version,
      notes: typeof row.body === 'string' ? row.body.slice(0, 5000) : '',
      bytes: asset.size,
      sha256: asset.digest.slice(7),
    });
  }
  candidates.sort((a, b) => compare(b.version, a.version));
  if (candidates[0] && candidates[1]?.version === candidates[0].version)
    throw new Error('桌面发行存在重复版本');
  return candidates[0];
}
export async function desktopTree(directory: string) {
  const files: { path: string; bytes: number; sha256: string }[] = [];
  async function walk(parent: string) {
    for (const name of (await readdir(parent)).sort()) {
      const filename = path.join(parent, name),
        info = await lstat(filename);
      if (info.isSymbolicLink()) throw new Error('桌面更新不能包含链接');
      if (info.isDirectory()) await walk(filename);
      else if (info.isFile())
        files.push({
          path: path.relative(directory, filename).replaceAll('\\', '/'),
          bytes: info.size,
          sha256: await fileDigest(filename),
        });
      else throw new Error('桌面更新包含特殊文件');
      if (files.length > 100000) throw new Error('桌面更新文件过多');
    }
  }
  await walk(directory);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, sha256: digest(files) as string };
}
export class DesktopUpdateService {
  readonly settings: OnlineUpdateSettings;
  constructor(
    readonly currentVersion: string,
    settings: unknown,
    private dependencies: Dependencies = {},
  ) {
    if (!versionPattern.test(currentVersion)) throw new Error('当前桌面版本无效');
    this.settings = parseOnlineSettings(settings);
  }
  async check(signal?: AbortSignal) {
    const read = this.dependencies.readJson || downloader.readUpdateJson;
    if (this.settings.source === 'mirror') {
      try {
        const selected = selectDesktopRelease(
          await read(`${this.settings.mirrorBaseUrl}/releases.json`, signal),
          this.currentVersion,
          this.settings.channel,
        );
        if (selected) return selected;
      } catch {
        signal?.throwIfAborted();
      }
    }
    return selectDesktopRelease(
      await read(UPDATE_CATALOG, signal),
      this.currentVersion,
      this.settings.channel,
    );
  }
  async stage(
    base: string,
    candidate: DesktopCandidate,
    signal: AbortSignal,
    progress: (received: number, total: number, phase: string) => void,
  ) {
    if (
      !path.isAbsolute(base) ||
      !(await lstat(base)).isDirectory() ||
      (await lstat(base)).isSymbolicLink()
    )
      throw new Error('桌面安装目录无效');
    const desktop = path.join(base, '.desktop');
    await mkdir(desktop, { recursive: true, mode: 0o700 });
    if ((await lstat(desktop)).isSymbolicLink()) throw new Error('桌面配置目录不能是链接');
    const incoming = await mkdtemp(path.join(desktop, 'download-'));
    const releaseId = 'shell-' + randomUUID(),
      release = releaseDirectory(base, releaseId);
    let created = false,
      prepared = false;
    try {
      const space = await statfs(base);
      if (space.bavail * space.bsize < 3 * 1024 ** 3)
        throw new Error('桌面更新需要至少3GB可用空间');
      const read = this.dependencies.readJson || downloader.readUpdateJson;
      const metadata = `chronicle-cartarium-${candidate.version}-windows-desktop-x64.update.json`;
      const official = (name: string) =>
        `${UPDATE_REPOSITORY}/releases/download/v${candidate.version}/${name}`;
      let signed: unknown;
      if (this.settings.source === 'mirror') {
        try {
          signed = await read(
            `${this.settings.mirrorBaseUrl}/v${candidate.version}/${metadata}`,
            signal,
          );
          verifyDesktopManifest(signed, this.currentVersion, this.dependencies.trust);
        } catch {
          signal.throwIfAborted();
          signed = await read(official(metadata), signal);
        }
      } else signed = await read(official(metadata), signal);
      const manifest: DesktopManifest = verifyDesktopManifest(
        signed,
        this.currentVersion,
        this.dependencies.trust,
      );
      if (
        manifest.version !== candidate.version ||
        manifest.archive.bytes !== candidate.bytes ||
        manifest.archive.sha256 !== candidate.sha256
      )
        throw new Error('桌面包与官方签名信息不一致');
      const archive = path.join(incoming, 'desktop.zip');
      const download = this.dependencies.download || downloader.downloadUpdateFile;
      const fetchArchive = (url: string) =>
        download(
          url,
          archive,
          manifest.archive,
          (received) => progress(received, candidate.bytes, 'downloading'),
          signal,
        );
      if (this.settings.source === 'mirror') {
        try {
          await fetchArchive(
            `${this.settings.mirrorBaseUrl}/v${candidate.version}/${manifest.archive.name}`,
          );
        } catch {
          signal.throwIfAborted();
          await fetchArchive(official(manifest.archive.name));
        }
      } else await fetchArchive(official(manifest.archive.name));
      signal.throwIfAborted();
      progress(candidate.bytes, candidate.bytes, 'verifying');
      await mkdir(path.dirname(release), { recursive: true, mode: 0o700 });
      if ((await lstat(path.dirname(release))).isSymbolicLink())
        throw new Error('桌面版本目录不能是链接');
      await mkdir(release, { mode: 0o700 });
      created = true;
      const app = path.join(release, 'app');
      if (this.dependencies.extract) await this.dependencies.extract(archive, app);
      else
        await promisify(execFile)(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            path.resolve('scripts/extract-desktop-update.ps1'),
            '-Archive',
            archive,
            '-Destination',
            app,
          ],
          { windowsHide: true, timeout: 300000 },
        );
      const tree = await desktopTree(app);
      signal.throwIfAborted();
      if (tree.sha256 !== manifest.treeSha256) throw new Error('解压后的桌面文件与官方签名不一致');
      for (const [file, expected] of Object.entries(manifest.entrypoints))
        if ((await fileDigest(path.join(app, file))) !== expected)
          throw new Error('桌面启动组件校验失败');
      await writeFile(path.join(release, 'manifest.json'), JSON.stringify(signed), {
        flag: 'wx',
        mode: 0o600,
      });
      signal.throwIfAborted();
      prepared = true;
      return { releaseId, version: manifest.version };
    } finally {
      await rm(incoming, { recursive: true, force: true }).catch(() => undefined);
      if (created && !prepared)
        await rm(release, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
export const desktopRequestSchema = z
  .object({
    base: z.string().min(1),
    currentVersion: z.string().regex(versionPattern),
    settings: z.unknown(),
    version: z.string().regex(versionPattern).optional(),
  })
  .strict();
