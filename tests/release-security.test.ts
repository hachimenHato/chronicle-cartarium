import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const guard = (await import(new URL('../scripts/release-security.mjs', import.meta.url).href)) as {
  isPrivateReleasePath: (relative: string) => boolean;
  shouldIncludeReleasePath: (relative: string) => boolean;
  createReleaseCopyFilter: (root: string) => (filename: string) => boolean;
  assertPublicReleaseTree: (
    root: string,
    options?: { entries: string[] },
  ) => Promise<{ files: number; excluded: number }>;
};

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chronicle-release-security-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('chronicle-release-security-'));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

const privatePaths = [
  'scripts/.env.cos',
  'docs/examples/.ENV.PRODUCTION',
  'server/.npmrc',
  'docs/.cos.yaml',
  'scripts/.cos.config.json',
  'server/cos.config.json',
  'public/cos-credentials.json',
  'scripts/tencent-cos-secrets.json',
  'desktop/cos.conf',
  'docs/users.json',
  'src/installation.json',
  'shared/runner.key',
  'docs/private.pem',
  'server/credentials.json',
  'shared/secrets.yaml',
  'public/backup.ccbackup',
  'public/workspace.sqlite-wal',
];

test('release path rules refuse nested credential files and local state while allowing public samples', () => {
  for (const filename of privatePaths) {
    assert(guard.isPrivateReleasePath(filename), filename);
    assert(!guard.shouldIncludeReleasePath(filename), filename);
    assert(!guard.shouldIncludeReleasePath(filename.replaceAll('/', '\\')), filename);
  }
  for (const filename of [
    '.env.example',
    'docs/examples/.env.example',
    'docs/cos-upload-policy.example.json',
    'docs/examples/cos-policy.json',
    'shared/release-trust.json',
    'scripts/release-security.mjs',
  ])
    assert(guard.shouldIncludeReleasePath(filename), filename);
  for (const filename of [
    'node_modules/example/index.js',
    '.runtime/evidence.txt',
    'desktop/.desktop/state.json',
    'nested/workspace/source.ts',
    'data/world.json',
    'nested/uploads/example.png',
    'tools/cos-publisher/package.json',
    'scripts/.tccli/configure',
    '../outside/file.json',
    '/outside/file.json',
    'C:\\private\\file.json',
  ])
    assert(!guard.shouldIncludeReleasePath(filename), filename);
});

test('public-tree assertion rejects each nested secret by name without reading its contents', async (t) => {
  const root = await fixture(t);
  for (let index = 0; index < privatePaths.length; index += 1) {
    const tree = path.join(root, String(index));
    const filename = path.join(tree, privatePaths[index]);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, Buffer.from([0xff, 0x00, 0xfe]));
    await assert.rejects(guard.assertPublicReleaseTree(tree), /禁止公开/);
  }
});

test('packaging skips installed dependencies and maintainer tools but copies the public source and policy example', async (t) => {
  const root = await fixture(t);
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  for (const filename of [
    'server/index.ts',
    '.env.example',
    'docs/cos-upload-policy.example.json',
    'node_modules/example/.env.cos',
    '.runtime/private.pem',
    'desktop/.desktop/users.json',
    'data/installation.json',
    'uploads/private.png',
    'tools/cos-publisher/node_modules/example/index.js',
    'tools/cos-publisher/.env.cos',
  ]) {
    await mkdir(path.dirname(path.join(source, filename)), { recursive: true });
    await writeFile(path.join(source, filename), filename);
  }
  const result = await guard.assertPublicReleaseTree(source);
  assert.equal(result.files, 3);
  assert(result.excluded >= 6);
  await cp(source, destination, {
    recursive: true,
    filter: guard.createReleaseCopyFilter(source),
  });
  assert.deepEqual((await readdir(destination)).sort(), [
    '.env.example',
    'desktop',
    'docs',
    'server',
  ]);
  assert.deepEqual(await readdir(path.join(destination, 'desktop')), []);
  assert.equal(
    await readFile(path.join(destination, 'docs/cos-upload-policy.example.json'), 'utf8'),
    'docs/cos-upload-policy.example.json',
  );
  assert.equal((await guard.assertPublicReleaseTree(destination)).files, 3);
});

test('allow-list inspection does not inspect private installation files outside the selected trees', async (t) => {
  const root = await fixture(t);
  for (const filename of ['.env', 'data/users.json', 'server/index.ts', 'docs/.env.example']) {
    await mkdir(path.dirname(path.join(root, filename)), { recursive: true });
    await writeFile(path.join(root, filename), 'isolated fixture only');
  }
  assert.equal(
    (await guard.assertPublicReleaseTree(root, { entries: ['server', 'docs'] })).files,
    2,
  );
  await assert.rejects(guard.assertPublicReleaseTree(root), /禁止公开/);
  await assert.rejects(
    guard.assertPublicReleaseTree(root, { entries: ['../outside'] }),
    /无效路径/,
  );
});

test('public-tree assertion refuses links in published paths instead of following them', async (t) => {
  const root = await fixture(t);
  const source = path.join(root, 'source');
  const outside = path.join(root, 'outside');
  await mkdir(source);
  await mkdir(outside);
  await writeFile(path.join(outside, 'file.txt'), 'outside fixture');
  try {
    await symlink(
      outside,
      path.join(source, 'linked'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code || '')) {
      t.skip('This host does not allow test directory links.');
      return;
    }
    throw error;
  }
  await assert.rejects(guard.assertPublicReleaseTree(source), /链接/);
});

test('Git ignore rules protect nested COS credentials without hiding public policies or the SDK manifest', async (t) => {
  const gitVersion = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true });
  if ((gitVersion.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    t.skip('Git is unavailable on this test host.');
    return;
  }
  assert.equal(gitVersion.status, 0, gitVersion.stderr);
  const root = await fixture(t);
  await cp(path.resolve('.gitignore'), path.join(root, '.gitignore'));
  const initialize = spawnSync('git', ['init', '--quiet', root], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(initialize.status, 0, initialize.stderr);
  const ignored = spawnSync(
    'git',
    ['-c', 'core.ignoreCase=false', 'check-ignore', '--no-index', '--stdin'],
    {
      cwd: root,
      input: [
        ...privatePaths,
        '.env',
        '.runtime/evidence.txt',
        'tools/cos-publisher/.env.cos',
      ].join('\n'),
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  assert.equal(ignored.status, 0, ignored.stderr);
  const names = new Set(ignored.stdout.trim().split(/\r?\n/));
  for (const filename of privatePaths) assert(names.has(filename), filename);
  const publicFiles = [
    '.env.example',
    'docs/examples/.env.example',
    'docs/cos-upload-policy.example.json',
    'tools/cos-publisher/package.json',
    'tools/cos-publisher/package-lock.json',
  ];
  const visible = spawnSync(
    'git',
    ['-c', 'core.ignoreCase=false', 'check-ignore', '--no-index', '--stdin'],
    {
      cwd: root,
      input: publicFiles.join('\n'),
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  assert.equal(visible.status, 1, visible.stderr);
  assert.equal(visible.stdout, '');
});
