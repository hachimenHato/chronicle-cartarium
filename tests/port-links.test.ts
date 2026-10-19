import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSeed } from '../shared/seed';
import { ownerAccount, type UserAccount } from '../shared/access';
import { clearMapEntityLinks, saveEntityInWorkspace } from '../shared/workspace-mutations';
import { addGeographicFixture } from './fixtures/geographic';
import { validateWorkspace } from '../server/validation';
import { SqliteStore } from '../server/sqlite-store';
import { visibleWorkspace, mergeAuthorizedWorkspace, PermissionError } from '../server/permissions';
import { preserveGeographicNames } from '../src/lib/geographic-edits';
import { exportMarkdown } from '../src/lib/export';

function fixture() {
  const data = addGeographicFixture(createSeed());
  const map = data.maps[0],
    editor = map.editor!,
    geo = editor.generated!.geography!;
  const secret = data.entities.find((entity) => entity.id === 'geo_secret_area')!;
  const open = { ...secret, id: 'public_port_page', name: '白帆港', visibility: 'public' as const };
  data.entities.push(open);
  delete geo.ports[0].settlementId;
  delete geo.ports[1].settlementId;
  Object.assign(geo.ports[0], { entityId: secret.id, name: '秘灯港' });
  Object.assign(geo.ports[1], { entityId: open.id, name: open.name });
  geo.seaRoutes[0].name = '秘灯商船航线';
  map.pins.push({
    id: 'private_port_pin',
    label: '秘密锚地',
    description: '',
    kind: 'city',
    x: 750,
    y: 300,
    entityId: secret.id,
  });
  editor.hiddenFeatures = {
    settlements: ['private_port_pin', 'city_0'],
    ports: ['geo_port_1'],
    roads: ['hand_drawn_road'],
    seaRoutes: ['geo_sea_route_0'],
  };
  map.strokes.push({
    id: 'hand_drawn_road',
    tool: 'road',
    color: '#654321',
    width: 2,
    points: [
      { x: 300, y: 200 },
      { x: 400, y: 300 },
    ],
  });
  return validateWorkspace(data);
}
const reader = (): UserAccount => ({
  ...ownerAccount('港口编辑者'),
  id: 'port_editor',
  role: 'user',
  canExport: false,
  canViewPrivate: false,
  grants: { maps: { create: true, update: 'any', delete: 'none' } },
});
const geography = (data: ReturnType<typeof fixture>) => data.maps[0].editor!.generated!.geography!;

test('independent coastal ports and individual display flags survive SQLite and do not require settlements', async (t) => {
  const data = fixture();
  delete data.maps[0].editor!.generated!.sites;
  assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(data))), data);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cartarium-ports-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'ports.sqlite');
  let store = await new SqliteStore(filename).initialize();
  await store.save(data, 0);
  await store.close();
  store = await new SqliteStore(filename).initialize();
  try {
    assert.deepEqual((await store.read()).data, data);
  } finally {
    await store.close();
  }
  for (const id of [
    'missing_page',
    data.entities.find((entity) => entity.type === 'faction')!.id,
  ]) {
    const invalid = structuredClone(data);
    geography(invalid).ports[1].entityId = id;
    assert.throws(() => validateWorkspace(invalid));
  }
  const foreign = structuredClone(data);
  foreign.worlds.push({ ...foreign.worlds[0], id: 'port_other_world' });
  foreign.entities.find((entity) => entity.id === 'public_port_page')!.worldId = 'port_other_world';
  assert.throws(() => validateWorkspace(foreign), /cross-world entity reference/);
  const conflicting = fixture();
  geography(conflicting).ports[1].settlementId = 'town_0';
  assert.throws(() => validateWorkspace(conflicting), /聚落港口共用所属聚落的关联/);
  const duplicate = fixture();
  duplicate.maps[0].editor!.hiddenFeatures!.ports = ['geo_port_1', 'geo_port_1'];
  assert.throws(() => validateWorkspace(duplicate), /隐藏项不能重复/);
});

test('private standalone port names, pages and route names are redacted without removing navigable geometry', () => {
  const data = fixture(),
    actor = reader(),
    shown = visibleWorkspace(data, actor);
  const encoded = JSON.stringify(shown);
  for (const secret of ['秘灯港', '秘灯商船航线', 'geo_secret_area', 'private_port_pin'])
    assert(!encoded.includes(secret), secret);
  assert.equal(geography(shown).ports[0].name, '未公开港口');
  assert.equal(geography(shown).ports[0].entityId, undefined);
  assert.deepEqual(geography(shown).ports[0].harbor, geography(data).ports[0].harbor);
  assert.deepEqual(geography(shown).seaRoutes[0].points, geography(data).seaRoutes[0].points);
  geography(shown).ports[1].name = '新白帆港';
  shown.maps[0].editor!.hiddenFeatures!.roads = [];
  const saved = mergeAuthorizedWorkspace(data, shown, actor);
  assert.equal(geography(saved).ports[1].name, '新白帆港');
  assert.deepEqual(geography(saved).ports[0], geography(data).ports[0]);
  assert.deepEqual(geography(saved).seaRoutes[0], geography(data).seaRoutes[0]);
  assert(saved.maps[0].editor!.hiddenFeatures!.settlements!.includes('private_port_pin'));
  assert.deepEqual(saved.maps[0].editor!.hiddenFeatures!.roads, []);
  assert.doesNotThrow(() => validateWorkspace(saved));
  actor.records.geo_secret_area = { read: true };
  assert.equal(geography(visibleWorkspace(data, actor)).ports[0].name, '秘灯港');
});

test('ordinary map editing cannot change private ports, regenerate them or attach a guessed private page', () => {
  const data = fixture(),
    actor = reader();
  // Keep the port as the only private geography reference so its protection is
  // independent from the existing private area/division safeguards.
  delete geography(data).areas[2].entityId;
  geography(data).areas[2].name = '公开地区';
  delete geography(data).divisions[1].entityId;
  geography(data).divisions[1].name = '公开国度';
  const mutations: ((shown: ReturnType<typeof fixture>) => void)[] = [
    (shown) => {
      geography(shown).ports[0].name = '擅自修改';
    },
    (shown) => {
      geography(shown).ports[0].center.x -= 10;
    },
    (shown) => {
      geography(shown).ports.splice(0, 1);
      geography(shown).seaRoutes = [];
    },
    (shown) => {
      geography(shown).ports[1].entityId = 'geo_secret_area';
    },
    (shown) => {
      geography(shown).seaRoutes[0].name = '擅改的航路';
    },
    (shown) => {
      shown.maps[0].editor!.generated!.signature = 'fedcba0987654321-20';
    },
    (shown) => {
      delete shown.maps[0].editor!.generated;
    },
    (shown) => {
      delete shown.maps[0].editor;
    },
    (shown) => {
      shown.maps[0].editor!.hiddenFeatures!.settlements!.push('private_port_pin');
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const shown = visibleWorkspace(data, actor);
    mutate(shown);
    assert.throws(
      () => mergeAuthorizedWorkspace(data, shown, actor),
      PermissionError,
      `mutation ${index}`,
    );
  }
});

test('standalone port names and associations survive regeneration, page rename and authorized link cleanup', () => {
  const data = fixture(),
    open = data.entities.find((entity) => entity.id === 'public_port_page')!;
  const next = structuredClone(geography(data));
  delete next.ports[1].entityId;
  next.ports[1].name = '随机新名字';
  assert.deepEqual(
    preserveGeographicNames(next, geography(data)).ports[1],
    geography(data).ports[1],
  );
  const renamed = saveEntityInWorkspace(data, { ...open, name: '月帆港' });
  assert.equal(geography(renamed).ports[1].name, '月帆港');
  const custom = fixture();
  geography(custom).ports[1].name = '独立自定义港名';
  assert.equal(
    geography(saveEntityInWorkspace(custom, { ...open, name: '月帆港' })).ports[1].name,
    '独立自定义港名',
  );
  const cleaned = clearMapEntityLinks(data.maps[0], new Set(['public_port_page']));
  assert.equal(cleaned.editor!.generated!.geography!.ports[1].entityId, undefined);
  assert.strictEqual(
    cleaned.editor!.generated!.elevation,
    data.maps[0].editor!.generated!.elevation,
  );
  const actor = reader();
  actor.records.public_port_page = { read: true, delete: true };
  actor.grants.maps = { create: false, update: 'none', delete: 'none' };
  const forbidden = visibleWorkspace(data, actor);
  forbidden.entities = forbidden.entities.filter((entity) => entity.id !== 'public_port_page');
  assert.throws(
    () => mergeAuthorizedWorkspace(data, forbidden, actor),
    /仍被没有修改权限的内容引用/,
  );
  const moderator: UserAccount = { ...ownerAccount(), role: 'moderator' };
  const removed = visibleWorkspace(data, moderator);
  removed.entities = removed.entities.filter((entity) => entity.id !== 'public_port_page');
  assert.equal(
    geography(mergeAuthorizedWorkspace(data, removed, moderator)).ports[1].entityId,
    undefined,
  );
});

test('Markdown keeps hidden map content and standalone port links while excluding private ports and their routes', () => {
  const data = fixture(),
    options = {
      worldId: data.worlds[0].id,
      entityIds: ['public_port_page'],
      includeMaps: true,
      includeRelations: false,
      includePlots: false,
      includeSessions: false,
      includeSecrets: false,
    };
  const markdown = exportMarkdown(data, options);
  assert(markdown.includes('港口 **白帆港**：独立沿海港口；关联档案 [白帆港](#public_port_page)'));
  assert(markdown.includes('港口位置 (760, 500)；地图中已隐藏'));
  assert(markdown.includes('道路 **手绘道路**：位置 (400, 300)；地图中已隐藏'));
  assert(!markdown.includes('秘灯港'));
  assert(!markdown.includes('秘灯商船航线'));
  const full = exportMarkdown(data, { ...options, includeSecrets: true });
  assert(full.includes('秘灯港'));
  assert(full.includes('秘灯商船航线'));
  assert(full.includes('地图中已隐藏'));
});
