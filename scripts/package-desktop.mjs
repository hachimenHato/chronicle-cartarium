// Additional Windows distribution. Never replaces the CMD/server release or a user instance.
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = process.cwd();
const source = path.resolve(process.argv[2] || '');
const runtimeSource = path.resolve(process.argv[3] || '');
const toolRoot = path.resolve(process.env.DESKTOP_BUILD_TOOLS || 'desktop');
if (process.platform !== 'win32')
  throw new Error('Build the Windows desktop companion on Windows.');
if (!source.startsWith(path.join(root, '.runtime/publishing') + path.sep))
  throw new Error('Use a fresh public allow-list snapshot, never the private installation.');
for (const name of ['.env', 'data', '.worldloom', 'mysql.txt']) {
  if (
    await access(path.join(source, name)).then(
      () => true,
      () => false,
    )
  )
    throw new Error('Private source directory refused.');
}
await access(path.join(source, 'dist/index.html'));
await access(path.join(runtimeSource, 'node.exe'));
await access(path.join(runtimeSource, 'node_modules/npm/bin/npm-cli.js'));
const brand = JSON.parse(await readFile(path.join(source, 'shared/brand.json'), 'utf8'));
const appPackage = JSON.parse(await readFile(path.join(source, 'desktop/package.json'), 'utf8'));
const backendPackage = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
const pinnedRuntime = JSON.parse(await readFile(path.join(source, 'desktop/runtime.json'), 'utf8'));
if (pinnedRuntime.electronVersion !== appPackage.devDependencies.electron)
  throw new Error('Electron pin mismatch');
const electronZipDir = process.env.DESKTOP_ELECTRON_ZIPS
  ? path.resolve(process.env.DESKTOP_ELECTRON_ZIPS)
  : undefined;
if (electronZipDir) {
  const archive = path.join(
    electronZipDir,
    `electron-v${pinnedRuntime.electronVersion}-win32-x64.zip`,
  );
  if (
    createHash('sha256')
      .update(await readFile(archive))
      .digest('hex') !== pinnedRuntime.win32X64Sha256
  )
    throw new Error('Electron runtime differs from the pinned official SHA256');
}
if (appPackage.version !== backendPackage.version)
  throw new Error('Desktop/backend version mismatch');
const work = path.join(root, '.runtime/desktop-work', `build-${Date.now()}`);
const payload = path.join(work, 'shell');
const backend = path.join(work, 'backend');
await mkdir(path.join(payload, 'desktop'), { recursive: true });
await mkdir(path.join(payload, 'shared'));
for (const name of [
  'main.cjs',
  'service.cjs',
  'loading.html',
  'shell-update.cjs',
  'shell-update-helper.cjs',
])
  await cp(path.join(source, 'desktop', name), path.join(payload, 'desktop', name));
await cp(path.join(source, 'shared/brand.json'), path.join(payload, 'shared/brand.json'));
for (const name of ['release-trust.json', 'desktop-update-security.cjs'])
  await cp(path.join(source, 'shared', name), path.join(payload, 'shared', name));
await cp(path.join(source, 'LICENSE'), path.join(payload, 'LICENSE'));
const { devDependencies, ...shellPackage } = appPackage;
await writeFile(
  path.join(payload, 'package.json'),
  JSON.stringify(
    { ...shellPackage, productName: `${brand.nameZh} ${brand.nameEn}`, main: 'desktop/main.cjs' },
    null,
    2,
  ),
);
await mkdir(backend);
for (const name of [
  'dist',
  'server',
  'shared',
  'scripts',
  'src/lib',
  'package.json',
  'package-lock.json',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'DEPENDENCY_LICENSES.md',
  'DEPENDENCIES.json',
])
  await cp(path.join(source, name), path.join(backend, name), { recursive: true });
await mkdir(path.join(backend, 'runtime/node_modules'), { recursive: true });
await cp(path.join(runtimeSource, 'node.exe'), path.join(backend, 'runtime/node.exe'));
await cp(
  path.join(runtimeSource, 'node_modules/npm'),
  path.join(backend, 'runtime/node_modules/npm'),
  {
    recursive: true,
    filter: (filename) =>
      !['.npmrc', '.env', 'mysql.txt', 'installation.json', 'users.json', 'runner.key'].includes(
        path.basename(filename),
      ),
  },
);
const nodeLicense = await access(path.join(runtimeSource, 'LICENSE')).then(
  () => 'LICENSE',
  () => 'LICENSE-node.txt',
);
await cp(path.join(runtimeSource, nodeLicense), path.join(backend, 'runtime/LICENSE-node.txt'));
const executable = path.join(backend, 'runtime/node.exe');
const nodeVersion = spawnSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true });
if (nodeVersion.status !== 0 || !/^v\d+\.\d+\.\d+\s*$/.test(nodeVersion.stdout))
  throw new Error('Bundled Node version check failed');
const npm = path.join(backend, 'runtime/node_modules/npm/bin/npm-cli.js');
await new Promise((resolve, reject) => {
  const child = spawn(executable, [npm, 'ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: backend,
    env: { ...process.env, NODE_ENV: 'production' },
    windowsHide: true,
    stdio: 'inherit',
  });
  child.once('error', reject);
  child.once('exit', (code) =>
    code === 0 ? resolve() : reject(new Error('Backend dependency preparation failed.')),
  );
});
// Render the existing vector brand mark, rather than introducing a different app identity.
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let png;
try {
  const page = await browser.newPage({
    viewport: { width: 256, height: 256 },
    deviceScaleFactor: 1,
  });
  const svg = (await readFile(path.join(source, 'public/favicon.svg'), 'utf8')).replace(
    '<svg ',
    '<svg width="256" height="256" ',
  );
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg}`);
  png = await page.screenshot({ omitBackground: true });
} finally {
  await browser.close();
}
await writeFile(path.join(payload, 'desktop/icon.png'), png);
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
const icon = path.join(work, 'icon.ico');
await writeFile(icon, Buffer.concat([header, png]));
const { packager } = await import(
  pathToFileURL(path.join(toolRoot, 'node_modules/@electron/packager/dist/index.js'))
);
const packages = await packager({
  dir: payload,
  out: path.join(work, 'output'),
  name: brand.nameEn,
  executableName: brand.nameEn,
  platform: 'win32',
  arch: 'x64',
  electronVersion: appPackage.devDependencies.electron,
  electronZipDir,
  appVersion: appPackage.version,
  buildVersion: `${appPackage.version.split('-')[0]}.${/-(?:beta|alpha|rc)\.(\d+)$/.exec(appPackage.version)?.[1] ?? 0}`,
  icon,
  asar: true,
  prune: false,
  extraResource: [backend],
  download: { cacheRoot: path.join(root, '.runtime/desktop-work/electron-cache') },
  win32metadata: {
    CompanyName: `${brand.nameEn} contributors`,
    ProductName: `${brand.nameZh} ${brand.nameEn}`,
    FileDescription: `${brand.nameZh}桌面版`,
    OriginalFilename: `${brand.nameEn}.exe`,
  },
});
const result = packages[0];
await cp(path.join(source, 'LICENSE'), path.join(result, 'LICENSE-project.txt'));
await writeFile(
  path.join(result, '桌面版使用说明.txt'),
  `${brand.nameZh} ${brand.nameEn} ${appPackage.version}\n\n双击 ${brand.nameEn}.exe 打开独立窗口，无需 CMD、系统浏览器或联网安装运行依赖。\n请完整解压到可写目录，不能只拷贝 EXE；本目录的资源和 DLL 必须一同保留。\n首次启动会在本目录 workspace 中准备工作台，数据位于其固定 dataDir（新安装默认 workspace/data）。\n已有 CMD 版请从“工作台 → 打开已有工作台”选择原程序根目录，不能只选 data；原 .worldloom/current.json 的数据路径优先。\n桌面版自己启动的服务仅监听本机，关闭时正常停止；附接外部 CMD 服务时关闭窗口不会停止它。\n帮助 → 检查桌面程序更新…可自动下载、官方验签、完整备份、退出并重开新版。原 EXE 保留为固定入口，实际版本见帮助 → 关于。\n后端另在工作台设置更新；旧EXE须先手动换到beta.19一次才有原生更新菜单。\n更新/迁移前创建并验证完整私有备份；不要删除 workspace/data/.worldloom，也不要重新初始化来替代路径核对。\n首次复制运行组件可能需要片刻。应用未做商业代码签名，Windows 可能提示未知发布者。\n此版本是额外下载项，原 CMD/服务器版继续保留。\n`,
);
const shellHashes = Object.fromEntries(
  await Promise.all(
    ['main.cjs', 'service.cjs', 'loading.html', 'shell-update.cjs', 'shell-update-helper.cjs'].map(
      async (name) => [
        name,
        createHash('sha256')
          .update(await readFile(path.join(source, 'desktop', name)))
          .digest('hex'),
      ],
    ),
  ),
);
const report = {
  version: appPackage.version,
  electron: appPackage.devDependencies.electron,
  backendNode: nodeVersion.stdout.trim().slice(1),
  output: result,
  executable: path.join(result, `${brand.nameEn}.exe`),
  template: path.join(result, 'resources/backend'),
  source: path.relative(root, source),
  shellHashes,
};
await writeFile(
  path.join(root, '.runtime/desktop-work/build-result.json'),
  JSON.stringify(report, null, 2),
);
console.log(`Desktop application prepared: ${path.relative(root, result)}`);

