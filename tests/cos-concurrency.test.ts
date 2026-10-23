import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  CosPublishError,
  loadCosConfig,
  publishCosMirror,
  type CosStore,
  type MirrorFile,
} from '../scripts/lib/cos-publisher';
import type { PublicMirrorRelease } from '../scripts/create-update-mirror.mjs';
import type { CosProgressEvent } from '../scripts/lib/cos-progress';

const config = loadCosConfig({
  COS_BUCKET: 'concurrency-fixture-1250000000',
  COS_REGION: 'ap-shanghai',
  COS_PREFIX: 'chronicle-cartarium/updates',
  COS_PUBLIC_BASE_URL: 'https://not-contacted.example/chronicle-cartarium/updates',
});
const catalogKey = `${config.prefix}/releases.json`;
const repository = 'https://github.com/hachimenHato/chronicle-cartarium';
const version = '0.2.0-beta.19';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function tick() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}
function hash(body: Buffer) {
  return {
    bytes: body.length,
    sha256: createHash('sha256').update(body).digest('hex'),
    md5: createHash('md5').update(body).digest('base64'),
  };
}

// The injected plan contains synthetic public bytes. This tests publication
// scheduling only; no real archive, credentials, SDK, cloud, or disk is used.
function fixture() {
  const suffixes = [
    'darwin-arm64.ccupdate',
    'darwin-x64.ccupdate',
    'linux-arm64.ccupdate',
    'linux-x64.ccupdate',
    'win-x64.ccupdate',
    'windows-desktop-x64.update.json',
    'windows-desktop-x64.zip',
  ];
  const contents = suffixes.map((_, i) => Buffer.from(`public synthetic file ${i}`));
  const files: MirrorFile[] = suffixes.map((suffix, i) => {
    const relative = `v${version}/chronicle-cartarium-${version}-${suffix}`;
    return { relative, filename: path.resolve('not-read-fixture', relative), ...hash(contents[i]) };
  });
  const release: PublicMirrorRelease = {
    tag_name: `v${version}`,
    name: 'Synthetic concurrency fixture',
    body: 'No real release payloads are installed or uploaded by this test.',
    html_url: `${repository}/releases/tag/v${version}`,
    draft: false,
    prerelease: true,
    published_at: '2026-10-23T00:00:00Z',
    assets: files.map((file) => ({
      name: path.basename(file.filename),
      size: file.bytes,
      digest: `sha256:${file.sha256}`,
      browser_download_url: `${repository}/releases/download/${file.relative}`,
      state: 'uploaded',
    })),
  };
  const objects = new Map<string, Buffer>();
  const starts: number[] = [];
  const verified = new Set<number>();
  const active = new Set<number>();
  const events: string[] = [];
  const progress: CosProgressEvent[] = [];
  const hooks: Partial<Record<'head' | 'put' | 'verify', (index: number) => Promise<void>>> = {};
  let maxActive = 0,
    catalogReads = 0,
    catalogWrites = 0,
    catalogPublicReads = 0,
    planCalls = 0;
  const oldCatalog = Buffer.from(
    JSON.stringify([
      {
        ...release,
        tag_name: 'v0.2.0-beta.18',
        html_url: `${repository}/releases/tag/v0.2.0-beta.18`,
        assets: [],
      },
    ]) + '\n',
  );
  objects.set(catalogKey, oldCatalog);
  const indexOf = (key: string) => {
    const index = files.findIndex((file) => `${config.prefix}/${file.relative}` === key);
    assert(index >= 0, 'only planned public objects may be accessed');
    return index;
  };
  const store: CosStore = {
    async versioning() {
      return undefined;
    },
    async head(key) {
      const index = indexOf(key);
      starts.push(index);
      active.add(index);
      maxActive = Math.max(maxActive, active.size);
      events.push(`head:${index}`);
      await hooks.head?.(index);
      const body = objects.get(key);
      return body ? { bytes: body.length } : undefined;
    },
    async catalog(key) {
      assert.equal(key, catalogKey);
      catalogReads++;
      events.push('catalog-read');
      const value = objects.get(key);
      return value ? Buffer.from(value) : undefined;
    },
    async put(input) {
      if (input.key === catalogKey) {
        assert.equal(active.size, 0, 'catalog commit must wait for every anonymous file readback');
        assert.equal(verified.size, files.length);
        assert.equal(input.immutable, false);
        assert(input.body);
        catalogWrites++;
        events.push('catalog-write');
        objects.set(input.key, Buffer.from(input.body));
      } else {
        const index = indexOf(input.key);
        assert.equal(input.file, files[index].filename);
        assert.equal(input.immutable, true);
        assert(!objects.has(input.key), 'version files must not be overwritten');
        events.push(`put:${index}`);
        await hooks.put?.(index);
        objects.set(input.key, contents[index]);
        input.onProgress?.({ loaded: files[index].bytes });
      }
    },
  };
  const verifyPublic = async (file: MirrorFile, url: string) => {
    assert.equal(url, `${config.publicBaseUrl}/${file.relative}`);
    const bytes = objects.get(`${config.prefix}/${file.relative}`);
    assert(bytes, 'public verification must read an uploaded object');
    assert.deepEqual(hash(bytes), { bytes: file.bytes, sha256: file.sha256, md5: file.md5 });
    if (file.relative === 'releases.json') {
      assert.equal(catalogWrites, 1);
      assert.equal(verified.size, files.length);
      catalogPublicReads++;
      events.push('catalog-public');
      return;
    }
    const index = indexOf(`${config.prefix}/${file.relative}`);
    events.push(`readback:${index}`);
    await hooks.verify?.(index);
    active.delete(index);
    verified.add(index);
    events.push(`verified:${index}`);
  };
  const options = {
    directory: path.resolve('not-read-fixture'),
    config,
    store,
    verifyPublic,
    dependencies: {
      plan: async () => {
        planCalls++;
        return { files, releases: [release] };
      },
    },
    onProgress: (event: CosProgressEvent) => progress.push(event),
  };
  return {
    files,
    release,
    starts,
    verified,
    events,
    hooks,
    progress,
    objects,
    oldCatalog,
    options,
    stats: () => ({ maxActive, catalogReads, catalogWrites, catalogPublicReads, planCalls }),
  };
}

test(
  'COS publication bounds complete per-file work to the requested worker count',
  { timeout: 5000 },
  async () => {
    for (const concurrency of [1, 2, 3]) {
      const f = fixture();
      const gate = deferred();
      f.hooks.verify = () => gate.promise;
      const before = JSON.stringify({ files: f.files, release: f.release });
      const publishing = publishCosMirror({ ...f.options, concurrency });
      try {
        await tick();
        assert.deepEqual(
          f.starts,
          Array.from({ length: concurrency }, (_, i) => i),
        );
        assert.equal(f.stats().maxActive, concurrency);
        assert.equal(f.stats().catalogWrites, 0);
      } finally {
        gate.resolve();
      }
      const result = await publishing;
      assert.equal(result.packages, 7);
      assert.equal(f.stats().maxActive, concurrency);
      assert.equal(f.stats().catalogWrites, 1);
      assert.equal(f.stats().catalogPublicReads, 1);
      assert.equal(JSON.stringify({ files: f.files, release: f.release }), before);
      for (let index = 0; index < 7; index++) {
        const order = ['head', 'put', 'readback', 'verified'].map((phase) =>
          f.events.indexOf(`${phase}:${index}`),
        );
        assert(order.every((position, i) => i === 0 || position > order[i - 1]));
        const logged = f.progress.filter((event) => event.fileIndex === index + 1);
        assert(
          logged.every((event) => event.fileCount === 7 && event.bytes === f.files[index].bytes),
        );
      }
    }
  },
);

test('COS publication keeps its default serial behavior', { timeout: 5000 }, async () => {
  const f = fixture();
  const gate = deferred();
  f.hooks.verify = (index) => (index === 0 ? gate.promise : Promise.resolve());
  const publishing = publishCosMirror(f.options);
  try {
    await tick();
    assert.deepEqual(f.starts, [0]);
    assert.equal(f.stats().catalogReads, 1);
  } finally {
    gate.resolve();
  }
  await publishing;
  assert.equal(f.stats().maxActive, 1);
});

test(
  'COS publication never reads or commits the catalog while the last file readback is pending',
  { timeout: 5000 },
  async () => {
    const f = fixture();
    const gate = deferred();
    f.hooks.verify = (index) => (index === 6 ? gate.promise : Promise.resolve());
    const publishing = publishCosMirror({ ...f.options, concurrency: 3 });
    try {
      await tick();
      assert.equal(f.verified.size, 6);
      assert.equal(f.stats().catalogReads, 1);
      assert.equal(f.stats().catalogWrites, 0);
      assert.deepEqual(f.objects.get(catalogKey), f.oldCatalog);
    } finally {
      gate.resolve();
    }
    await publishing;
    assert.equal(f.stats().catalogReads, 3);
    assert(f.events.indexOf('catalog-write') > f.events.indexOf('verified:6'));
    assert(f.events.indexOf('catalog-public') > f.events.indexOf('catalog-write'));
  },
);

test(
  'COS publication stops new files on any failure, waits in-flight workers and preserves the first error and old catalog',
  { timeout: 5000 },
  async () => {
    for (const phase of ['head', 'put', 'verify'] as const) {
      const f = fixture();
      const gates = Array.from({ length: 3 }, deferred);
      const first = new Error(`synthetic first ${phase} failure`);
      const second = new Error(`synthetic later ${phase} failure`);
      f.hooks[phase] = async (index) => {
        assert(index < 3, 'failure must stop assigning later files');
        await gates[index].promise;
        if (index === 0) throw first;
        if (index === 1) throw second;
      };
      let settled = false,
        captured: unknown;
      const publishing = publishCosMirror({ ...f.options, concurrency: 3 }).then(
        () => {
          settled = true;
        },
        (error) => {
          settled = true;
          captured = error;
        },
      );
      try {
        await tick();
        assert.deepEqual(f.starts, [0, 1, 2]);
        gates[0].resolve();
        await tick();
        assert.equal(settled, false, 'a failed worker must wait for its in-flight peers');
        assert.deepEqual(f.starts, [0, 1, 2]);
        gates[1].resolve();
        await tick();
        assert.equal(settled, false, 'later failure must not abandon the remaining worker');
        assert.equal(f.stats().catalogReads, 1);
        assert.equal(f.stats().catalogWrites, 0);
      } finally {
        for (const gate of gates) gate.resolve();
      }
      await publishing;
      assert.equal(captured, first);
      assert.deepEqual(f.starts, [0, 1, 2]);
      assert(
        f.verified.has(2),
        'the last already-started worker must finish its public verification',
      );
      assert.equal(f.stats().catalogReads, 1);
      assert.equal(f.stats().catalogWrites, 0);
      assert.deepEqual(f.objects.get(catalogKey), f.oldCatalog);
      assert(
        !f.progress.some((event) => event.stage === 'commit-catalog' || event.stage === 'done'),
      );
    }
  },
);

test('COS publication rejects invalid concurrency before planning, cloud calls or progress logging', async () => {
  for (const concurrency of [0, -1, 4, 1.2, NaN, Infinity, '3', null]) {
    const f = fixture();
    await assert.rejects(
      publishCosMirror({ ...f.options, concurrency: concurrency as number }),
      (error) => {
        assert(error instanceof CosPublishError);
        assert.equal(error.code, 'COS_CONCURRENCY');
        return true;
      },
    );
    assert.equal(f.stats().planCalls, 0);
    assert.equal(f.stats().catalogReads, 0);
    assert.equal(f.progress.length, 0);
  }
});
