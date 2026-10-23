import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseCosArguments, prepareCosMirror } from '../scripts/publish-cos-mirror';

const repository = 'https://github.com/hachimenHato/chronicle-cartarium';
const tag = 'v0.2.0-beta.19';
const assetName = 'chronicle-cartarium-0.2.0-beta.19-win-x64.ccupdate';
const bytes = Buffer.from(
  'public artifact fixture; production publisher additionally verifies Ed25519',
);
const sha256 = createHash('sha256').update(bytes).digest('hex');

function release() {
  return {
    tag_name: tag,
    name: '临时公开测试',
    body: '公开说明',
    html_url: `${repository}/releases/tag/${tag}`,
    draft: false,
    prerelease: true,
    published_at: '2026-10-23T01:00:00Z',
    author: { login: 'unneeded-catalog-field' },
    assets: [
      {
        name: assetName,
        size: bytes.length,
        digest: `sha256:${sha256}`,
        state: 'uploaded',
        browser_download_url: `${repository}/releases/download/${tag}/${assetName}`,
        uploader: { login: 'unneeded-catalog-field' },
      },
    ],
  };
}

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'chronicle-cos-cli-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  return { temporary, output: path.join(temporary, 'prepared') };
}

test('COS CLI accepts only fixed actions and canonical tags, never arbitrary URLs or credential arguments', () => {
  assert.deepEqual(parseCosArguments(['prepare', '--tag', tag, '--output', 'new-path']), {
    action: 'prepare',
    tag,
    output: 'new-path',
  });
  assert.deepEqual(parseCosArguments(['publish', '--directory', 'existing-mirror']), {
    action: 'publish',
    directory: 'existing-mirror',
  });
  for (const args of [
    [],
    ['delete', '--directory', 'any'],
    ['publish', '--directory', 'any', '--secret-key', 'private'],
    ['prepare', '--tag', '../../elsewhere', '--output', 'new'],
    ['prepare', '--tag', 'https://private.example', '--output', 'new'],
    ['prepare', '--tag', tag, '--output', 'new', '--tag', tag],
    ['prepare', '--tag', tag, '--output', '--directory'],
    ['prepare', '--tag', tag, '--output', 'line\nbreak'],
    ['prepare', '--tag', tag, '--output', 'new', '--source', 'https://private.example'],
  ])
    assert.throws(() => parseCosArguments(args));
});

test('COS preparation downloads only official canonical updates, strips catalog fields and refuses overwrite', async (t) => {
  const f = await fixture(t);
  const value = release();
  // Ordinary installation downloads and irrelevant fields must never enter the mirror.
  value.assets.push({
    ...value.assets[0],
    name: 'normal-installer.zip',
    browser_download_url: 'https://ignored.example/file.zip',
  });
  const requests: string[] = [];
  let downloads = 0;
  const dependencies = {
    readJson: async (url: string) => {
      requests.push(url);
      return value;
    },
    download: async (url: string, file: string, expected: { bytes: number; sha256: string }) => {
      assert.equal(url, `${repository}/releases/download/${tag}/${assetName}`);
      assert.deepEqual(expected, { bytes: bytes.length, sha256 });
      downloads++;
      await writeFile(file, bytes, { flag: 'wx' });
    },
  };
  const result = await prepareCosMirror({ tag, output: f.output }, dependencies);
  assert.deepEqual(requests, [
    `https://api.github.com/repos/hachimenHato/chronicle-cartarium/releases/tags/${tag}`,
  ]);
  assert.equal(downloads, 1);
  assert.equal(result.directory, await realpath(path.join(f.output, 'mirror')));
  assert.equal(result.packages, 1);
  const catalog = JSON.parse(await readFile(path.join(result.directory, 'releases.json'), 'utf8'));
  assert.equal(catalog[0].author, undefined);
  assert.equal(catalog[0].assets.length, 1);
  assert.equal(catalog[0].assets[0].uploader, undefined);
  assert.deepEqual(await readFile(path.join(result.directory, tag, assetName)), bytes);
  await assert.rejects(prepareCosMirror({ tag, output: f.output }, dependencies));
  assert.equal(
    downloads,
    1,
    'existing preparation must not trigger downloads or overwrite artifacts',
  );
});

test('COS preparation rejects draft, wrong origin, unsupported platform and metadata confusion before writing', async (t) => {
  const f = await fixture(t);
  const cases = [
    (r: ReturnType<typeof release>) => {
      r.draft = true;
    },
    (r: ReturnType<typeof release>) => {
      r.tag_name = 'v0.2.0-beta.18';
    },
    (r: ReturnType<typeof release>) => {
      r.html_url = 'https://another.example/release';
    },
    (r: ReturnType<typeof release>) => {
      r.assets[0].browser_download_url += '?SecretId=do-not-send';
    },
    (r: ReturnType<typeof release>) => {
      r.assets[0].name = '../private.ccupdate';
    },
    (r: ReturnType<typeof release>) => {
      r.assets[0].digest = 'sha256:bad';
    },
    (r: ReturnType<typeof release>) => {
      r.assets.push({ ...r.assets[0] });
    },
    (r: ReturnType<typeof release>) => {
      r.assets[0].name = r.assets[0].name.replace('win-x64', 'win-arm64');
      r.assets[0].browser_download_url = `${repository}/releases/download/${tag}/${r.assets[0].name}`;
    },
  ];
  for (const change of cases) {
    const value = release();
    change(value);
    await assert.rejects(
      prepareCosMirror(
        { tag, output: f.output },
        {
          readJson: async () => value,
          download: async () => {
            assert.fail('invalid catalog must not reach downloader');
          },
        },
      ),
    );
    await assert.rejects(access(f.output));
  }
});

test('COS preparation rechecks downloaded bytes before creating a publishable mirror', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    prepareCosMirror(
      { tag, output: f.output },
      {
        readJson: async () => release(),
        download: async (_url, file) => {
          await writeFile(file, Buffer.alloc(bytes.length, 0));
        },
      },
    ),
  );
  await assert.rejects(access(path.join(f.output, 'mirror')));
  assert.deepEqual((await readdir(f.output)).sort(), ['catalog.json', 'packages']);
});

test('COS CLI failure output never echoes arguments, credentials, raw errors or stack traces', () => {
  const secretFixture = 'NEVER_PRINT_FAKE_COS_CREDENTIAL';
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'scripts/publish-cos-mirror.ts',
      'publish',
      '--directory',
      secretFixture,
      '--secret-key',
      secretFixture,
    ],
    {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        TENCENT_COS_SECRET_KEY: secretFixture,
        TENCENT_COS_SECRET_ID: secretFixture,
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /COS_ARGUMENTS/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(secretFixture));
  assert.doesNotMatch(result.stderr, /\bat\s+.*\.(ts|js):\d/);
});
