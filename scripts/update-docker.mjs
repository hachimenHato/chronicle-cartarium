/** Host-side update: named instance only, persistent mount retained, backup copied off-volume. */
import path from 'node:path';
import { mkdir, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const [firstArgument, secondArgument] = process.argv.slice(2);
let project = secondArgument ? firstArgument : undefined;
const image = secondArgument || firstArgument;
if (
  (project !== undefined && !/^[a-z0-9][a-z0-9_-]*$/.test(project)) ||
  !/^[A-Za-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(image || '')
) {
  console.error(
    '用法：node scripts/update-docker.mjs [原Compose项目名] 可信镜像名@sha256:完整摘要',
  );
  process.exitCode = 1;
} else {
  const root = path.resolve('.worldloom');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const override = path.join(root, 'docker-update.json');
  const composeFile = path.resolve('docker-compose.yml');
  const compose = ['compose', ...(project ? ['-p', project] : []), '-f', composeFile];
  let original,
    backup,
    data,
    mounts,
    switched = false,
    committed = false;
  const command = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn('docker', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.length > 16 * 1024 * 1024) child.kill();
      });
      // Docker config/inspect and stderr may contain secrets. Never forward them to the terminal.
      child.stderr.resume();
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0 ? resolve(output.trim()) : reject(new Error('Docker step failed.')),
      );
    });
  const maintenance = (action, id) =>
    command([
      ...compose,
      '-f',
      override,
      'exec',
      '-T',
      'app',
      'node',
      '--import',
      'tsx',
      'scripts/docker-maintenance.ts',
      action,
      ...(id ? [id] : []),
    ]);
  async function writeOverride(imageName, dataDir, hold) {
    await writeFile(
      override,
      JSON.stringify({
        services: {
          app: {
            image: imageName,
            environment: {
              DATA_DIR: dataDir,
              WORLDLOOM_UPDATE_HOLD: hold ? 'true' : 'false',
              WORLDLOOM_DEPLOYMENT: 'docker',
            },
          },
        },
      }),
      { mode: 0o600 },
    );
  }
  async function verifyFiles(directory) {
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    for (const entry of manifest.entries) {
      if (
        entry.path.includes('..') ||
        path.isAbsolute(entry.path) ||
        entry.path.includes('\\') ||
        entry.path.includes(':')
      )
        throw new Error('Invalid backup path.');
      const filename = path.join(directory, entry.path);
      if ((await lstat(filename)).size !== entry.bytes) throw new Error('Backup copy incomplete.');
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(filename)) hash.update(chunk);
      if (hash.digest('hex') !== entry.sha256) throw new Error('Backup copy damaged.');
    }
  }
  try {
    console.log('正在准备镜像并核对原实例；完成后自动备份和更新…');
    const id = await command([...compose, 'ps', '-q', 'app']);
    if (!id || /\s/.test(id)) throw new Error('Exactly one app instance is required.');
    original = JSON.parse(await command(['inspect', id]))[0];
    if (project === undefined) {
      project = original.Config.Labels?.['com.docker.compose.project'];
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(project || ''))
        throw new Error('Invalid project identity.');
      compose.splice(1, 0, '-p', project);
    }
    if (
      original.Config.Labels?.['com.docker.compose.project'] !== project ||
      original.Config.Labels?.['com.docker.compose.service'] !== 'app'
    )
      throw new Error('Instance identity mismatch.');
    data =
      original.Config.Env.find((value) => value.startsWith('DATA_DIR='))?.slice(9) || '/app/data';
    const mount = original.Mounts.filter(
      (item) => data === item.Destination || data.startsWith(item.Destination + '/'),
    ).sort((a, b) => b.Destination.length - a.Destination.length)[0];
    if (!mount || !['volume', 'bind'].includes(mount.Type))
      throw new Error('A stable persistent data mount is required.');
    if ((mount.Name || mount.Source).includes(',') || mount.Destination.includes(','))
      throw new Error('The mount path is not supported by the recovery command.');
    mounts = original.Mounts.map((item) => [item.Type, item.Name || item.Source, item.Destination]);
    await command(['pull', image]);
    const candidate = JSON.parse(await command(['image', 'inspect', image]))[0];
    if (
      candidate.Config.Labels?.['io.worldloom.application'] !== 'worldloom' ||
      candidate.Config.Labels?.['io.worldloom.mysql-schema'] !== '5' ||
      candidate.Config.Labels?.['io.worldloom.sqlite-schema'] !== '1'
    )
      throw new Error('Image data format is not supported.');
    await writeOverride(original.Image, data, false);
    const saved = JSON.parse(await maintenance('backup'));
    backup = path.join(root, 'host-backups', saved.id);
    await mkdir(path.dirname(backup), { recursive: true, mode: 0o700 });
    await command(['cp', id + ':' + data + '/backups/' + saved.id, backup]);
    await verifyFiles(backup);
    console.log('完整备份已复制到宿主机并校验，正在切换应用镜像…');
    await writeOverride(image, data, true);
    switched = true;
    await command([...compose, '-f', override, 'up', '-d', '--no-deps', '--no-build', 'app']);
    const nextId = await command([...compose, '-f', override, 'ps', '-q', 'app']);
    const next = JSON.parse(await command(['inspect', nextId]))[0];
    if (
      JSON.stringify(
        next.Mounts.map((item) => [item.Type, item.Name || item.Source, item.Destination]),
      ) !== JSON.stringify(mounts)
    )
      throw new Error('Data mount changed.');
    let verified = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await maintenance('check', saved.id);
        verified = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    if (!verified) throw new Error('New image health check failed.');
    await writeOverride(image, data, false);
    // Commit before a request that may reopen writes; a lost response must not discard new edits.
    committed = true;
    await maintenance('complete');
    console.log(
      '更新完成，创作、图片、账号和权限验证通过。后续Compose操作继续采用.worldloom/docker-update.json覆盖文件。',
    );
  } catch {
    if (committed) {
      const released = await maintenance('complete').then(
        () => true,
        () => false,
      );
      console.error(
        released
          ? '更新与资料验证已完成，原资料保留。请重新登录检查工作台。'
          : '新版资料已验证；开放保存确认未收到。请保持现有卷，正常重启应用并检查维护状态，勿恢复旧快照覆盖新内容。',
      );
    } else if (switched && original && backup) {
      try {
        await command([...compose, '-f', override, 'stop', 'app']);
        const dataMount = original.Mounts.filter(
          (item) => data === item.Destination || data.startsWith(item.Destination + '/'),
        ).sort((a, b) => b.Destination.length - a.Destination.length)[0];
        const mountArgs = [
          '--mount',
          `type=${dataMount.Type},source=${dataMount.Name || dataMount.Source},target=${dataMount.Destination}`,
        ];
        const network = Object.keys(original.NetworkSettings.Networks)[0];
        const output = await command([
          'run',
          '--rm',
          '--network',
          network,
          ...mountArgs,
          '--mount',
          `type=bind,source=${backup},target=/worldloom-backup,readonly`,
          '-e',
          'DATA_DIR=' + data,
          '-e',
          'BACKUP_DIRECTORY=/worldloom-backup',
          '--entrypoint',
          'node',
          original.Image,
          '--import',
          'tsx',
          'scripts/docker-maintenance.ts',
          'recover',
        ]);
        const recovered = JSON.parse(output.split('\n').at(-1));
        await writeOverride(original.Image, recovered.target, false);
        await command([...compose, '-f', override, 'up', '-d', '--no-deps', '--no-build', 'app']);
        console.error('新版未通过检查，已恢复旧镜像和完整资料，原目录及宿主机备份保留。');
      } catch {
        console.error(
          '自动恢复未完成，宿主机完整备份及原卷保留。请按恢复指引处理，勿删除卷或重新初始化。',
        );
      }
    } else {
      if (original) await maintenance('release').catch(() => undefined);
      console.error('镜像准备或完整备份失败，原实例保留。请检查镜像来源、权限、网络和磁盘空间。');
    }
    process.exitCode = 1;
  }
}
