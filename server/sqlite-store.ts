import { mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import type { Workspace, WorkspaceEnvelope } from '../shared/model';
import { createEmptyWorkspace } from '../shared/empty';
import { ConflictError, type WorkspaceStore, type DatabaseBackupInfo } from './store';
import { validateWorkspace } from './validation';

const collections = [
  'worlds',
  'entities',
  'maps',
  'relations',
  'plots',
  'sessions',
  'variables',
] as const;

/** Local single-GM storage. Each domain aggregate is a separate ordered record;
 * map and plot children retain their validated, versioned editor documents. */
export class SqliteStore implements WorkspaceStore {
  readonly mode = 'sqlite' as const;
  private db!: DatabaseSync;
  constructor(private filename: string) {}
  async initialize() {
    await mkdir(path.dirname(this.filename), { recursive: true });
    this.db = new DatabaseSync(this.filename, { timeout: 5000 });
    try {
      const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
      if (version > 1 || version < 0)
        throw new Error('SQLite schema is newer than this application; no migration was executed.');
      await chmod(this.filename, 0o600);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS workspace_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>=0)); INSERT OR IGNORE INTO workspace_state VALUES(1,0);',
      );
      for (const name of collections)
        this.db.exec(
          `CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, document TEXT NOT NULL CHECK(json_valid(document)));`,
        );
      if (version === 0) this.db.exec('PRAGMA user_version=1;');
      validateWorkspace((await this.read()).data);
      return this;
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  async read(): Promise<WorkspaceEnvelope> {
    this.db.exec('BEGIN');
    try {
      const revision = Number(
        this.db.prepare('SELECT revision FROM workspace_state WHERE id=1').get()!.revision,
      );
      const data = createEmptyWorkspace();
      for (const name of collections) {
        const records = this.db.prepare(`SELECT document FROM ${name} ORDER BY sort_order`).all();
        (data[name] as unknown[]) = records.map((row) => JSON.parse(String(row.document)));
      }
      this.db.exec('COMMIT');
      return { data, revision, mode: this.mode };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  async save(data: Workspace, revision: number): Promise<WorkspaceEnvelope> {
    const checked = validateWorkspace(data);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = Number(
        this.db.prepare('SELECT revision FROM workspace_state WHERE id=1').get()!.revision,
      );
      if (current !== revision) throw new ConflictError();
      for (const name of collections) {
        this.db.exec(`DELETE FROM ${name}`);
        const insert = this.db.prepare(
          `INSERT INTO ${name} (id,sort_order,document) VALUES (?,?,?)`,
        );
        checked[name].forEach((record, i) => insert.run(record.id, i, JSON.stringify(record)));
      }
      this.db.prepare('UPDATE workspace_state SET revision=? WHERE id=1').run(revision + 1);
      this.db.exec('COMMIT');
      return { data: structuredClone(checked), revision: revision + 1, mode: this.mode };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  async close() {
    this.db.close();
  }
  async backupDatabase(directory: string): Promise<DatabaseBackupInfo> {
    const destination = path.join(directory, 'database.sqlite');
    await backup(this.db, destination);
    // The isolated copy is self-contained; verification must not create WAL sidecars.
    const copied = new DatabaseSync(destination);
    try {
      copied.exec('PRAGMA journal_mode=DELETE;');
    } finally {
      copied.close();
    }
    await chmod(destination, 0o600);
    return { storage: 'sqlite', file: 'database.sqlite', schemaVersion: 1 };
  }
  static readBackup(filename: string): WorkspaceEnvelope {
    const db = new DatabaseSync(filename, { readOnly: true });
    try {
      if (
        Number(db.prepare('PRAGMA user_version').get()!.user_version) !== 1 ||
        db.prepare('PRAGMA integrity_check').get()!.integrity_check !== 'ok'
      )
        throw new Error('SQLite backup integrity or version check failed.');
      const data = createEmptyWorkspace();
      for (const name of collections)
        (data[name] as unknown[]) = db
          .prepare(`SELECT document FROM ${name} ORDER BY sort_order`)
          .all()
          .map((row) => JSON.parse(String(row.document)));
      const revision = Number(
        db.prepare('SELECT revision FROM workspace_state WHERE id=1').get()!.revision,
      );
      return { data: validateWorkspace(data), revision, mode: 'sqlite' };
    } finally {
      db.close();
    }
  }
}
