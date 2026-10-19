/** Runs only inside the selected application container; no credentials leave the container. */
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { recoverBackup } from '../server/backup-recovery';
const [action, backupId] = process.argv.slice(2);
const data = path.resolve(process.env.DATA_DIR || '/app/data');
const root = path.join(data, '.worldloom');
async function internal(action: string) {
  const token = await readFile(path.join(root, 'runner.key'), 'utf8');
  const response = await fetch(
    `http://127.0.0.1:${process.env.PORT || '3001'}/_worldloom/update/${action}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(action === 'backup' ? 600000 : 10000),
    },
  );
  if (!response.ok) throw new Error('Protected maintenance step failed.');
  return response.json();
}
try {
  if (action === 'backup') {
    const backup = await internal('backup');
    await writeFile(
      path.join(root, 'update-state.json'),
      JSON.stringify({
        mode: 'docker',
        phase: 'backup',
        message: '完整备份已验证，等待宿主机完成镜像更新。',
        backupId: backup.id,
      }),
      { mode: 0o600 },
    );
    console.log(JSON.stringify(backup));
  } else if (action === 'release') console.log(JSON.stringify(await internal('release')));
  else if (action === 'check') {
    if (!/^full-[0-9]+-[a-f0-9-]{36}$/.test(backupId)) throw new Error('Invalid backup ID.');
    const token = await readFile(path.join(root, 'runner.key'), 'utf8');
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'scripts/update-worker.ts', 'check', process.cwd(), '', data, backupId],
      {
        env: { ...process.env, WORLDLOOM_UPDATER_TOKEN: token },
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolve() : reject(new Error('Data verification failed.')),
      );
    });
    console.log(JSON.stringify({ verified: true }));
  } else if (action === 'recover') {
    if (!process.env.BACKUP_DIRECTORY) throw new Error('An external verified backup is required.');
    const target = path.join(root, 'recoveries', 'data-' + randomUUID());
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const result = await recoverBackup(
      path.resolve(process.env.BACKUP_DIRECTORY),
      target,
      'worldloom_recovery_' + Date.now() + '_' + randomUUID().slice(0, 8),
    );
    console.log(JSON.stringify(result));
  } else if (action === 'complete') {
    await writeFile(
      path.join(root, 'update-state.json'),
      JSON.stringify({
        mode: 'docker',
        phase: 'complete',
        message: '镜像更新成功，完整资料验证通过。请使用原账号重新登录。',
      }),
      { mode: 0o600 },
    );
    console.log(JSON.stringify(await internal('release')));
  } else throw new Error('Unknown maintenance action.');
} catch (error) {
  console.error(`容器更新步骤失败（${(error as Error).name}），未输出私有配置。`);
  process.exitCode = 1;
}
