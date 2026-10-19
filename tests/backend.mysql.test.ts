import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { createSeed } from '../shared/seed';
import { MysqlStore, ConflictError, ensureSchema } from '../server/store';
import { createEditorFixture } from './fixtures/map-editor';
import { addGeographicFixture } from './fixtures/geographic';
import { createElevationFixture } from './fixtures/elevation';
import { InstallationManager, InstallationError } from '../server/installation';
import { readConfig } from '../server/config';
import { RESET_CONFIRMATION } from '../shared/application';
import { getEntityTypes } from '../shared/entity-types';

test(
  'MySQL installation creates a fresh isolated database, preserves refused existing names and resets with a backup',
  { skip: process.env.MYSQL_INTEGRATION !== '1' },
  async () => {
    assert(process.env.DATABASE_URL);
    const source = new URL(process.env.DATABASE_URL);
    const admin = await mysql.createConnection({
      host: source.hostname,
      port: Number(source.port || 3306),
      user: decodeURIComponent(source.username),
      password: decodeURIComponent(source.password),
    });
    const directory = await mkdtemp(path.join(os.tmpdir(), 'worldloom-mysql-install-'));
    const database = `worldloom_test_install_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const config = readConfig({ DATA_DIR: directory });
    const manager = await InstallationManager.open(config);
    let created = false;
    try {
      const [existing] = await admin.query<mysql.RowDataPacket[]>(
        'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',
        [database],
      );
      assert.equal(existing.length, 0);
      await manager.install({
        storage: 'mysql',
        title: '数据库安装验证',
        theme: 'parchment',
        access: 'local',
        username: 'gm',
        password: 'mysql-test-password-2026',
        fillExample: true,
        mysql: {
          host: source.hostname,
          port: Number(source.port || 3306),
          username: decodeURIComponent(source.username),
          password: decodeURIComponent(source.password),
          database,
        },
      });
      created = true;
      const before = await manager.read();
      assert.equal(before.mode, 'mysql');
      assert(before.data.entities.length >= 85);
      const otherDirectory = await mkdtemp(path.join(os.tmpdir(), 'worldloom-mysql-refusal-'));
      const other = await InstallationManager.open(readConfig({ DATA_DIR: otherDirectory }));
      try {
        await assert.rejects(
          other.install({
            storage: 'mysql',
            title: '拒绝现有库',
            theme: 'parchment',
            access: 'local',
            username: 'gm',
            password: 'mysql-test-password-2026',
            fillExample: false,
            mysql: {
              host: source.hostname,
              port: Number(source.port || 3306),
              username: decodeURIComponent(source.username),
              password: decodeURIComponent(source.password),
              database,
            },
          }),
          InstallationError,
        );
        assert.equal((await manager.read()).revision, before.revision);
      } finally {
        await other.close();
        await rm(otherDirectory, { recursive: true, force: true });
      }
      await import('node:fs/promises').then((fs) =>
        fs.mkdir(path.join(directory, 'uploads'), { recursive: true }),
      );
      const reset = await manager.reset({
        confirmation: RESET_CONFIRMATION,
        fillExample: false,
        revision: before.revision,
      });
      assert.equal(reset.envelope.data.worlds.length, 0);
      const backup = JSON.parse(
        await readFile(path.join(directory, 'backups', reset.backup, 'workspace.json'), 'utf8'),
      );
      assert.equal(backup.data.entities.length, before.data.entities.length);
      const [state] = await admin.query<mysql.RowDataPacket[]>(
        `SELECT revision FROM \`${database}\`.workspace_state WHERE id=1`,
      );
      assert.equal(Number(state[0].revision), before.revision + 1);
    } finally {
      await manager.close();
      if (created) await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

// Opt-in only. Creates and removes its own fresh database, never writes to DATABASE_URL's database.
test(
  'MySQL migration, relational round-trip, concurrency and restart durability',
  { skip: process.env.MYSQL_INTEGRATION !== '1' },
  async () => {
    assert(process.env.DATABASE_URL, 'DATABASE_URL is required for opt-in integration tests');
    const source = new URL(process.env.DATABASE_URL);
    const admin = await mysql.createConnection({
      host: source.hostname,
      port: Number(source.port || 3306),
      user: decodeURIComponent(source.username),
      password: decodeURIComponent(source.password),
      connectTimeout: 15_000,
    });
    const database = `worldloom_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
    let created = false;
    let store: MysqlStore | undefined;
    try {
      const [existing] = await admin.query<mysql.RowDataPacket[]>(
        'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',
        [database],
      );
      assert.equal(existing.length, 0, 'Refuse to reuse an existing database');
      await admin.query(
        `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
      );
      created = true;
      source.pathname = `/${database}`;
      store = await new MysqlStore(source.toString()).initialize();
      const first = await store.read();
      assert.equal(first.mode, 'mysql');
      assert.equal(first.revision, 0);
      assert.deepEqual(
        JSON.parse(JSON.stringify(first.data)),
        JSON.parse(JSON.stringify(createSeed())),
      );
      const [tables] = await store.pool.query<mysql.RowDataPacket[]>('SHOW TABLES');
      assert.equal(tables.length, 13);
      const updated = structuredClone(first.data);
      updated.worlds[0].description = 'MySQL integration test only';
      updated.worlds[0].entityTemplates = { character: ['外貌描写', '信仰'], religion: [] };
      updated.worlds[0].entityTypes = [
        ...getEntityTypes(),
        { id: 'custom_guild', name: '行会任务', description: '新增分类' },
      ];
      updated.entities[0].createdBy = 'owner';
      updated.entities[0].cover = '/uploads/mysql-cover.png';
      updated.entities[1].cover = '/covers/moon-town.png';
      updated.entities[0].graphPosition = { x: 875, y: 332 };
      updated.plots[0].layoutVersion = 1;
      updated.plots[0].createdBy = 'owner';
      updated.plots[0].visibility = 'public';
      addGeographicFixture(updated);
      const mapEditor = updated.maps[0].editor!;
      updated.maps[0].scaleKm = 12000;
      mapEditor.divisions = [
        {
          id: 'mysql_division',
          kind: 'country',
          name: '数据库领地',
          entityId: updated.entities.find((e) => e.type === 'faction')!.id,
          color: '#a36550',
          visible: true,
        },
      ];
      mapEditor.divisionPaint = [
        {
          id: 'mysql_border',
          divisionId: 'mysql_division',
          geometry: 'polygon',
          operation: 'paint',
          points: [
            { x: 20, y: 30 },
            { x: 120, y: 40 },
            { x: 90, y: 160 },
          ],
          width: 5,
          roughness: 0.3,
          seed: 81,
        },
      ];
      if (mapEditor.generation?.version === 2) {
        mapEditor.generation.geography!.sketchMode = 'strict';
        Object.assign(mapEditor.generation.geography!, {
          latitudeNorth: 47,
          latitudeSouth: 33,
          longitudeWest: 169,
          longitudeEast: -171,
        });
        mapEditor.generation.geography!.source = 'sketch';
        const locationId = updated.entities.find(
          (entity) => entity.type === 'location' && entity.visibility === 'public',
        )!.id;
        mapEditor.generation.settlementLinks = { city_0: locationId };
        mapEditor.generated!.sites![0].entityId = locationId;
        const independentPort = mapEditor.generated!.geography!.ports[1];
        delete independentPort.settlementId;
        independentPort.entityId = locationId;
        independentPort.name = '数据库独立海港';
        mapEditor.hiddenFeatures = {
          settlements: ['city_0'],
          ports: [independentPort.id],
          roads: ['generated_road_1'],
          seaRoutes: [mapEditor.generated!.geography!.seaRoutes[0].id],
        };
        const elevation = createElevationFixture();
        elevation.strokes[0].width = 5;
        mapEditor.generation.elevation = elevation;
      }
      const saves = await Promise.allSettled([store.save(updated, 0), store.save(updated, 0)]);
      assert.equal(saves.filter((s) => s.status === 'fulfilled').length, 1);
      assert(saves.some((s) => s.status === 'rejected' && s.reason instanceof ConflictError));
      await ensureSchema(store.pool);
      await store.close();
      store = await new MysqlStore(source.toString()).initialize();
      assert.equal((await store.read()).data.worlds[0].description, 'MySQL integration test only');
      assert.equal((await store.read()).revision, 1);
      assert.deepEqual((await store.read()).data.maps[0].editor, updated.maps[0].editor);
      assert.equal((await store.read()).data.maps[0].scaleKm, 12000);
      const restored = (await store.read()).data;
      assert.deepEqual(restored.worlds[0].entityTypes, updated.worlds[0].entityTypes);
      assert.equal(restored.entities[0].cover, updated.entities[0].cover);
      assert.equal(restored.entities[1].cover, updated.entities[1].cover);
      assert.equal(restored.entities[0].createdBy, 'owner');
      assert.deepEqual(restored.entities[0].graphPosition, { x: 875, y: 332 });
      assert.equal(restored.plots[0].layoutVersion, 1);
      assert.equal(restored.plots[0].visibility, 'public');
      const restoredRecipe = restored.maps[0].editor!.generation;
      assert(restoredRecipe?.version === 2);
      assert.equal(restoredRecipe.geography!.sketchMode, 'strict');
      assert.equal(restoredRecipe.geography!.longitudeWest, 169);
      assert.equal(restoredRecipe.geography!.longitudeEast, -171);
      assert.equal(
        restoredRecipe.settlementLinks!.city_0,
        restored.maps[0].editor!.generated!.sites![0].entityId,
      );
      const restoredMapEditor = restored.maps[0].editor!;
      assert.equal(restoredMapEditor.generated!.geography!.ports[1].settlementId, undefined);
      assert.equal(
        restoredMapEditor.generated!.geography!.ports[1].entityId,
        restoredRecipe.settlementLinks!.city_0,
      );
      assert.equal(restoredMapEditor.generated!.geography!.ports[1].name, '数据库独立海港');
      assert.deepEqual(restoredMapEditor.hiddenFeatures, mapEditor.hiddenFeatures);
      const [scaleRows] = await store.pool.query<mysql.RowDataPacket[]>(
        'SELECT scale_km FROM atlas_map WHERE id=?',
        [updated.maps[0].id],
      );
      assert.equal(Number(scaleRows[0].scale_km), 12000);
      const [heightRows] = await store.pool.execute<mysql.RowDataPacket[]>(
        "SELECT JSON_LENGTH(editor_data, '$.generation.elevation.strokes') AS stroke_count, JSON_EXTRACT(editor_data, '$.generation.elevation.strokes[2].target') AS flatten_target FROM atlas_map WHERE id=?",
        [updated.maps[0].id],
      );
      assert.equal(Number(heightRows[0].stroke_count), 4);
      assert.equal(Number(heightRows[0].flatten_target), 1500);
      assert.deepEqual(
        (await store.read()).data.maps.slice(1),
        first.data.maps.slice(1),
        'Saving height edits must not inject elevation into legacy maps',
      );
      const largeWorkspace = structuredClone(updated);
      // IDs run opposite to authored ordering, with enough rows to distinguish
      // numeric sort_order (2 before 10) from string or primary-key sorting.
      for (let index = 0; index < 12; index++) {
        const id = `large_map_${String(11 - index).padStart(2, '0')}`;
        const editor = createEditorFixture();
        editor.regions = [];
        editor.objects = Array.from({ length: 24 }, (_, objectIndex) => ({
          ...editor.objects[1],
          id: `${id}_path_${objectIndex}`,
          points: Array.from({ length: 2000 }, (_, pointIndex) => ({
            x: (pointIndex * 17) % 1000,
            y: (pointIndex * 13) % 640,
          })),
        }));
        largeWorkspace.maps.push({
          id,
          worldId: largeWorkspace.worlds[0].id,
          name: `大地图 ${index}`,
          summary: '',
          kind: 'world',
          seed: index,
          width: 1000,
          height: 640,
          ...(index === 0 || index === 11 ? { editor } : {}),
          pins: ['z', 'a'].map((suffix) => ({
            id: `${id}_pin_${suffix}`,
            x: 50,
            y: 50,
            label: suffix,
            description: '',
            kind: 'note' as const,
          })),
          strokes: ['z', 'a'].map((suffix) => ({
            id: `${id}_stroke_${suffix}`,
            points: [{ x: 30, y: 40 }],
            color: '#123456',
            width: 3,
            tool: 'brush' as const,
          })),
        });
      }
      largeWorkspace.entities.reverse();
      largeWorkspace.plots.forEach((plot) => {
        plot.nodes.reverse();
        plot.edges.reverse();
      });
      assert(Buffer.byteLength(JSON.stringify(largeWorkspace.maps.at(-1)?.editor)) > 800_000);
      await store.save(largeWorkspace, 1);
      await store.close();
      store = await new MysqlStore(source.toString()).initialize();
      // This fresh store has one connection after initialize; acquiring and
      // releasing it configures only this test's next read, never GLOBAL state.
      const reader = await store.pool.getConnection();
      try {
        await reader.query('SET SESSION sort_buffer_size = 32768');
        const [settings] = await reader.query<mysql.RowDataPacket[]>(
          'SELECT @@SESSION.sort_buffer_size AS bytes',
        );
        assert.equal(Number(settings[0].bytes), 32768);
      } finally {
        reader.release();
      }
      const largeRestored = await store.read();
      assert.equal(largeRestored.revision, 2);
      assert.deepEqual(
        JSON.parse(JSON.stringify(largeRestored.data)),
        JSON.parse(JSON.stringify(largeWorkspace)),
        'Large JSON maps and every authored/nested order must survive a read with a small SQL sort buffer',
      );
      const empty = {
        worlds: [],
        entities: [],
        maps: [],
        relations: [],
        plots: [],
        sessions: [],
        variables: [],
      };
      await store.save(empty, 2);
      await store.close();
      store = await new MysqlStore(source.toString()).initialize();
      assert.deepEqual(
        (await store.read()).data,
        empty,
        'An intentionally empty workspace must not be reseeded',
      );
    } finally {
      if (store) await store.close();
      // The name is locally generated, checked absent, and only removed after our CREATE succeeded.
      if (created) await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
    }
  },
);

test(
  'MySQL version-1 upgrade preserves maps and revision, and resumes after interrupted DDL',
  { skip: process.env.MYSQL_INTEGRATION !== '1' },
  async () => {
    assert(process.env.DATABASE_URL, 'DATABASE_URL is required for opt-in integration tests');
    const source = new URL(process.env.DATABASE_URL);
    const admin = await mysql.createConnection({
      host: source.hostname,
      port: Number(source.port || 3306),
      user: decodeURIComponent(source.username),
      password: decodeURIComponent(source.password),
      connectTimeout: 15_000,
    });
    const database = `worldloom_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
    let created = false;
    let store: MysqlStore | undefined;
    try {
      const [existing] = await admin.query<mysql.RowDataPacket[]>(
        'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',
        [database],
      );
      assert.equal(existing.length, 0, 'Refuse to reuse an existing database');
      await admin.query(
        `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
      );
      created = true;
      source.pathname = `/${database}`;
      store = new MysqlStore(source.toString());
      const v1 = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
      for (const statement of v1
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await store.pool.query(statement);
      const [beforeColumn] = await store.pool.query<mysql.RowDataPacket[]>(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='atlas_map' AND COLUMN_NAME='editor_data'",
      );
      assert.equal(beforeColumn.length, 0, 'The fixture must be a real version-1 schema');
      await store.pool.execute(
        'INSERT INTO world(id,name,subtitle,description,`system`,created_at,sort_order) VALUES (?,?,?,?,?,?,?)',
        ['legacy_world', '旧世界', '', '需要保留的旧资料', '自定义', '2026-09-22T00:00:00.000Z', 0],
      );
      await store.pool.execute(
        'INSERT INTO atlas_map(id,world_id,name,summary,kind,seed,width,height,sort_order) VALUES (?,?,?,?,?,?,?,?,?)',
        ['legacy_map', 'legacy_world', '旧地图', '原始说明', 'world', 913, 1000, 640, 0],
      );
      await store.pool.execute(
        'INSERT INTO map_pin(id,map_id,x,y,label,description,kind,sort_order) VALUES (?,?,?,?,?,?,?,?)',
        ['legacy_pin', 'legacy_map', 24, 36, '旧注记', '不可丢失', 'note', 0],
      );
      await store.pool.execute(
        'INSERT INTO map_stroke(id,map_id,points,color,width,tool,sort_order) VALUES (?,?,?,?,?,?,?)',
        [
          'legacy_stroke',
          'legacy_map',
          JSON.stringify([
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ]),
          '#346',
          3,
          'brush',
          0,
        ],
      );
      await store.pool.query('UPDATE workspace_state SET revision=23, initialized=TRUE WHERE id=1');
      const original = await store.read();
      assert.equal(original.data.maps[0].editor, undefined);
      await store.initialize();
      assert.deepEqual(
        await store.read(),
        original,
        'Upgrade must not rewrite existing map content or revision',
      );
      const [versions] = await store.pool.query<mysql.RowDataPacket[]>(
        'SELECT version FROM schema_migrations ORDER BY version',
      );
      assert.deepEqual(
        versions.map((v) => v.version),
        [1, 2, 3, 4, 5],
      );
      const next = structuredClone(original.data);
      next.maps[0].editor = createEditorFixture();
      await store.save(next, 23);
      // This reproduces the durable state of a crash after ALTER but before the
      // version record. Only this test's freshly-created database is changed.
      await store.pool.query('DELETE FROM schema_migrations WHERE version=2');
      await store.pool.query('DELETE FROM schema_migrations WHERE version=3');
      await store.pool.query('DELETE FROM schema_migrations WHERE version=4');
      await ensureSchema(store.pool);
      await ensureSchema(store.pool);
      const [resumedScale] = await store.pool.query<mysql.RowDataPacket[]>(
        'SELECT version FROM schema_migrations WHERE version=3',
      );
      assert.equal(resumedScale.length, 1);
      const [resumedTemplates] = await store.pool.query<mysql.RowDataPacket[]>(
        'SELECT version FROM schema_migrations WHERE version=4',
      );
      assert.equal(resumedTemplates.length, 1);
      const restored = await store.read();
      assert.equal(restored.revision, 24);
      assert.deepEqual(JSON.parse(JSON.stringify(restored.data)), JSON.parse(JSON.stringify(next)));
      const [recorded] = await store.pool.query<mysql.RowDataPacket[]>(
        'SELECT version FROM schema_migrations WHERE version=2',
      );
      assert.equal(recorded.length, 1);
    } finally {
      if (store) await store.close();
      if (created) await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
    }
  },
);
