import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import { InstallationManager } from '../server/installation';
import { UserDirectoryStore } from '../server/users';
import { readConfig } from '../server/config';
import { FullBackupService, digest } from '../server/full-backup';
import { restoreMysqlFresh } from '../server/mysql-backup';
import { ensureSchema, MysqlStore } from '../server/store';

test(
  'MySQL complete backup actually restores raw project tables in fresh databases and refuses future schemas/existing targets',
  { skip: process.env.MYSQL_INTEGRATION !== '1' },
  async () => {
    const source = new URL(process.env.DATABASE_URL!);
    const admin = await mysql.createConnection({
      host: source.hostname,
      port: Number(source.port || 3306),
      user: decodeURIComponent(source.username),
      password: decodeURIComponent(source.password),
    });
    const root = await mkdtemp(path.join(os.tmpdir(), 'worldloom-mysql-backup-'));
    const names = [
      `chronicle_cartarium_test_backup_${Date.now()}_${randomBytes(4).toString('hex')}`,
      `worldloom_test_restore_${Date.now()}_${randomBytes(4).toString('hex')}`,
    ];
    const manager = await InstallationManager.open(readConfig({ DATA_DIR: root }));
    const created: string[] = [];
    let restoredStore: MysqlStore | undefined;
    try {
      await manager.install({
        storage: 'mysql',
        username: 'gm',
        password: 'mysql-backup-test-password',
        title: '恢复验证',
        theme: 'jade',
        access: 'local',
        fillExample: true,
        mysql: {
          host: source.hostname,
          port: Number(source.port || 3306),
          username: decodeURIComponent(source.username),
          password: decodeURIComponent(source.password),
          database: names[0],
        },
      });
      created.push(names[0]);
      const users = await UserDirectoryStore.open(
        path.join(root, 'users.json'),
        () => manager.credentials,
        manager.maintenance,
      );
      const service = new FullBackupService(manager, users);
      const before = await manager.read();
      const item = await service.create(before.revision);
      assert.equal(item.verified, true);
      assert.equal(digest((await manager.read()).data), digest(before.data));
      const filename = path.join(root, 'backups', item.id, 'database.json');
      const saved = JSON.parse(await readFile(filename, 'utf8'));
      assert(saved.tables.some((table: { name: string }) => table.name === 'schema_migrations'));
      const target = new URL(source);
      target.pathname = '/' + names[0];
      const result = await restoreMysqlFresh(filename, target.toString(), names[1]);
      created.push(names[1]);
      assert.equal(digest(result.envelope.data), digest(before.data));
      assert.equal(result.envelope.revision, before.revision);
      await assert.rejects(restoreMysqlFresh(filename, target.toString(), names[0]), /已经存在/);
      restoredStore = await new MysqlStore(result.databaseUrl).initialize();
      await restoredStore.pool.query('INSERT INTO schema_migrations(version) VALUES(99)');
      await restoredStore.pool.query('ALTER TABLE world DROP COLUMN entity_templates');
      await assert.rejects(ensureSchema(restoredStore.pool), /newer/);
      const [columns] = await restoredStore.pool.query<mysql.RowDataPacket[]>(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='world' AND COLUMN_NAME='entity_templates'",
      );
      assert.equal(columns.length, 0); // Refusal happens before any earlier migration attempts.
    } finally {
      await restoredStore?.close();
      await manager.close();
      for (const name of created) await admin.query(`DROP DATABASE \`${name}\``);
      await admin.end();
      await rm(root, { recursive: true, force: true });
    }
  },
);
