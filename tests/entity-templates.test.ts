import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSeed } from '../shared/seed';
import { entityTemplates, type EntityType, type World } from '../shared/model';
import {
  applyEntityTemplate,
  getEntityTemplate,
  orderedEntityAttributes,
  entityAttributeEntries,
  type TemplateFieldDraft,
} from '../shared/entity-templates';
import { validateWorkspace } from '../server/validation';
import { SqliteStore } from '../server/sqlite-store';
import { ConflictError } from '../server/store';
import { newEntity } from '../shared/entity-templates';
import { exportMarkdown, type ExportOptions } from '../src/lib/export';
const fields = (world: World, type: EntityType): TemplateFieldDraft[] =>
  getEntityTemplate(world, type).map((name, i) => ({ id: `field_${i}`, name, originalName: name }));

test('numeric field names follow template order in the editor and Markdown', () => {
  const data = createSeed();
  const world = data.worlds[0];
  const entity = data.entities.find((item) => item.type === 'character')!;
  world.entityTemplates = { character: ['2', '1'] };
  entity.attributes = { '1': '第一项', '2': '第二项' };
  assert.deepEqual(entityAttributeEntries(entity, world), [
    ['2', '第二项'],
    ['1', '第一项'],
  ]);
  const markdown = exportMarkdown(data, {
    worldId: world.id,
    entityIds: [entity.id],
    includeMaps: false,
    includeRelations: false,
    includePlots: false,
    includeSessions: false,
    includeSecrets: true,
  });
  assert(markdown.indexOf('### 2') < markdown.indexOf('### 1'));
});

test('templates inherit old defaults, honor empty overrides and initialize new records by world and type', () => {
  const world = createSeed().worlds[0];
  assert.deepEqual(getEntityTemplate(world, 'character'), entityTemplates.character);
  world.entityTemplates = { character: ['外貌描写', '信仰'], religion: [] };
  assert.deepEqual(newEntity(world.id, 'character', world).attributes, { 外貌描写: '', 信仰: '' });
  assert.deepEqual(newEntity(world.id, 'religion', world).attributes, {});
  assert.deepEqual(
    newEntity(world.id, 'location', world).attributes,
    Object.fromEntries(entityTemplates.location.map((name) => [name, ''])),
  );
  assert.deepEqual(
    orderedEntityAttributes(
      { ...newEntity(world.id, 'character', world), attributes: { 口头禅: '月色很好' } },
      world,
    ),
    { 外貌描写: '', 信仰: '', 口头禅: '月色很好' },
  );
});

test('template rename, removal and ordering preserve authored values without touching other worlds or types', () => {
  const data = createSeed();
  const world = data.worlds[0];
  const character = data.entities.find((entity) => entity.type === 'character')!;
  character.attributes = {
    '身份 / 职业': '巡林人',
    外貌特征: '银发',
    年龄: '23',
    弱点与恐惧: '害怕深水',
    能力与属性: '',
  };
  const other = { ...character, id: 'another_world_person', worldId: 'another_world' };
  data.worlds.push({ ...world, id: 'another_world' });
  data.entities.push(other);
  const original = structuredClone(data);
  const updated = applyEntityTemplate(data, world.id, 'character', [
    { id: 'appearance', originalName: '外貌特征', name: '外貌描写' },
    { id: 'faith', name: '信仰' },
    { id: 'job', originalName: '身份 / 职业', name: '身份 / 职业' },
  ]);
  assert.deepEqual(data, original);
  const target = updated.entities.find((entity) => entity.id === character.id)!;
  assert.deepEqual(Object.keys(target.attributes), [
    '外貌描写',
    '信仰',
    '身份 / 职业',
    '年龄',
    '弱点与恐惧',
  ]);
  assert.equal(target.attributes.外貌描写, '银发');
  assert.equal(target.attributes['弱点与恐惧'], '害怕深水');
  assert(!Object.hasOwn(target.attributes, '外貌特征'));
  assert(!Object.hasOwn(target.attributes, '能力与属性'));
  assert.equal(
    updated.entities.find((entity) => entity.id === other.id),
    other,
  );
  assert.equal(
    updated.entities.find((entity) => entity.type === 'location'),
    data.entities.find((entity) => entity.type === 'location'),
  );
  assert.equal(updated.worlds[1], data.worlds[1]);
  assert.doesNotThrow(() => validateWorkspace(updated));
});

test('template swaps are lossless and collisions, invalid names, stale origins and capacity fail atomically', () => {
  const data = createSeed();
  const world = data.worlds[0];
  world.entityTemplates = { character: ['甲', '乙'] };
  const entity = data.entities.find((item) => item.type === 'character')!;
  entity.attributes = { 甲: '内容甲', 乙: '内容乙', 私人档案: '不要覆盖' };
  const swapped = applyEntityTemplate(data, world.id, 'character', [
    { id: 'a', originalName: '甲', name: '乙' },
    { id: 'b', originalName: '乙', name: '甲' },
  ]);
  assert.deepEqual(swapped.entities.find((item) => item.id === entity.id)!.attributes, {
    乙: '内容甲',
    甲: '内容乙',
    私人档案: '不要覆盖',
  });
  const original = structuredClone(data);
  assert.throws(
    () =>
      applyEntityTemplate(data, world.id, 'character', [
        { id: 'a', originalName: '甲', name: '私人档案' },
      ]),
    /已有不同内容/,
  );
  for (const name of ['', '__proto__', 'constructor', '多\n行', 'a'.repeat(201)])
    assert.throws(() => applyEntityTemplate(data, world.id, 'character', [{ id: 'x', name }]));
  assert.throws(
    () =>
      applyEntityTemplate(data, world.id, 'character', [
        { id: 'x', name: ' 信仰 ' },
        { id: 'y', name: '信仰' },
      ]),
    /重复/,
  );
  assert.throws(
    () =>
      applyEntityTemplate(data, world.id, 'character', [
        { id: 'x', originalName: '不存在', name: '新项' },
      ]),
    /模板已变化/,
  );
  assert.throws(
    () =>
      applyEntityTemplate(
        data,
        world.id,
        'character',
        Array.from({ length: 101 }, (_, i) => ({ id: String(i), name: '字段' + i })),
      ),
    /100/,
  );
  assert.deepEqual(data, original);
});

test('strict workspace validation rejects malformed templates and keeps old backups unchanged', () => {
  const legacy = createSeed();
  assert.deepEqual(validateWorkspace(legacy), legacy);
  for (const templates of [
    { character: ['重复', '重复'] },
    { character: [' 字段'] },
    { character: ['__proto__'] },
    { character: Array(101).fill('字段') },
    { unsupported: [] },
  ]) {
    const data = structuredClone(legacy);
    (data.worlds[0] as unknown as { entityTemplates: unknown }).entityTemplates = templates;
    assert.throws(() => validateWorkspace(data));
  }
});

test('SQLite stores templates with record changes, restores empty definitions and protects revision conflicts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worldloom-template-'));
  const filename = path.join(directory, 'worldloom.sqlite');
  let store = await new SqliteStore(filename).initialize();
  try {
    const data = createSeed();
    let updated = applyEntityTemplate(data, data.worlds[0].id, 'character', [
      ...fields(data.worlds[0], 'character'),
      { id: 'faith', name: '信仰' },
    ]);
    updated = applyEntityTemplate(updated, data.worlds[0].id, 'religion', []);
    await store.save(updated, 0);
    await assert.rejects(store.save(data, 0), ConflictError);
    await store.close();
    store = await new SqliteStore(filename).initialize();
    assert.deepEqual((await store.read()).data, updated);
    assert.deepEqual((await store.read()).data.worlds[0].entityTemplates?.religion, []);
    assert.deepEqual(JSON.parse(JSON.stringify(updated)), updated);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('GM Markdown exports selected custom definitions and authored values while public output respects its scope', () => {
  const data = createSeed();
  const world = data.worlds[0];
  const person = data.entities.find(
    (entity) => entity.type === 'character' && entity.visibility === 'public',
  )!;
  const updated = applyEntityTemplate(data, world.id, 'character', [
    { id: 'appearance', name: '外貌描写' },
    { id: 'faith', name: '信仰' },
  ]);
  updated.entities.find((entity) => entity.id === person.id)!.attributes.信仰 = '星海之母';
  const options: ExportOptions = {
    worldId: world.id,
    entityIds: [person.id],
    includeMaps: false,
    includeRelations: false,
    includePlots: false,
    includeSessions: false,
    includeSecrets: true,
  };
  const gm = exportMarkdown(updated, options);
  assert(gm.includes('## 自定义字段模板'));
  assert(gm.includes('- 外貌描写'));
  assert.match(gm, /### 信仰\s+星海之母/);
  const publicText = exportMarkdown(updated, { ...options, includeSecrets: false });
  assert(!publicText.includes('## 自定义字段模板'));
  assert.match(publicText, /### 信仰\s+星海之母/);
});
