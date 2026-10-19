import { DataProtectionError } from './maintenance';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validProjectDatabaseName } from '../shared/branding';
import { randomBytes } from 'node:crypto';
import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { ensureSchema, MysqlStore, type DatabaseBackupInfo } from './store';
import { createEmptyWorkspace } from '../shared/empty';
import type { WorkspaceEnvelope } from '../shared/model';

const cell = z.union([
  z.string(),
  z.number().finite(),
  z.null(),
  z.object({ date: z.string().datetime() }).strict(),
]);
const snapshotSchema = z
  .object({
    format: z.literal('worldloom-mysql'),
    version: z.literal(1),
    schemaVersion: z.literal(5),
    charset: z.literal('utf8mb4'),
    collation: z.string().regex(/^utf8mb4_[a-z0-9_]+$/),
    tables: z.array(
      z
        .object({
          name: z.string().regex(/^[a-z_]+$/),
          create: z.string(),
          columns: z.array(z.string().regex(/^[a-z_]+$/)),
          rows: z.array(z.array(cell)),
        })
        .strict(),
    ),
  })
  .strict();
export type MysqlSnapshot = z.infer<typeof snapshotSchema>;
async function tableNames() {
  const source = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  return [...source.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((match) => match[1]);
}

export async function snapshotMysql(pool: Pool, directory: string): Promise<DatabaseBackupInfo> {
  const c = await pool.getConnection();
  try {
    const names = await tableNames();
    const [database] = await c.query<RowDataPacket[]>(
      'SELECT DEFAULT_CHARACTER_SET_NAME AS charset, DEFAULT_COLLATION_NAME AS collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=DATABASE()',
    );
    const [actual] = await c.query<RowDataPacket[]>('SHOW FULL TABLES');
    if (
      actual.length !== names.length ||
      actual.some(
        (row) =>
          !names.includes(String(Object.values(row)[0])) || Object.values(row)[1] !== 'BASE TABLE',
      )
    )
      throw new DataProtectionError('项目库含有未知表或视图，无法自动确认完整备份。');
    const [engines] = await c.query<RowDataPacket[]>(
      'SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()',
    );
    if (engines.some((row) => row.ENGINE !== 'InnoDB'))
      throw new DataProtectionError('完整备份要求项目表使用InnoDB。');
    const [triggers] = await c.query<RowDataPacket[]>('SHOW TRIGGERS');
    const [routines] = await c.query<RowDataPacket[]>(
      'SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE()',
    );
    const [events] = await c.query<RowDataPacket[]>(
      'SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()',
    );
    if (triggers.length || routines.length || events.length)
      throw new DataProtectionError('项目库含有额外数据库程序，请使用数据库管理员完整备份。');
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    const tables: MysqlSnapshot['tables'] = [];
    for (const name of names) {
      const [definition] = await c.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${name}\``);
      const [records, fields] = await c.query<RowDataPacket[]>(`SELECT * FROM \`${name}\``);
      tables.push({
        name,
        create: String(definition[0]['Create Table']),
        columns: fields.map((field) => field.name),
        rows: records.map((row) =>
          fields.map((field) => {
            const value = row[field.name];
            if (value instanceof Date) return { date: value.toISOString() };
            if (value === null || typeof value === 'string' || typeof value === 'number')
              return value;
            if (typeof value === 'object' && !Buffer.isBuffer(value)) return JSON.stringify(value);
            throw new DataProtectionError('项目表含有不支持的字段类型，备份已停止。');
          }),
        ),
      });
    }
    await c.commit();
    const snapshot = snapshotSchema.parse({
      format: 'worldloom-mysql',
      version: 1,
      schemaVersion: 5,
      tables,
      charset: database[0].charset,
      collation: database[0].collation,
    });
    await writeFile(path.join(directory, 'database.json'), JSON.stringify(snapshot), {
      flag: 'wx',
      mode: 0o600,
    });
    return { storage: 'mysql', file: 'database.json', schemaVersion: 5 };
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}

/** Recovery always creates a brand-new project database. No uploaded SQL is executed. */
export async function restoreMysqlFresh(filename: string, databaseUrl: string, newName: string) {
  if (!validProjectDatabaseName(newName))
    throw new DataProtectionError('恢复数据库名称必须是新的chronicle_cartarium_项目库。');
  const snapshot = snapshotSchema.parse(JSON.parse(await readFile(filename, 'utf8')));
  const names = await tableNames();
  if (
    snapshot.tables.length !== names.length ||
    new Set(snapshot.tables.map((table) => table.name)).size !== names.length ||
    snapshot.tables.some((table) => !names.includes(table.name))
  )
    throw new DataProtectionError('备份表清单与本版本不兼容。');
  const source = new URL(databaseUrl);
  const admin = await mysql.createConnection({
    host: source.hostname,
    port: Number(source.port || 3306),
    user: decodeURIComponent(source.username),
    password: decodeURIComponent(source.password),
  });
  try {
    const [existing] = await admin.query<RowDataPacket[]>(
      'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',
      [newName],
    );
    if (existing.length) throw new DataProtectionError('恢复数据库名称已经存在，未修改现有库。');
    await admin.query(
      `CREATE DATABASE \`${newName}\` CHARACTER SET utf8mb4 COLLATE ${snapshot.collation}`,
    );
  } finally {
    await admin.end();
  }
  source.pathname = '/' + newName;
  const targetUrl = source.toString();
  const store = new MysqlStore(targetUrl, createEmptyWorkspace);
  try {
    await ensureSchema(store.pool);
    const c = await store.pool.getConnection();
    try {
      await c.query('SET FOREIGN_KEY_CHECKS=0');
      await c.beginTransaction();
      for (const table of snapshot.tables) {
        const [definition] = await c.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${table.name}\``);
        if (String(definition[0]['Create Table']) !== table.create)
          throw new DataProtectionError('数据库结构与本版本标准结构不一致，恢复已停止。');
        const [fields] = await c.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${table.name}\``);
        const expected = fields.map((field) => String(field.Field));
        if (
          table.columns.length !== expected.length ||
          table.columns.some((column, index) => column !== expected[index])
        )
          throw new DataProtectionError('备份字段与本版本不兼容。');
        await c.query(`DELETE FROM \`${table.name}\``);
        const columns = table.columns.map((column) => `\`${column}\``).join(',');
        for (const row of table.rows) {
          if (row.length !== table.columns.length)
            throw new DataProtectionError('备份记录字段不完整。');
          await c.query(
            `INSERT INTO \`${table.name}\` (${columns}) VALUES (${row.map(() => '?').join(',')})`,
            row.map((value) => (value && typeof value === 'object' ? new Date(value.date) : value)),
          );
        }
      }
      await c.commit();
      await c.query('SET FOREIGN_KEY_CHECKS=1');
    } catch (error) {
      await c.rollback();
      throw error;
    } finally {
      c.release();
    }
    const envelope = await store.read();
    return { databaseUrl: targetUrl, databaseName: newName, envelope };
  } finally {
    await store.close();
  }
}

/** Drop only the exact fresh verification database created by this call. */
export async function verifyMysqlRecovery(
  filename: string,
  databaseUrl: string,
): Promise<WorkspaceEnvelope> {
  const name = `worldloom_verify_${Date.now()}_${randomBytes(6).toString('hex')}`;
  const result = await restoreMysqlFresh(filename, databaseUrl, name);
  const source = new URL(result.databaseUrl);
  const admin = await mysql.createConnection({
    host: source.hostname,
    port: Number(source.port || 3306),
    user: decodeURIComponent(source.username),
    password: decodeURIComponent(source.password),
  });
  try {
    await admin.query(`DROP DATABASE \`${name}\``);
  } finally {
    await admin.end();
  }
  return result.envelope;
}
