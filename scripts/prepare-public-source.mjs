// Public source is a fresh allow-listed snapshot, never a copy of the installation.
import { cp, mkdir, readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const destination = path.resolve(process.argv[2] || '');
if (!destination.startsWith(path.join(root, '.runtime', 'publishing') + path.sep))
  throw new Error('Use a new publishing subdirectory');
await mkdir(destination); // Existing snapshots are never overwritten.
const directories = ['src', 'server', 'shared', 'scripts', 'tests', 'public', '.github'];
const files = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.ts',
  'playwright.config.ts',
  '.prettierrc.json',
  '.gitignore',
  '.gitattributes',
  '.dockerignore',
  '.env.example',
  'index.html',
  'README.md',
  'LICENSE',
  'SECURITY.md',
  'THIRD_PARTY_NOTICES.md',
  'DEPENDENCY_LICENSES.md',
  'DEPENDENCIES.json',
  'AGENTS.md',
  'start.cmd',
  'start.sh',
  'start.command',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.image.yml',
];
for (const item of [...directories, ...files]) {
  try {
    await cp(path.join(root, item), path.join(destination, item), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  } catch (error) {
    if (!(item === '.github' && error.code === 'ENOENT')) throw error;
  }
}
await mkdir(path.join(destination, 'docs'));
for (const name of await readdir(path.join(root, 'docs'))) {
  if (
    !name.endsWith('.md') ||
    ['handoff.md', 'development-log.md', 'map-performance.md', 'deployment-beta.md'].includes(name)
  )
    continue;
  await cp(path.join(root, 'docs', name), path.join(destination, 'docs', name));
}
await writeFile(
  path.join(destination, 'docs/handoff.md'),
  '# 开发接手入口\n\n此公开源码快照不包含维护者本机的运行记录、数据库配置、私有备份和历史交接日志。先阅读根 AGENTS.md、README.md、架构与需求文档。领域契约在 shared/，写入校验在 server/validation.ts。运行 typecheck、test、build；地图交互测试只使用 3311 临时演示存储。后续改动记录在 development-log.md，不能提交真实数据、凭据或发行私钥。\n',
);
await writeFile(
  path.join(destination, 'docs/development-log.md'),
  '# 公开开发记录\n\n0.2.0-beta.16：首次公开源码准备。已有功能与限制见 README；Windows 本机历史验证包含类型、单测、构建与隔离地图 UI，跨系统验收以 Release/CI 为准。维护者历史私有运行日志未发布。\n',
);
// Refuse symlinks, private filenames and machine-specific traces before any Git staging.
async function inspect(directory) {
  for (const name of await readdir(directory)) {
    const filename = path.join(directory, name);
    const relative = path.relative(destination, filename).replaceAll('\\', '/');
    const stat = await lstat(filename);
    if (stat.isSymbolicLink()) throw new Error(`Symlink refused: ${relative}`);
    if (
      /(^|\/)(\.env|mysql\.txt|installation\.json|users\.json|runner\.key|\.npmrc)$|\.(pem|sqlite|ccbackup|wlbackup)$/i.test(
        relative,
      )
    )
      throw new Error(`Private path refused: ${relative}`);
    if (stat.isDirectory()) await inspect(filename);
    else if (/\.(md|json|ya?ml|[cm]?tsx?|[cm]?js|sh|cmd|command)$/.test(name)) {
      const content = await readFile(filename, 'utf8');
      if (
        /F:[\\/]AiSoft[\\/]trpgEdit|C:[\\/]Users[\\/]Administrator|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/]/.test(
          content,
        )
      )
        throw new Error(`Private content refused: ${relative}`);
    }
  }
}
await inspect(destination);
console.log(`Public allow-list snapshot prepared: ${path.relative(root, destination)}`);
