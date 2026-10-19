// Run only on an offline backup; existing data targets/databases are always refused.
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { extractBackup, recoverBackup } from '../server/backup-recovery';

const [archive, target, database] = process.argv.slice(2);
if (!archive || !target) {
  console.error(
    '用法：node --import tsx scripts/recover.ts 完整备份.ccbackup 全新数据目录 [全新MySQL库名]（兼容旧.wlbackup）',
  );
  process.exitCode = 1;
} else {
  try {
    const staging = await mkdtemp(path.join(os.tmpdir(), 'worldloom-recovery-'));
    const unpacked = path.join(staging, 'verified');
    await extractBackup(path.resolve(archive), unpacked);
    const result = await recoverBackup(unpacked, path.resolve(target), database);
    console.log(JSON.stringify(result));
    console.log(
      '恢复验证完成。原数据保留；请将DATA_DIR指向新目录后启动并检查。私有environment.env需按部署方式采用，不能公开分享。',
    );
    console.log(
      '若通过start.cmd/start.sh启动，请先停止服务，再将安装根.worldloom/current.json的dataDir改为已恢复的新目录；该指针优先于环境变量。',
    );
  } catch (error) {
    // Driver messages and backup records can contain private details; do not print them.
    console.error(
      `恢复失败（${(error as Error).name}）。现有数据未被覆盖；请核对备份、版本、目标是否全新及数据库权限。`,
    );
    process.exitCode = 1;
  }
}
