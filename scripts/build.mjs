import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
// The server's local .env may intentionally select development. A release build
// must choose its own environment before Vite resolves React and the JSX runtime.
const environment = { ...process.env, NODE_ENV: 'production' };
for (const args of [
  [require.resolve('typescript/bin/tsc'), '--noEmit'],
  [join(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), 'build'],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
// Check the actual artifact, rather than trusting the build command or local env.
const assets = join(root, 'dist/assets');
let checked = 0;
for (const name of await readdir(assets)) {
  if (!name.endsWith('.js')) continue;
  const source = await readFile(join(assets, name), 'utf8');
  if (/\.jsxDEV\s*\(|react-stack-top-frame/.test(source)) {
    throw new Error('正式构建仍包含 React 开发调试代码，已拒绝作为发布资源。');
  }
  checked++;
}
if (!checked) throw new Error('正式构建缺少脚本资源。');
console.log(`正式资源检查通过：${checked} 个脚本均未带入 React 开发调试代码。`);
