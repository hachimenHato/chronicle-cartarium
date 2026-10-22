import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { updateRuntimeCommand } from '../server/update-runtime';

test('Unix updates run the signed bundled npm CLI with the fixed Node even without system npm', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chronicle update runtime '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'runtime/node_modules/npm/bin');
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, 'npm-cli.js'),
    'console.log(JSON.stringify(process.argv.slice(2)))',
  );
  for (const platform of ['linux', 'darwin']) {
    const command = await updateRuntimeCommand(root, platform, process.execPath);
    const { stdout } = await promisify(execFile)(command.executable, command.args, {
      cwd: root,
      env: { PATH: '', npm_execpath: path.join(root, 'missing-ambient-npm.js'), NODE_OPTIONS: '' },
      windowsHide: true,
    });
    assert.deepEqual(JSON.parse(stdout), ['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    assert.equal(command.executable, process.execPath);
  }
});

test('updates require the packaged npm CLI; Windows selects the verified package Node rather than PATH', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chronicle-update-runtime-missing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(updateRuntimeCommand(root, 'linux', process.execPath), { code: 'ENOENT' });
  await mkdir(path.join(root, 'runtime/node_modules/npm/bin'), { recursive: true });
  await writeFile(path.join(root, 'runtime/node_modules/npm/bin/npm-cli.js'), 'fixture');
  await assert.rejects(updateRuntimeCommand(root, 'win32', process.execPath), { code: 'ENOENT' });
  await writeFile(path.join(root, 'runtime/node.exe'), 'fixture');
  assert.equal(
    (await updateRuntimeCommand(root, 'win32')).executable,
    path.join(root, 'runtime/node.exe'),
  );
});
