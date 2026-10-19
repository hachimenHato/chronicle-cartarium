import path from 'node:path';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
/** A dead process can be recovered; a live or unrecognised owner is never displaced. */
export async function acquireInstanceLock(directory: string) {
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'server.lock');
  const value = { pid: process.pid, token: randomUUID() };
  // All acquisitions share this marker, including empty-directory starts, so stale recovery
  // cannot rename a lock that a competing starter has just created.
  const recovery = filename + '.recovery';
  await writeFile(recovery, value.token, { flag: 'wx', mode: 0o600 });
  try {
    try {
      await writeFile(filename, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const saved = JSON.parse(await readFile(filename, 'utf8'));
      if (!Number.isInteger(saved.pid) || saved.pid <= 0 || alive(saved.pid))
        throw new Error('此数据目录已有运行进程，不能重复启动。');
      await rename(filename, filename + '.stale-' + randomUUID());
      await writeFile(filename, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    }
  } finally {
    await unlink(recovery).catch(() => undefined);
  }
  return async () => {
    const current = JSON.parse(await readFile(filename, 'utf8').catch(() => '{}'));
    if (current.pid === value.pid && current.token === value.token) await unlink(filename);
  };
}
