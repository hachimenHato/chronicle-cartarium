import path from 'node:path';
import { readFile, writeFile, rename, mkdir, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { verifyRelease } from '../server/release-package';
import { recoverBackup } from '../server/backup-recovery';
import { digest, fileDigest } from '../server/full-backup';
import type { ProgramUpdateStatus } from '../shared/update';
import { updateRuntimeCommand } from '../server/update-runtime';

const [action, installRoot, packageId, sourceData, backupId] = process.argv.slice(2);
if (!installRoot || !path.isAbsolute(installRoot))
  throw new Error('A fixed installation root is required.');
const root = path.join(installRoot, '.worldloom');
async function state(phase: ProgramUpdateStatus['phase'], message: string, version?: string) {
  const temporary = path.join(root, randomUUID() + '.tmp');
  await writeFile(
    temporary,
    JSON.stringify({
      mode: 'managed',
      phase,
      message,
      ...(packageId ? { packageId } : {}),
      ...(version ? { version } : {}),
    }),
    { flag: 'wx', mode: 0o600 },
  );
  await rename(temporary, path.join(root, 'update-state.json'));
}
async function currentVersion() {
  return JSON.parse(await readFile(path.resolve('package.json'), 'utf8')).version as string;
}
try {
  if (action === 'prepare') {
    if (!/^package-[A-Za-z0-9]+$/.test(packageId)) throw new Error('Invalid prepared package.');
    const program = path.join(root, 'staged', packageId, 'program');
    const manifest = await verifyRelease(program, await currentVersion());
    await state('preparing', '正在准备新版运行组件；原工作台继续运行…', manifest.version);
    const { executable, args } = await updateRuntimeCommand(program);
    const env = { ...process.env };
    for (const name of [
      'DATABASE_URL',
      'APP_PASSWORD',
      'SESSION_SECRET',
      'SETUP_TOKEN',
      'DATA_DIR',
      'ENV_FILE',
      'WORLDLOOM_UPDATER_TOKEN',
      'CHRONICLE_CARTARIUM_UPDATER_TOKEN',
      'CHRONICLE_CARTARIUM_INSTALL_ROOT',
      'DOTENV_CONFIG_PATH',
    ])
      delete env[name];
    const child = spawn(executable, args, {
      cwd: program,
      env,
      windowsHide: true,
      stdio: 'ignore',
    });
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Dependency preparation failed.')),
      );
    });
    await verifyRelease(
      program,
      await currentVersion(),
      undefined,
      process.platform,
      process.arch,
      true,
    );
    // The launcher owns the move and restart; this worker never stops arbitrary processes.
    await state('backup', '新版已准备，正在自动备份并验证恢复…', manifest.version);
  } else if (action === 'check') {
    if (!sourceData || !/^full-[0-9]+-[a-f0-9-]{36}$/.test(backupId))
      throw new Error('A validated backup is required.');
    const backup = path.join(sourceData, 'backups', backupId);
    const m = JSON.parse(await readFile(path.join(backup, 'manifest.json'), 'utf8'));
    const token =
      process.env.CHRONICLE_CARTARIUM_UPDATER_TOKEN || process.env.WORLDLOOM_UPDATER_TOKEN;
    const response = await fetch(
      `http://127.0.0.1:${process.env.PORT || '3001'}/_worldloom/update/health`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new Error('Protected health check failed.');
    const health = await response.json();
    if (
      health.digest !== m.workspaceDigest ||
      health.revision !== m.revision ||
      health.installation !==
        digest(JSON.parse(await readFile(path.join(backup, 'data/installation.json'), 'utf8'))) ||
      health.users !==
        digest(JSON.parse(await readFile(path.join(backup, 'data/users.json'), 'utf8')))
    )
      throw new Error('Data or account verification failed.');
    for (const entry of m.entries.filter(
      (item: { path: string }) =>
        item.path.startsWith('data/') &&
        !['data/installation.json', 'data/users.json'].includes(item.path),
    )) {
      const filename = path.join(process.env.DATA_DIR!, entry.path.slice(5));
      if (
        (await lstat(filename)).size !== entry.bytes ||
        (await fileDigest(filename)) !== entry.sha256
      )
        throw new Error('Resource verification failed.');
    }
  } else if (action === 'recover') {
    if (!sourceData || !/^full-[0-9]+-[a-f0-9-]{36}$/.test(backupId))
      throw new Error('A matching recovery backup is required.');
    const target = path.join(root, 'recoveries', 'data-' + randomUUID());
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const backup = path.join(sourceData, 'backups', backupId);
    const name =
      'worldloom_recovery_' + Date.now() + '_' + randomUUID().slice(0, 8).replace(/-/g, '');
    await recoverBackup(backup, target, name);
    await writeFile(path.join(root, 'recovered-target.json'), JSON.stringify({ dataDir: target }), {
      mode: 0o600,
    });
  } else throw new Error('Unknown update action.');
} catch (error) {
  if (action === 'prepare')
    await state(
      'error',
      '新版运行组件未准备成功，原程序和数据保留。请检查网络、空间和文件权限后重新导入。',
    );
  console.error(`更新步骤失败（${(error as Error).name}），私有诊断未输出。`);
  process.exitCode = 1;
}
