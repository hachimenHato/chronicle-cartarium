import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const script = path.resolve('scripts/create-update-mirror.mjs');
const repository = 'https://github.com/hachimenHato/chronicle-cartarium';
const name = 'chronicle-cartarium-0.2.0-beta.19-win-x64.ccupdate';
const content = Buffer.from(
  'isolated fixture: downloader still verifies the official Ed25519 signature',
);

function release() {
  return {
    tag_name: 'v0.2.0-beta.19',
    name: '镜像测试版',
    body: '仅用于临时测试。',
    html_url: `${repository}/releases/tag/v0.2.0-beta.19`,
    draft: false,
    prerelease: true,
    published_at: '2026-10-22T00:00:00Z',
    author: { login: 'field-must-be-stripped' },
    assets: [
      {
        name,
        size: content.length,
        state: 'uploaded',
        digest: `sha256:${createHash('sha256').update(content).digest('hex')}`,
        browser_download_url: `${repository}/releases/download/v0.2.0-beta.19/${name}`,
        uploader: { login: 'field-must-be-stripped' },
      },
    ],
  };
}

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chronicle-update-mirror-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packages = path.join(root, 'packages');
  const catalog = path.join(root, 'catalog.json');
  const output = path.join(root, 'output');
  await mkdir(packages);
  await writeFile(path.join(packages, name), content);
  await writeFile(path.join(packages, '.env'), 'PRIVATE_FIXTURE_MUST_NOT_BE_COPIED');
  await writeFile(catalog, JSON.stringify([release()]));
  const run = (args: string[] = []) =>
    spawnSync(
      process.execPath,
      [script, '--catalog', catalog, '--packages', packages, '--output', output, ...args],
      { encoding: 'utf8' },
    );
  return { root, packages, catalog, output, run };
}

test('mirror builder copies only original matching packages, strips nonpublic fields, and refuses existing output', async (t) => {
  const f = await fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await readdir(f.output)).sort(), ['releases.json', 'v0.2.0-beta.19']);
  assert.deepEqual(await readFile(path.join(f.output, 'v0.2.0-beta.19', name)), content);
  const sanitized = JSON.parse(await readFile(path.join(f.output, 'releases.json'), 'utf8'));
  assert.equal(sanitized[0].author, undefined);
  assert.equal(sanitized[0].assets[0].uploader, undefined);
  assert.equal(
    sanitized[0].assets[0].browser_download_url,
    release().assets[0].browser_download_url,
  );
  assert.notEqual(f.run().status, 0);
  assert.deepEqual(await readFile(path.join(f.output, 'v0.2.0-beta.19', name)), content);
  assert.deepEqual(await readdir(path.join(f.output, 'v0.2.0-beta.19')), [name]);
});

test('mirror builder refuses tampering, duplicate assets or releases, unsafe URLs and paths before creating output', async (t) => {
  const f = await fixture(t);
  const cases = [
    (value: ReturnType<typeof release>) => {
      value.assets[0].digest = `sha256:${'0'.repeat(64)}`;
    },
    (value: ReturnType<typeof release>) => {
      value.assets[0].size += 1;
    },
    (value: ReturnType<typeof release>) => {
      value.assets.push({ ...value.assets[0] });
    },
    (value: ReturnType<typeof release>) => {
      value.assets[0].browser_download_url += '?token=private';
    },
    (value: ReturnType<typeof release>) => {
      value.assets[0].browser_download_url = 'https://evil.example/update.ccupdate';
    },
    (value: ReturnType<typeof release>) => {
      value.assets[0].name = '../private.ccupdate';
    },
    (value: ReturnType<typeof release>) => {
      value.prerelease = false;
    },
  ];
  for (const change of cases) {
    const value = release();
    change(value);
    await writeFile(f.catalog, JSON.stringify([value]));
    assert.notEqual(f.run().status, 0);
    await assert.rejects(access(f.output));
  }
  await writeFile(f.catalog, JSON.stringify([release(), release()]));
  assert.notEqual(f.run().status, 0);
  await assert.rejects(access(f.output));
  assert.notEqual(f.run(['--output', f.output]).status, 0, 'duplicate CLI options must fail');
});

test('mirror builder does not invent packages for unsupported platforms and refuses output nested in inputs', async (t) => {
  const f = await fixture(t);
  const value = release();
  value.assets = [];
  await writeFile(f.catalog, JSON.stringify([value]));
  assert.notEqual(f.run().status, 0);
  await assert.rejects(access(f.output));
  await writeFile(f.catalog, JSON.stringify([release()]));
  const result = spawnSync(
    process.execPath,
    [
      script,
      '--catalog',
      f.catalog,
      '--packages',
      f.packages,
      '--output',
      path.join(f.packages, 'nested'),
    ],
    { encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  await assert.rejects(access(path.join(f.packages, 'nested')));
});
