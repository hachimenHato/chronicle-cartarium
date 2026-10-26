import path from 'node:path';
import { createReadStream } from 'node:fs';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { Parser } from 'tar';
import { pipeline } from 'node:stream/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { releaseManifestSchema, compareVersions } from '../../server/release-package';
import { releasePublicKeys } from '../../shared/release-trust';
import { validateUpdateUrl } from '../../server/update-download';
import type { PublicMirrorRelease } from '../create-update-mirror.mjs';
import { CosPublishError } from './cos-diagnostics';
import type { CosProgressEvent } from './cos-progress';
import {
  COS_MULTIPART_THRESHOLD,
  uploadCosMultipart,
  type CosMultipartClient,
} from './cos-multipart';
export { CosPublishError } from './cos-diagnostics';
const require = createRequire(import.meta.url);
// The builder strips all fields except the fixed public GitHub release contract.
const { publicRelease } = await import('../create-update-mirror.mjs');
const { isPrivateReleasePath } = await import('../release-security.mjs');
const { digest, verifyDesktopManifest } = require('../../shared/desktop-update-security.cjs');
const LIMIT = 1024 ** 2;
function need(value: unknown, code: string): asserts value {
  if (!value) throw new CosPublishError(code);
}
export interface CosConfig {
  bucket: string;
  region: string;
  prefix: string;
  publicBaseUrl: string;
}
export interface MirrorFile {
  relative: string;
  filename: string;
  bytes: number;
  sha256: string;
  md5: string;
}
export interface CosStore {
  versioning(): Promise<string | undefined>;
  head(key: string): Promise<{ bytes: number } | undefined>;
  catalog(key: string): Promise<Buffer | undefined>;
  put(input: {
    key: string;
    file?: string;
    body?: Buffer;
    bytes: number;
    md5: string;
    sha256: string;
    immutable: boolean;
    onProgress?: (progress: { loaded?: unknown }) => void;
    onRetry?: (attempt: number) => void;
    onPartRetry?: (attempt: number, partNumber: number, partCount: number) => void;
    onCleanupFailure?: () => void;
  }): Promise<void>;
}
export function loadCosConfig(env: NodeJS.ProcessEnv): CosConfig {
  const bucket = env.COS_BUCKET || '',
    region = env.COS_REGION || '';
  const prefix = (env.COS_PREFIX || 'chronicle-cartarium/updates').replace(/\/+$/, '');
  need(bucket.length <= 63 && /^[a-z0-9][a-z0-9-]*-[1-9]\d{4,19}$/.test(bucket), 'BUCKET');
  need(/^[a-z]{2}-[a-z][a-z0-9-]{1,35}$/.test(region), 'REGION');
  need(prefix.length <= 160 && /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)+$/.test(prefix), 'PREFIX');
  const publicBaseUrl = (
    env.COS_PUBLIC_BASE_URL || `https://${bucket}.cos.${region}.myqcloud.com/${prefix}`
  ).replace(/\/+$/, '');
  try {
    const url = validateUpdateUrl(publicBaseUrl);
    need(
      !url.search &&
        !url.hash &&
        !url.port &&
        !/%/.test(url.pathname) &&
        url.pathname === '/' + prefix,
      'PUBLIC_URL',
    );
  } catch {
    throw new CosPublishError('PUBLIC_URL');
  }
  return { bucket, region, prefix, publicBaseUrl };
}
async function hashFile(file: string) {
  const sha = createHash('sha256'),
    md5 = createHash('md5');
  for await (const chunk of createReadStream(file)) {
    sha.update(chunk);
    md5.update(chunk);
  }
  return { sha256: sha.digest('hex'), md5: md5.digest('base64') };
}
function catalog(input: Buffer): PublicMirrorRelease[] {
  need(input.length > 0 && input.length <= LIMIT, 'CATALOG_SIZE');
  try {
    const rows = JSON.parse(input.toString('utf8'));
    need(Array.isArray(rows) && rows.length > 0 && rows.length <= 100, 'CATALOG');
    const normalized = rows.map(publicRelease);
    need(normalized.every(Boolean), 'CATALOG');
    const versions = normalized.map((row) => {
      need(row, 'CATALOG');
      return row.version;
    });
    need(new Set(versions).size === versions.length, 'DUPLICATE_VERSION');
    return normalized.map((row) => {
      need(row, 'CATALOG');
      return row.release;
    });
  } catch {
    throw new CosPublishError('CATALOG');
  }
}
async function verifyBackend(file: MirrorFile, version: string, keys = releasePublicKeys) {
  const entries = new Map<string, { bytes: number; sha256: string }>();
  const promises: Promise<void>[] = [],
    paths = new Set<string>();
  let manifest: Buffer | undefined,
    total = 0,
    count = 0;
  const parser = new Parser({
    strict: true,
    onReadEntry(entry) {
      try {
        need(entry.type === 'File' && ++count <= 100000, 'ARCHIVE_ENTRY');
        need(
          !entry.path.includes('\\') &&
            !entry.path.includes(':') &&
            !entry.path.startsWith('/') &&
            entry.path.split('/').every((p) => p && p !== '.' && p !== '..'),
          'ARCHIVE_PATH',
        );
        need(!entries.has(entry.path.toLowerCase()), 'ARCHIVE_DUPLICATE');
        need(
          !/^(data|\.runtime|\.worldloom)(\/|$)|(^|\/)(\.env(?:\..*)?|mysql\.txt|users\.json|installation\.json|runner\.key|\.npmrc|\.cos(?:\..*)?)(\/|$)|\.(pem|sqlite|ccbackup|wlbackup)$/i.test(
            entry.path,
          ) ||
            entry.path.endsWith('/.env.example') ||
            entry.path === '.env.example',
          'ARCHIVE_PRIVATE',
        );
        need(!isPrivateReleasePath(entry.path), 'ARCHIVE_PRIVATE');
        entries.set(entry.path.toLowerCase(), { bytes: -1, sha256: '' });
        paths.add(entry.path);
        promises.push(
          new Promise<void>((resolve, reject) => {
            const hash = createHash('sha256'),
              chunks: Buffer[] = [];
            let bytes = 0;
            entry.on('data', (chunk: Buffer) => {
              bytes += chunk.length;
              total += chunk.length;
              hash.update(chunk);
              if (total > 2 * 1024 ** 3) parser.abort(new CosPublishError('ARCHIVE_SIZE'));
              if (entry.path === 'RELEASE-MANIFEST.json') {
                if (bytes > 16 * LIMIT) parser.abort(new CosPublishError('MANIFEST_SIZE'));
                else chunks.push(chunk);
              }
            });
            entry.on('error', reject);
            entry.on('end', () => {
              entries.set(entry.path.toLowerCase(), { bytes, sha256: hash.digest('hex') });
              if (entry.path === 'RELEASE-MANIFEST.json') manifest = Buffer.concat(chunks);
              resolve();
            });
            entry.resume();
          }).catch((error) => {
            parser.abort(error as Error);
          }),
        );
      } catch (error) {
        entry.resume();
        parser.abort(error as Error);
      }
    },
  });
  await pipeline(createReadStream(file.filename), parser);
  await Promise.all(promises);
  need(manifest, 'MANIFEST');
  const signed = JSON.parse(manifest.toString('utf8')),
    m = releaseManifestSchema.parse(signed.manifest);
  need(
    Object.keys(signed).sort().join('|') === 'manifest|signature' &&
      typeof signed.signature === 'string',
    'MANIFEST',
  );
  need(
    keys[m.keyId] &&
      verify(null, Buffer.from(digest(m)), keys[m.keyId], Buffer.from(signed.signature, 'base64')),
    'SIGNATURE',
  );
  const target = `${m.platform === 'win32' ? 'win' : m.platform}-${m.architecture}`;
  need(
    m.version === version &&
      path.basename(file.filename) === `chronicle-cartarium-${version}-${target}.ccupdate`,
    'MANIFEST_VERSION',
  );
  need(entries.size === m.entries.length + 1, 'MANIFEST_FILES');
  need(
    new Set(m.entries.map((item) => item.path.toLowerCase())).size === m.entries.length,
    'MANIFEST_FILES',
  );
  for (const item of m.entries) {
    const actual = entries.get(item.path.toLowerCase());
    need(
      paths.has(item.path) &&
        actual &&
        actual.bytes === item.bytes &&
        actual.sha256 === item.sha256,
      'MANIFEST_HASH',
    );
  }
}
export async function planCosMirror(directory: string, keys = releasePublicKeys) {
  const root = path.resolve(directory),
    info = await lstat(root);
  need(info.isDirectory() && !info.isSymbolicLink(), 'DIRECTORY');
  const index = path.join(root, 'releases.json'),
    indexInfo = await lstat(index);
  need(indexInfo.isFile() && !indexInfo.isSymbolicLink() && indexInfo.size <= LIMIT, 'CATALOG');
  const releases = catalog(await readFile(index));
  const files: MirrorFile[] = [],
    allowed = new Set(['releases.json']);
  for (const release of releases) {
    need(release.assets.length > 0, 'EMPTY_RELEASE');
    for (const asset of release.assets) {
      need(
        /^chronicle-cartarium-[\d.]+(?:-(?:alpha|beta|rc)\.\d+)?-(?:(?:win-x64|linux-(?:x64|arm64)|darwin-(?:x64|arm64))\.ccupdate|windows-desktop-x64\.(?:zip|update\.json))$/.test(
          asset.name,
        ),
        'PLATFORM',
      );
      const relative = `${release.tag_name}/${asset.name}`;
      need(!allowed.has(relative), 'DUPLICATE');
      allowed.add(relative);
      const filename = path.join(root, relative),
        stat = await lstat(filename);
      need(stat.isFile() && !stat.isSymbolicLink() && stat.size === asset.size, 'FILE');
      const hashes = await hashFile(filename);
      need(hashes.sha256 === asset.digest.slice(7), 'FILE_HASH');
      files.push({ relative, filename, bytes: stat.size, ...hashes });
    }
  }
  async function walk(parent: string) {
    for (const name of await readdir(parent)) {
      const file = path.join(parent, name),
        s = await lstat(file);
      need(!s.isSymbolicLink(), 'LINK');
      if (s.isDirectory()) {
        need(
          releases.some((r) => path.relative(root, file) === r.tag_name),
          'EXTRA_DIRECTORY',
        );
        await walk(file);
      } else
        need(
          s.isFile() && allowed.has(path.relative(root, file).replaceAll('\\', '/')),
          'EXTRA_FILE',
        );
    }
  }
  await walk(root);
  // Signatures are verified with the application's existing public trust, never a COS-supplied key.
  for (const release of releases)
    for (const file of files.filter((f) => f.relative.startsWith(release.tag_name + '/'))) {
      if (file.filename.endsWith('.ccupdate'))
        await verifyBackend(file, release.tag_name.slice(1), keys);
      if (file.filename.endsWith('.update.json')) {
        const m = verifyDesktopManifest(
          JSON.parse(await readFile(file.filename, 'utf8')),
          undefined,
          keys,
        );
        const zip = files.find((f) => f.relative === `${release.tag_name}/${m.archive.name}`);
        need(
          m.version === release.tag_name.slice(1) &&
            zip &&
            zip.bytes === m.archive.bytes &&
            zip.sha256 === m.archive.sha256,
          'DESKTOP_SIGNATURE',
        );
      }
    }
  return { files, releases };
}
export async function publishCosMirror({
  directory,
  config,
  store,
  verifyPublic,
  dependencies,
  onProgress,
  concurrency = 1,
}: {
  directory: string;
  config: CosConfig;
  store: CosStore;
  verifyPublic: (file: MirrorFile, url: string) => Promise<void>;
  dependencies?: { plan?: typeof planCosMirror };
  onProgress?: (progress: CosProgressEvent) => void;
  concurrency?: number;
}) {
  need(
    Number.isSafeInteger(concurrency) && concurrency >= 1 && concurrency <= 3,
    'COS_CONCURRENCY',
  );
  onProgress?.({ stage: 'verify' });
  const plan = await (dependencies?.plan || planCosMirror)(directory);
  // This prefix is owned by one serialized workflow. A versioned bucket would ignore forbid-overwrite.
  onProgress?.({ stage: 'bucket' });
  need(!(await store.versioning()), 'BUCKET_VERSIONING');
  onProgress?.({ stage: 'read-catalog' });
  const key = config.prefix + '/releases.json',
    previous = await store.catalog(key),
    beforeHash = previous ? createHash('sha256').update(previous).digest('hex') : undefined;
  const old = previous ? catalog(previous) : [];
  const merged = new Map(old.map((r) => [r.tag_name, r]));
  for (const release of plan.releases) {
    const existing = merged.get(release.tag_name);
    if (existing)
      need(digest(existing.assets) === digest(release.assets), 'EXISTING_VERSION_CHANGED');
    merged.set(release.tag_name, release);
  }
  const rows = [...merged.values()].sort(
    (a, b) => -compareVersions(a.tag_name.slice(1), b.tag_name.slice(1)),
  );
  need(rows.length <= 100, 'CATALOG_COUNT');
  const body = Buffer.from(JSON.stringify(rows, null, 2) + '\n');
  need(body.length <= LIMIT, 'CATALOG_SIZE');
  async function publishFile(index: number, file: MirrorFile) {
    const counts = { fileIndex: index + 1, fileCount: plan.files.length, bytes: file.bytes };
    onProgress?.({ stage: 'file-start', ...counts });
    const objectKey = config.prefix + '/' + file.relative,
      existing = await store.head(objectKey);
    if (existing) need(existing.bytes === file.bytes, 'EXISTING_OBJECT_CHANGED');
    else
      await store.put({
        key: objectKey,
        file: file.filename,
        bytes: file.bytes,
        md5: file.md5,
        sha256: file.sha256,
        immutable: true,
        ...(onProgress
          ? {
              onRetry: (attempt: number) =>
                onProgress({ stage: 'upload-retry', ...counts, attempt }),
              onPartRetry: (attempt: number, partNumber: number, partCount: number) =>
                onProgress({ stage: 'part-retry', ...counts, attempt, partNumber, partCount }),
              onCleanupFailure: () =>
                onProgress({ stage: 'multipart-abort-unconfirmed', ...counts }),
            }
          : {}),
        ...(onProgress
          ? {
              onProgress: (progress: { loaded?: unknown }) => {
                if (typeof progress?.loaded !== 'number' || !Number.isFinite(progress.loaded))
                  return;
                onProgress({
                  stage: 'upload-progress',
                  ...counts,
                  loaded: Math.min(file.bytes, Math.max(0, Math.floor(progress.loaded))),
                });
              },
            }
          : {}),
      });
    // Anonymous HTTPS readback verifies exact bytes, readability, DNS safety and SHA before advertising.
    onProgress?.({ stage: 'file-readback', ...counts });
    await verifyPublic(file, config.publicBaseUrl + '/' + file.relative);
    onProgress?.({ stage: 'file-verified', ...counts });
  }
  let nextFile = 0;
  let failed = false;
  let firstError: unknown;
  async function worker() {
    while (!failed && nextFile < plan.files.length) {
      // Assignment is synchronous, so each file belongs to exactly one worker.
      const index = nextFile++;
      try {
        await publishFile(index, plan.files[index]);
      } catch (error) {
        onProgress?.({
          stage: 'file-failed',
          fileIndex: index + 1,
          fileCount: plan.files.length,
          bytes: plan.files[index].bytes,
        });
        if (!failed) {
          failed = true;
          firstError = error;
        }
        return;
      }
    }
  }
  // A failure stops new files but does not abandon writes/readbacks already in
  // flight. Wait for every worker before returning the first error; none of the
  // catalog reads or commits below may run unless all files passed verification.
  await Promise.all(Array.from({ length: Math.min(concurrency, plan.files.length) }, worker));
  if (failed) throw firstError;
  const now = await store.catalog(key);
  need(
    (now ? createHash('sha256').update(now).digest('hex') : undefined) === beforeHash,
    'CONCURRENT_PUBLISH',
  );
  onProgress?.({ stage: 'commit-catalog' });
  if (!previous?.equals(body)) {
    try {
      await store.put({
        key,
        body,
        bytes: body.length,
        md5: createHash('md5').update(body).digest('base64'),
        sha256: createHash('sha256').update(body).digest('hex'),
        immutable: false,
      });
    } catch {
      const written = await store.catalog(key);
      need(written?.equals(body), 'CATALOG_COMMIT_UNCONFIRMED');
    }
  }
  const committed = await store.catalog(key);
  need(committed?.equals(body), 'CATALOG_CONFIRM');
  await verifyPublic(
    {
      relative: 'releases.json',
      filename: path.join(path.resolve(directory), 'releases.json'),
      bytes: body.length,
      sha256: createHash('sha256').update(body).digest('hex'),
      md5: createHash('md5').update(body).digest('base64'),
    },
    config.publicBaseUrl + '/releases.json',
  );
  onProgress?.({ stage: 'done', fileCount: plan.files.length });
  return {
    packages: plan.files.length,
    releases: rows.length,
    publicBaseUrl: config.publicBaseUrl,
  };
}
export interface CosSdkClient extends Partial<CosMultipartClient> {
  headObject(params: Record<string, unknown>): Promise<any>;
  getObject(params: Record<string, unknown>): Promise<any>;
  getBucketVersioning(params: Record<string, unknown>): Promise<any>;
  putObject(params: Record<string, unknown>): Promise<any>;
}
// SDK stream PUTs cannot be replayed automatically. Only known transient errors
// may start a fresh attempt; an arbitrary HTTP 400 or permission error is final.
function retryableUpload(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { statusCode?: unknown; code?: unknown; error?: { Code?: unknown } };
  const status = value.statusCode;
  const code = value.error?.Code ?? value.code;
  if (typeof status === 'number') {
    if (status >= 500 && status <= 599) return true;
    if (status === 408 || status === 429) return true;
    return (
      status === 400 &&
      typeof code === 'string' &&
      ['RequestTimeout', 'RequestTimeOut', 'IncompleteBody'].includes(code)
    );
  }
  return (
    typeof code === 'string' &&
    ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH'].includes(
      code,
    )
  );
}
function objectAlreadyPresent(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { statusCode?: unknown; code?: unknown; error?: { Code?: unknown } };
  const code = value.error?.Code ?? value.code;
  return (
    (value.statusCode === 409 || value.statusCode === 412) &&
    (code === 'ObjectAlreadyExists' || code === 'PreconditionFailed')
  );
}
export function createCosStore(
  config: CosConfig,
  env: NodeJS.ProcessEnv,
  client?: CosSdkClient,
  uploadClient?: CosSdkClient,
  dependencies?: { wait?: (milliseconds: number) => Promise<unknown> },
): CosStore {
  const accelerate = env.COS_UPLOAD_ACCELERATE;
  need(
    accelerate === undefined ||
      accelerate === '' ||
      accelerate === 'false' ||
      accelerate === 'true',
    'COS_ACCELERATE',
  );
  need(env.TENCENT_COS_SECRET_ID && env.TENCENT_COS_SECRET_KEY, 'CREDENTIALS');
  function officialClient(useAccelerate: boolean): CosSdkClient {
    let COS;
    try {
      COS = require('../../tools/cos-publisher/node_modules/cos-nodejs-sdk-v5');
    } catch {
      throw new CosPublishError('COS_SDK');
    }
    return new COS({
      SecretId: env.TENCENT_COS_SECRET_ID,
      SecretKey: env.TENCENT_COS_SECRET_KEY,
      SecurityToken: env.TENCENT_COS_SESSION_TOKEN || undefined,
      Protocol: 'https:',
      Timeout: 600000,
      UseAccelerate: useAccelerate,
    });
  }
  // Injection is for adapter regression tests; the CLI supplies neither client.
  // SDK acceleration is client-wide and does not support bucket configuration
  // APIs. Keep all reads/checks on the ordinary endpoint; only explicit opt-in
  // PUT operations use a separate client. Enabling the paid bucket feature is
  // always a maintainer action in COS, never something this publisher changes.
  const cos = client ?? officialClient(false);
  const uploadCos = accelerate === 'true' ? (uploadClient ?? officialClient(true)) : cos;
  const base = { Bucket: config.bucket, Region: config.region };
  const missing = (error: any) =>
    error?.statusCode === 404 &&
    ['NoSuchKey', 'NotFound', 'NoSuchObject', '404', undefined].includes(
      error?.error?.Code ?? error?.code,
    );
  async function head(key: string) {
    try {
      const r = await cos.headObject({ ...base, Key: key });
      const bytes = Number(r.headers?.['content-length']);
      need(Number.isSafeInteger(bytes) && bytes >= 0, 'COS_HEADERS');
      return { bytes };
    } catch (error) {
      if (missing(error)) return undefined;
      if (error instanceof CosPublishError) throw error;
      throw new CosPublishError('COS_HEAD', error);
    }
  }
  return {
    async versioning() {
      try {
        const r = await cos.getBucketVersioning(base);
        return r.VersioningConfiguration?.Status || r.Status || undefined;
      } catch (error) {
        throw new CosPublishError('COS_BUCKET', error);
      }
    },
    head,
    async catalog(key) {
      const info = await head(key);
      if (!info) return undefined;
      need(info.bytes <= LIMIT, 'REMOTE_CATALOG_SIZE');
      try {
        const r = await cos.getObject({ ...base, Key: key, Range: `bytes=0-${LIMIT}` });
        const body = Buffer.isBuffer(r.Body) ? r.Body : Buffer.from(r.Body);
        need(body.length <= LIMIT && body.length === info.bytes, 'REMOTE_CATALOG_SIZE');
        return body;
      } catch (error) {
        if (error instanceof CosPublishError) throw error;
        throw new CosPublishError('COS_READ', error);
      }
    },
    async put(input) {
      if (input.immutable && input.file && input.bytes >= COS_MULTIPART_THRESHOLD) {
        await uploadCosMultipart({
          client: uploadCos,
          base,
          input: { ...input, file: input.file },
          head,
          retryable: retryableUpload,
          wait: dependencies?.wait,
        });
        return;
      }
      for (let attempt = 1; attempt <= 3; attempt++) {
        const body = input.body || createReadStream(input.file!);
        // An SDK failure can occur before it attaches a stream listener. File
        // open/close errors arriving after that failure must not escape as an
        // uncaught exception; the SDK still receives its own stream events.
        if (!Buffer.isBuffer(body)) body.on('error', () => {});
        let failure: unknown;
        try {
          await uploadCos.putObject({
            ...base,
            Key: input.key,
            Body: body,
            ContentLength: input.bytes,
            ContentMD5: input.md5,
            CacheControl: input.immutable
              ? 'public, max-age=31536000, immutable'
              : 'no-cache, max-age=0, must-revalidate',
            ContentType: input.key.endsWith('.json')
              ? 'application/json; charset=utf-8'
              : 'application/octet-stream',
            Headers: {
              'x-cos-meta-sha256': input.sha256,
              ...(input.immutable ? { 'x-cos-forbid-overwrite': 'true' } : {}),
            },
            ...(input.onProgress ? { onProgress: input.onProgress } : {}),
          });
          return;
        } catch (error) {
          failure = error;
        } finally {
          if (!Buffer.isBuffer(body)) body.destroy();
        }
        const transient = retryableUpload(failure);
        // Mutable catalog writes retain their existing read-after-error commit
        // handling. Never blindly replay a catalog or change a version object.
        if (!input.immutable || (!transient && !objectAlreadyPresent(failure)))
          throw new CosPublishError('COS_WRITE', failure);
        // The server may have committed the full object but lost its reply.
        // Size alone never advertises it: publishCosMirror still requires the
        // original signed SHA through an anonymous full HTTPS readback.
        const existing = await head(input.key);
        if (existing) {
          need(existing.bytes === input.bytes, 'EXISTING_OBJECT_CHANGED');
          return;
        }
        if (!transient || attempt === 3) throw new CosPublishError('COS_WRITE', failure);
        await (dependencies?.wait || wait)(attempt * 3000);
        input.onRetry?.(attempt + 1);
      }
    },
  };
}
