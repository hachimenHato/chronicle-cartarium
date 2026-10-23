import path from 'node:path';
import { createReadStream } from 'node:fs';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { createHash, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import { Parser } from 'tar';
import { pipeline } from 'node:stream/promises';
import { releaseManifestSchema, compareVersions } from '../../server/release-package';
import { releasePublicKeys } from '../../shared/release-trust';
import { validateUpdateUrl } from '../../server/update-download';
import type { PublicMirrorRelease } from '../create-update-mirror.mjs';
const require = createRequire(import.meta.url);
// The builder strips all fields except the fixed public GitHub release contract.
const { publicRelease } = await import('../create-update-mirror.mjs');
const { isPrivateReleasePath } = await import('../release-security.mjs');
const { digest, verifyDesktopManifest } = require('../../shared/desktop-update-security.cjs');
const LIMIT = 1024 ** 2;
export class CosPublishError extends Error {
  constructor(public readonly code: string) {
    super(`COS 镜像发布未完成（${code}）。请查看状态与操作指引，不要重置现有镜像或资料。`);
  }
}
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
}: {
  directory: string;
  config: CosConfig;
  store: CosStore;
  verifyPublic: (file: MirrorFile, url: string) => Promise<void>;
  dependencies?: { plan?: typeof planCosMirror };
}) {
  const plan = await (dependencies?.plan || planCosMirror)(directory);
  // This prefix is owned by one serialized workflow. A versioned bucket would ignore forbid-overwrite.
  need(!(await store.versioning()), 'BUCKET_VERSIONING');
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
  for (const file of plan.files) {
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
      });
    // Anonymous HTTPS readback verifies exact bytes, readability, DNS safety and SHA before advertising.
    await verifyPublic(file, config.publicBaseUrl + '/' + file.relative);
  }
  const now = await store.catalog(key);
  need(
    (now ? createHash('sha256').update(now).digest('hex') : undefined) === beforeHash,
    'CONCURRENT_PUBLISH',
  );
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
  return {
    packages: plan.files.length,
    releases: rows.length,
    publicBaseUrl: config.publicBaseUrl,
  };
}
export function createCosStore(config: CosConfig, env: NodeJS.ProcessEnv): CosStore {
  need(env.TENCENT_COS_SECRET_ID && env.TENCENT_COS_SECRET_KEY, 'CREDENTIALS');
  const COS = require('../../tools/cos-publisher/node_modules/cos-nodejs-sdk-v5');
  const cos = new COS({
    SecretId: env.TENCENT_COS_SECRET_ID,
    SecretKey: env.TENCENT_COS_SECRET_KEY,
    SecurityToken: env.TENCENT_COS_SESSION_TOKEN || undefined,
    Protocol: 'https:',
    Timeout: 600000,
    MaxRetryTimes: 2,
  });
  const base = { Bucket: config.bucket, Region: config.region };
  const missing = (error: any) =>
    error?.statusCode === 404 &&
    ['NoSuchKey', 'NotFound', 'NoSuchObject', undefined].includes(error?.code);
  async function head(key: string) {
    try {
      const r = await cos.headObject({ ...base, Key: key });
      const bytes = Number(r.headers?.['content-length']);
      need(Number.isSafeInteger(bytes) && bytes >= 0, 'COS_HEADERS');
      return { bytes };
    } catch (error) {
      if (missing(error)) return undefined;
      throw new CosPublishError('COS_HEAD');
    }
  }
  return {
    async versioning() {
      try {
        const r = await cos.getBucketVersioning(base);
        return r.VersioningConfiguration?.Status || r.Status || undefined;
      } catch {
        throw new CosPublishError('COS_BUCKET');
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
      } catch {
        throw new CosPublishError('COS_READ');
      }
    },
    async put(input) {
      try {
        await cos.putObject({
          ...base,
          Key: input.key,
          Body: input.body || createReadStream(input.file!),
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
        });
      } catch {
        throw new CosPublishError('COS_WRITE');
      }
    },
  };
}
