import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import brand from '../shared/brand.json' with { type: 'json' };
import {
  assertPublicReleaseTree,
  createReleaseCopyFilter,
  isPrivateReleasePath,
} from './release-security.mjs';
const root = process.cwd();
const packageInfo = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(packageInfo.version))
  throw new Error('Invalid release version.');
const releaseName = `${brand.slug}-${packageInfo.version}-${Date.now()}`;
const destination = path.join(root, '.runtime', 'release', releaseName);
// An explicit allow-list keeps credentials, workspaces, uploads and runtime logs out of distribution.
const files = [
  'dist',
  'public',
  'src',
  'server',
  'shared',
  'scripts',
  'docs',
  'tests',
  'desktop',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'playwright.config.ts',
  '.prettierrc.json',
  '.gitignore',
  '.gitattributes',
  'index.html',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'LICENSE',
  'SECURITY.md',
  'DEPENDENCY_LICENSES.md',
  'DEPENDENCIES.json',
  'AGENTS.md',
  '.env.example',
  'start.cmd',
  'start.sh',
  'start.command',
  'Dockerfile',
  '.dockerignore',
  'docker-compose.yml',
  'docker-compose.image.yml',
];
await access(path.join(root, 'dist', 'index.html'));
// Check only the public allow-list; do not inspect the installation's data or credentials.
await assertPublicReleaseTree(root, { entries: files });
const publicSourceFilter = createReleaseCopyFilter(root);
await mkdir(path.dirname(destination), { recursive: true });
await mkdir(destination);
for (const file of files)
  await cp(path.join(root, file), path.join(destination, file), {
    recursive: true,
    force: true,
    filter: (source) => {
      return (
        publicSourceFilter(source) &&
        path.resolve(source) !==
          path.resolve(process.env.RELEASE_SIGNING_KEY || '.runtime/release-signing-private.pem')
      );
    },
  });
await writeFile(
  path.join(destination, 'RELEASE.txt'),
  `${brand.nameZh} ${brand.nameEn} ${packageInfo.version}\nWindows：双击 start.cmd${process.platform === 'win32' ? '（本包捆绑 Windows Node.js 与 npm）' : '（需安装 Node.js 22.18+ 与 npm）'}\nLinux：安装 Node.js 22.18+ 与 npm 后执行 sh start.sh\n首次启动及更新准备依赖需要联网。\n安装时二选一：本地数据库 / MySQL。\n新安装数据默认在安装根 data；启动器将实际绝对数据路径固定在 .worldloom/current.json，后续更新不搬数据。\n主管理员在后台选择受签名 .ccupdate 更新包（兼容旧.wlupdate），再点“备份并更新”；只支持同数据格式。\n旧beta第一次接入需停机备份并明确采用原DATA_DIR，详见docs/update-strategy.md。\n完整私有备份包含账号与凭据，当前不加密，请私密保存。\n此包不含任何真实凭据或用户数据。Linux/Docker仍待实机验收。\n`,
);
if (process.platform === 'win32') {
  const npmDirectory = path.join(path.dirname(process.execPath), 'node_modules', 'npm');
  const npmPackage = JSON.parse(await readFile(path.join(npmDirectory, 'package.json'), 'utf8'));
  if (npmPackage.name !== 'npm') throw new Error('Bundled npm directory check failed.');
  const runtime = path.join(destination, 'runtime');
  await mkdir(runtime, { recursive: true });
  await cp(process.execPath, path.join(runtime, 'node.exe'));
  await cp(npmDirectory, path.join(runtime, 'node_modules', 'npm'), {
    recursive: true,
    filter: (source) => !isPrivateReleasePath(path.relative(npmDirectory, source)),
  });
  let licenseText;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const license = await fetch(
        `https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`,
        { signal: AbortSignal.timeout(15000) },
      );
      if (!license.ok) throw new Error('Node license response failed.');
      licenseText = await license.text();
      break;
    } catch {
      if (attempt === 2)
        throw new Error(
          'Cannot retrieve Node runtime license. Retry packaging when the connection is available.',
        );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await writeFile(path.join(runtime, 'LICENSE-node.txt'), licenseText);
  await writeFile(
    path.join(runtime, 'VERSION.txt'),
    `Node.js ${process.versions.node}; npm ${npmPackage.version}\nWindows ${process.arch} runtime included. Linux requires a matching Linux Node runtime.\n`,
  );
}
const pkg = JSON.parse(await readFile(path.join(destination, 'package.json'), 'utf8'));
if (pkg.version !== packageInfo.version) throw new Error('Release version mismatch.');
console.log(`发布目录已准备：.runtime/release/${releaseName}`);
