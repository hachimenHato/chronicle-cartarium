import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import type { Workspace, WorkspaceEnvelope } from '../shared/model';
import { createSeed } from '../shared/seed';
import { validateWorkspace } from './validation';
import type { AppConfig } from './config';
import { snapshotMysql } from './mysql-backup';

export class ConflictError extends Error {
  constructor() {
    super('内容已被其他页面更新，请先重新加载再保存。');
  }
}
export interface WorkspaceStore {
  mode: 'demo' | 'mysql' | 'sqlite';
  read(): Promise<WorkspaceEnvelope>;
  save(data: Workspace, revision: number): Promise<WorkspaceEnvelope>;
  close(): Promise<void>;
  backupDatabase?(directory: string): Promise<DatabaseBackupInfo>;
}
export interface DatabaseBackupInfo {
  storage: 'demo' | 'sqlite' | 'mysql';
  file: string;
  schemaVersion: number;
}

export class DemoStore implements WorkspaceStore {
  readonly mode = 'demo' as const;
  private current!: WorkspaceEnvelope;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private filename: string,
    private seed: () => Workspace = createSeed,
  ) {}
  async initialize() {
    await mkdir(path.dirname(this.filename), { recursive: true });
    try {
      const saved = JSON.parse(await readFile(this.filename, 'utf8'));
      if (!Number.isSafeInteger(saved.revision) || saved.revision < 0)
        throw new Error('Invalid demo revision.');
      this.current = {
        data: validateWorkspace(saved.data),
        revision: saved.revision,
        mode: this.mode,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      this.current = { data: validateWorkspace(this.seed()), revision: 0, mode: this.mode };
      await this.write(this.current);
    }
    return this;
  }
  private async write(envelope: WorkspaceEnvelope) {
    const temporary = `${this.filename}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(envelope, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporary, this.filename);
  }
  async read() {
    await this.queue;
    return structuredClone(this.current);
  }
  async save(data: Workspace, revision: number) {
    const operation = this.queue.then(async () => {
      if (revision !== this.current.revision) throw new ConflictError();
      const next: WorkspaceEnvelope = {
        data: validateWorkspace(data),
        revision: revision + 1,
        mode: this.mode,
      };
      await this.write(next);
      this.current = structuredClone(next);
      return structuredClone(next);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  async close() {
    await this.queue;
  }
  async backupDatabase(directory: string): Promise<DatabaseBackupInfo> {
    await writeFile(path.join(directory, 'database.json'), JSON.stringify(await this.read()), {
      flag: 'wx',
      mode: 0o600,
    });
    return { storage: 'demo', file: 'database.json', schemaVersion: 1 };
  }
}

export async function ensureSchema(pool: Pool) {
  const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  const editorMigration = await readFile(
    new URL('./migrations/002-map-editor.sql', import.meta.url),
    'utf8',
  );
  const connection = await pool.getConnection();
  try {
    const [database] = await connection.query<RowDataPacket[]>('SELECT DATABASE() AS name');
    if (!database[0].name) throw new Error('A dedicated project database must be selected.');
    const lockName = `worldloom_schema_${createHash('sha256').update(database[0].name).digest('hex').slice(0, 40)}`;
    const [rows] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, 30) AS acquired', [
      lockName,
    ]);
    if (Number(rows[0].acquired) !== 1)
      throw new Error('Could not acquire database migration lock.');
    try {
      const [metadata] = await connection.query<RowDataPacket[]>(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='schema_migrations'",
      );
      if (metadata.length) {
        const [versions] = await connection.query<RowDataPacket[]>(
          'SELECT version FROM schema_migrations',
        );
        if (
          versions.some(
            (row) =>
              !Number.isInteger(Number(row.version)) ||
              Number(row.version) < 1 ||
              Number(row.version) > 5,
          )
        )
          throw new Error(
            'Database schema is newer than this application; no migration was executed.',
          );
      }
      for (const statement of sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await connection.query(statement);
      // MySQL DDL commits implicitly. Inspect the column as well as the version so
      // a crash after ALTER TABLE but before recording version 2 can safely resume.
      const [columns] = await connection.query<RowDataPacket[]>(
        "SELECT DATA_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='atlas_map' AND COLUMN_NAME='editor_data'",
      );
      if (!columns.length) await connection.query(editorMigration);
      else if (columns[0].DATA_TYPE !== 'json' || columns[0].IS_NULLABLE !== 'YES')
        throw new Error('atlas_map.editor_data must be a nullable JSON column.');
      await connection.query('INSERT IGNORE INTO schema_migrations(version) VALUES (2)');
      const [scaleColumns] = await connection.query<RowDataPacket[]>(
        "SELECT DATA_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='atlas_map' AND COLUMN_NAME='scale_km'",
      );
      if (!scaleColumns.length)
        await connection.query(
          await readFile(new URL('./migrations/003-map-scale.sql', import.meta.url), 'utf8'),
        );
      else if (scaleColumns[0].DATA_TYPE !== 'double' || scaleColumns[0].IS_NULLABLE !== 'YES')
        throw new Error('atlas_map.scale_km must be a nullable DOUBLE column.');
      await connection.query('INSERT IGNORE INTO schema_migrations(version) VALUES (3)');
      const [templateColumns] = await connection.query<RowDataPacket[]>(
        "SELECT DATA_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='world' AND COLUMN_NAME='entity_templates'",
      );
      if (!templateColumns.length)
        await connection.query(
          await readFile(new URL('./migrations/004-entity-templates.sql', import.meta.url), 'utf8'),
        );
      else if (templateColumns[0].DATA_TYPE !== 'json' || templateColumns[0].IS_NULLABLE !== 'YES')
        throw new Error('world.entity_templates must be a nullable JSON column.');
      await connection.query('INSERT IGNORE INTO schema_migrations(version) VALUES (4)');
      const additions = await readFile(
        new URL('./migrations/005-authorship-catalogue.sql', import.meta.url),
        'utf8',
      );
      for (const line of additions
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('ALTER TABLE'))) {
        const match =
          /^ALTER TABLE (\w+) ADD COLUMN (\w+) (JSON|VARCHAR\(\d+\)|TEXT|INT) NULL;$/i.exec(line)!;
        const [existing] = await connection.query<RowDataPacket[]>(
          'SELECT DATA_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',
          [match[1], match[2]],
        );
        const expected = match[3].toLowerCase().replace(/\(.*\)/, '');
        if (!existing.length) await connection.query(line);
        else if (existing[0].DATA_TYPE !== expected || existing[0].IS_NULLABLE !== 'YES')
          throw new Error('Creative metadata column has an incompatible type.');
      }
      await connection.query('INSERT IGNORE INTO schema_migrations(version) VALUES (5)');
    } finally {
      await connection.query('SELECT RELEASE_LOCK(?)', [lockName]);
    }
  } finally {
    connection.release();
  }
}

const json = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value);
const optional = (value: unknown) => (value === null ? undefined : (value as string));
const publication = (row: RowDataPacket) => ({
  ...(row.created_by == null ? {} : { createdBy: row.created_by }),
  ...(row.visibility == null ? {} : { visibility: row.visibility }),
});
async function rows(connection: PoolConnection, table: string): Promise<RowDataPacket[]> {
  const [result] = await connection.query<RowDataPacket[]>(`SELECT * FROM \`${table}\``);
  // Snapshots already load every row. Sort references here so large JSON map
  // payloads do not enter MySQL's bounded filesort buffer alongside sort_order.
  return result.sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
}

async function readData(c: PoolConnection): Promise<Workspace> {
  const w = await rows(c, 'world');
  const e = await rows(c, 'entity');
  const maps = await rows(c, 'atlas_map');
  const pins = await rows(c, 'map_pin');
  const strokes = await rows(c, 'map_stroke');
  const relations = await rows(c, 'relation');
  const plots = await rows(c, 'plot');
  const nodes = await rows(c, 'plot_node');
  const edges = await rows(c, 'plot_edge');
  const sessions = await rows(c, 'game_session');
  const variables = await rows(c, 'state_variable');
  return {
    worlds: w.map((v) => ({
      id: v.id,
      name: v.name,
      subtitle: v.subtitle,
      description: v.description,
      system: v.system,
      createdAt: v.created_at,
      ...(v.entity_templates == null ? {} : { entityTemplates: json(v.entity_templates) }),
      ...(v.entity_types == null ? {} : { entityTypes: json(v.entity_types) }),
    })),
    entities: e.map((v) => ({
      ...(v.created_by == null ? {} : { createdBy: v.created_by }),
      ...(v.cover == null ? {} : { cover: v.cover }),
      ...(v.graph_position == null ? {} : { graphPosition: json(v.graph_position) }),
      id: v.id,
      worldId: v.world_id,
      type: v.type,
      name: v.name,
      summary: v.summary,
      content: v.content,
      tags: json(v.tags),
      visibility: v.visibility,
      status: v.status,
      attributes: json(v.attributes),
      portrait: optional(v.portrait),
      updatedAt: v.updated_at,
    })),
    maps: maps.map((v) => ({
      ...publication(v),
      id: v.id,
      worldId: v.world_id,
      name: v.name,
      summary: v.summary,
      kind: v.kind,
      parentId: optional(v.parent_id),
      seed: Number(v.seed),
      width: v.width,
      height: v.height,
      ...(v.scale_km === null || v.scale_km === undefined ? {} : { scaleKm: Number(v.scale_km) }),
      ...(v.editor_data === null || v.editor_data === undefined
        ? {}
        : { editor: json(v.editor_data) }),
      pins: pins
        .filter((p) => p.map_id === v.id)
        .map((p) => ({
          id: p.id,
          x: p.x,
          y: p.y,
          label: p.label,
          description: p.description,
          kind: p.kind,
          entityId: optional(p.entity_id),
          childMapId: optional(p.child_map_id),
        })),
      strokes: strokes
        .filter((s) => s.map_id === v.id)
        .map((s) => ({
          id: s.id,
          points: json(s.points),
          color: s.color,
          width: s.width,
          tool: s.tool,
        })),
    })),
    relations: relations.map((v) => ({
      ...publication(v),
      id: v.id,
      worldId: v.world_id,
      sourceId: v.source_id,
      targetId: v.target_id,
      label: v.label,
      description: v.description,
      kind: v.kind,
    })),
    plots: plots.map((v) => ({
      ...publication(v),
      ...(v.layout_version == null ? {} : { layoutVersion: v.layout_version }),
      id: v.id,
      worldId: v.world_id,
      name: v.name,
      summary: v.summary,
      nodes: nodes
        .filter((n) => n.plot_id === v.id)
        .map((n) => ({
          id: n.id,
          title: n.title,
          summary: n.summary,
          entityIds: json(n.entity_ids),
          x: n.x,
          y: n.y,
          kind: n.kind,
          status: n.status,
          conditions: json(n.conditions),
          conditionMode: n.condition_mode,
          effects: json(n.effects),
        })),
      edges: edges
        .filter((e) => e.plot_id === v.id)
        .map((e) => ({ id: e.id, source: e.source_id, target: e.target_id, label: e.label })),
    })),
    sessions: sessions.map((v) => ({
      ...publication(v),
      id: v.id,
      worldId: v.world_id,
      title: v.title,
      date: v.session_date,
      content: v.content,
      status: v.status,
    })),
    variables: variables.map((v) => ({
      ...publication(v),
      id: v.id,
      worldId: v.world_id,
      name: v.name,
      value: v.value,
    })),
  };
}

async function insert(
  c: PoolConnection,
  table: string,
  columns: string[],
  values: (string | number | boolean | null | undefined)[],
) {
  await c.execute(
    `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(',')}) VALUES (${values.map(() => '?').join(',')})`,
    values.map((v) => (v === undefined ? null : v)),
  );
}

async function writeData(c: PoolConnection, data: Workspace) {
  // FK-safe replacement is inside the revision-locked transaction; no intermediate state is visible.
  for (const table of [
    'plot_edge',
    'plot_node',
    'plot',
    'map_pin',
    'map_stroke',
    'relation',
    'game_session',
    'state_variable',
    'entity',
  ])
    await c.query(`DELETE FROM \`${table}\``);
  await c.query('UPDATE atlas_map SET parent_id = NULL');
  await c.query('DELETE FROM atlas_map');
  await c.query('DELETE FROM world');
  for (const [i, w] of data.worlds.entries())
    await insert(
      c,
      'world',
      [
        'id',
        'name',
        'subtitle',
        'description',
        'system',
        'created_at',
        'sort_order',
        'entity_templates',
        'entity_types',
      ],
      [
        w.id,
        w.name,
        w.subtitle,
        w.description,
        w.system,
        w.createdAt,
        i,
        w.entityTemplates === undefined ? null : JSON.stringify(w.entityTemplates),
        w.entityTypes === undefined ? null : JSON.stringify(w.entityTypes),
      ],
    );
  for (const [i, e] of data.entities.entries())
    await insert(
      c,
      'entity',
      [
        'id',
        'world_id',
        'type',
        'name',
        'summary',
        'content',
        'tags',
        'visibility',
        'status',
        'attributes',
        'portrait',
        'updated_at',
        'sort_order',
        'created_by',
        'cover',
        'graph_position',
      ],
      [
        e.id,
        e.worldId,
        e.type,
        e.name,
        e.summary,
        e.content,
        JSON.stringify(e.tags),
        e.visibility,
        e.status,
        JSON.stringify(e.attributes),
        e.portrait,
        e.updatedAt,
        i,
        e.createdBy,
        e.cover,
        e.graphPosition ? JSON.stringify(e.graphPosition) : null,
      ],
    );
  for (const [i, m] of data.maps.entries())
    await insert(
      c,
      'atlas_map',
      [
        'id',
        'world_id',
        'name',
        'summary',
        'kind',
        'seed',
        'width',
        'height',
        'sort_order',
        'editor_data',
        'scale_km',
        'created_by',
        'visibility',
      ],
      [
        m.id,
        m.worldId,
        m.name,
        m.summary,
        m.kind,
        m.seed,
        m.width,
        m.height,
        i,
        m.editor ? JSON.stringify(m.editor) : null,
        m.scaleKm ?? null,
        m.createdBy,
        m.visibility,
      ],
    );
  for (const m of data.maps) {
    if (m.parentId)
      await c.execute('UPDATE atlas_map SET parent_id=? WHERE id=?', [m.parentId, m.id]);
    for (const [i, p] of m.pins.entries())
      await insert(
        c,
        'map_pin',
        [
          'id',
          'map_id',
          'x',
          'y',
          'label',
          'description',
          'kind',
          'entity_id',
          'child_map_id',
          'sort_order',
        ],
        [p.id, m.id, p.x, p.y, p.label, p.description, p.kind, p.entityId, p.childMapId, i],
      );
    for (const [i, s] of m.strokes.entries())
      await insert(
        c,
        'map_stroke',
        ['id', 'map_id', 'points', 'color', 'width', 'tool', 'sort_order'],
        [s.id, m.id, JSON.stringify(s.points), s.color, s.width, s.tool, i],
      );
  }
  for (const [i, r] of data.relations.entries())
    await insert(
      c,
      'relation',
      [
        'id',
        'world_id',
        'source_id',
        'target_id',
        'label',
        'description',
        'kind',
        'sort_order',
        'created_by',
        'visibility',
      ],
      [
        r.id,
        r.worldId,
        r.sourceId,
        r.targetId,
        r.label,
        r.description,
        r.kind,
        i,
        r.createdBy,
        r.visibility,
      ],
    );
  for (const [i, p] of data.plots.entries()) {
    await insert(
      c,
      'plot',
      [
        'id',
        'world_id',
        'name',
        'summary',
        'sort_order',
        'created_by',
        'visibility',
        'layout_version',
      ],
      [p.id, p.worldId, p.name, p.summary, i, p.createdBy, p.visibility, p.layoutVersion],
    );
    for (const [j, n] of p.nodes.entries())
      await insert(
        c,
        'plot_node',
        [
          'id',
          'plot_id',
          'title',
          'summary',
          'entity_ids',
          'x',
          'y',
          'kind',
          'status',
          'conditions',
          'condition_mode',
          'effects',
          'sort_order',
        ],
        [
          n.id,
          p.id,
          n.title,
          n.summary,
          JSON.stringify(n.entityIds),
          n.x,
          n.y,
          n.kind,
          n.status,
          JSON.stringify(n.conditions),
          n.conditionMode,
          JSON.stringify(n.effects),
          j,
        ],
      );
    for (const [j, e] of p.edges.entries())
      await insert(
        c,
        'plot_edge',
        ['id', 'plot_id', 'source_id', 'target_id', 'label', 'sort_order'],
        [e.id, p.id, e.source, e.target, e.label, j],
      );
  }
  for (const [i, s] of data.sessions.entries())
    await insert(
      c,
      'game_session',
      [
        'id',
        'world_id',
        'title',
        'session_date',
        'content',
        'status',
        'sort_order',
        'created_by',
        'visibility',
      ],
      [s.id, s.worldId, s.title, s.date, s.content, s.status, i, s.createdBy, s.visibility],
    );
  for (const [i, v] of data.variables.entries())
    await insert(
      c,
      'state_variable',
      ['id', 'world_id', 'name', 'value', 'sort_order', 'created_by', 'visibility'],
      [v.id, v.worldId, v.name, v.value, i, v.createdBy, v.visibility],
    );
}

export class MysqlStore implements WorkspaceStore {
  readonly mode = 'mysql' as const;
  readonly pool: Pool;
  constructor(
    databaseUrl: string,
    private seed: () => Workspace = createSeed,
  ) {
    this.pool = mysql.createPool({
      uri: databaseUrl,
      connectionLimit: 8,
      charset: 'utf8mb4',
      supportBigNumbers: true,
      bigNumberStrings: false,
    });
  }
  async initialize() {
    await ensureSchema(this.pool);
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const [state] = await c.query<RowDataPacket[]>(
        'SELECT * FROM workspace_state WHERE id=1 FOR UPDATE',
      );
      if (!state[0].initialized) {
        const [existing] = await c.query<RowDataPacket[]>('SELECT COUNT(*) AS count FROM world');
        // Never replace an existing database, even when migration metadata was missing.
        if (!Number(existing[0].count)) await writeData(c, validateWorkspace(this.seed()));
        await c.query('UPDATE workspace_state SET initialized=TRUE WHERE id=1');
      }
      await c.commit();
    } catch (err) {
      await c.rollback();
      throw err;
    } finally {
      c.release();
    }
    return this;
  }
  async read(): Promise<WorkspaceEnvelope> {
    const c = await this.pool.getConnection();
    try {
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      await c.beginTransaction();
      const [state] = await c.query<RowDataPacket[]>(
        'SELECT revision FROM workspace_state WHERE id=1',
      );
      const data = await readData(c);
      await c.commit();
      return { data, revision: Number(state[0].revision), mode: this.mode };
    } catch (err) {
      await c.rollback();
      throw err;
    } finally {
      c.release();
    }
  }
  async save(data: Workspace, revision: number): Promise<WorkspaceEnvelope> {
    const checked = validateWorkspace(data);
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const [state] = await c.query<RowDataPacket[]>(
        'SELECT revision FROM workspace_state WHERE id=1 FOR UPDATE',
      );
      if (Number(state[0].revision) !== revision) throw new ConflictError();
      await writeData(c, checked);
      await c.execute('UPDATE workspace_state SET revision=? WHERE id=1', [revision + 1]);
      await c.commit();
      return { data: checked, revision: revision + 1, mode: this.mode };
    } catch (err) {
      await c.rollback();
      throw err;
    } finally {
      c.release();
    }
  }
  async close() {
    await this.pool.end();
  }
  backupDatabase(directory: string) {
    return snapshotMysql(this.pool, directory);
  }
}

export async function createStore(config: AppConfig): Promise<WorkspaceStore> {
  if (config.databaseUrl) return new MysqlStore(config.databaseUrl).initialize();
  if (config.production) throw new Error('Demo storage is forbidden in production.');
  return new DemoStore(path.join(config.dataDir, 'demo-workspace.json')).initialize();
}
