import path from 'node:path';
import { lstat } from 'node:fs/promises';

/** The caller has already verified the release, including its bundled npm CLI. */
export async function updateRuntimeCommand(
  program: string,
  platform: string = process.platform,
  currentExecutable: string = process.execPath,
) {
  const executable =
    platform === 'win32' ? path.join(program, 'runtime/node.exe') : currentExecutable;
  const npm = path.join(program, 'runtime/node_modules/npm/bin/npm-cli.js');
  if (!(await lstat(executable)).isFile() || !(await lstat(npm)).isFile())
    throw new Error('更新包缺少可用的运行组件。');
  return { executable, args: [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'] };
}
