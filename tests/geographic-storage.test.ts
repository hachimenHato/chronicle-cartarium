import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSeed } from '../shared/seed';
import { ownerAccount, type UserAccount } from '../shared/access';
import { saveEntityInWorkspace } from '../shared/workspace-mutations';
import { validateWorkspace } from '../server/validation';
import { visibleWorkspace, mergeAuthorizedWorkspace, PermissionError } from '../server/permissions';
import { SqliteStore } from '../server/sqlite-store';
import { DemoStore } from '../server/store';
import { exportMarkdown } from '../src/lib/export';
import { addGeographicFixture } from './fixtures/geographic';
import type { MapEditorData } from '../shared/cartography';
import { assignGeographicCells } from '../src/lib/geographic-edits';
import { isWaterPoint } from '../shared/map-surface';

const fixture = () => addGeographicFixture(createSeed());
const editor = (data: ReturnType<typeof fixture>) => data.maps[0].editor!;
const reader = (): UserAccount => ({
  ...ownerAccount('地图编辑者'),
  id: 'geo_editor',
  role: 'user',
  canExport: false,
  canViewPrivate: false,
  grants: { maps: { create: true, update: 'any', delete: 'none' } },
});

test('shared generated layers, map settings and military drawings survive JSON and SQLite restart', async (t) => {
  const data = fixture();
  assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(data))), data);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chronicle-cartarium-geography-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'cartarium.sqlite');
  let sqlite = await new SqliteStore(filename).initialize();
  await sqlite.save(data, 0);
  await sqlite.close();
  sqlite = await new SqliteStore(filename).initialize();
  try {
    assert.deepEqual((await sqlite.read()).data, data);
    assert.equal((await sqlite.read()).revision, 1);
    const invalid = structuredClone(data);
    editor(invalid).generated!.elevation!.values[0] = Infinity;
    await assert.rejects(sqlite.save(invalid, 1));
    assert.deepEqual(
      (await sqlite.read()).data,
      data,
      'invalid snapshot must not replace stored creation',
    );
    assert.equal((await sqlite.read()).revision, 1);
  } finally {
    await sqlite.close();
  }
  const demoFile = path.join(directory, 'workspace.json');
  const demo = await new DemoStore(demoFile).initialize();
  await demo.save(data, 0);
  const reopened = await new DemoStore(demoFile).initialize();
  assert.deepEqual((await reopened.read()).data, data);
});

test('generated layers reject unknown versions, capacity abuse, malformed grids and dangling references', () => {
  const mutations: ((e: MapEditorData) => void)[] = [
    (e) => {
      e.generated!.version = 2 as never;
    },
    (e) => {
      e.generated!.signature = 'foreign-signature';
    },
    (e) => {
      Object.assign(e.generated!, { html: '<script>' });
    },
    (e) => {
      e.generated!.elevation!.columns = 513;
    },
    (e) => {
      e.generated!.elevation!.values.pop();
    },
    (e) => {
      e.generated!.elevation!.values[0] = NaN;
    },
    (e) => {
      e.generated!.elevation!.min = 200;
    },
    (e) => {
      e.generated!.elevation!.width = 2000;
    },
    (e) => {
      e.generated!.objects[1].id = e.generated!.objects[0].id;
    },
    (e) => {
      e.generated!.objects[0].points[0].x = 1001;
    },
    (e) => {
      e.generated!.geography!.version = 2 as never;
    },
    (e) => {
      e.generated!.geography!.width = 2000;
    },
    (e) => {
      e.generated!.geography!.cells[1].id = 0;
    },
    (e) => {
      e.generated!.geography!.cells[0].neighbors = [1, 1];
    },
    (e) => {
      e.generated!.geography!.cells[0].neighbors = [0];
    },
    (e) => {
      e.generated!.geography!.cells[1].neighbors = [2];
    },
    (e) => {
      e.generated!.geography!.cells[0].plate = 20;
    },
    (e) => {
      e.generated!.geography!.cells[0].country = 'missing_country';
    },
    (e) => {
      e.generated!.geography!.cells[2].country = 'geo_country_0';
    },
    (e) => {
      e.generated!.geography!.cells[0].precipitation = -1;
    },
    (e) => {
      e.generated!.geography!.cells[0].temperature = Infinity;
    },
    (e) => {
      e.generated!.geography!.cells[0].polygon[0].x = 1200;
    },
    (e) => {
      e.generated!.geography!.areas[0].cells = [0, 0];
    },
    (e) => {
      e.generated!.geography!.areas[0].cells = [99];
    },
    (e) => {
      e.generated!.geography!.areas[0].entityId = 'missing_entity';
    },
    (e) => {
      e.generated!.geography!.divisions[0].entityId = 'missing_entity';
    },
    (e) => {
      e.generated!.geography!.borders[0].cells = [1, 0];
    },
    (e) => {
      e.generated!.geography!.borders[0].cells = [0, 2];
    },
    (e) => {
      e.generated!.geography!.borders[0].motion = 'convergent';
    },
    (e) => {
      e.generated!.geography!.borders[0].points[0].x = 200;
    },
    (e) => {
      e.generated!.geography!.ports[0].cell = 2;
    },
    (e) => {
      e.generated!.geography!.ports[0].settlementId = 'missing_site';
    },
    (e) => {
      e.generated!.geography!.seaRoutes[0].from = 'missing_port';
    },
    (e) => {
      e.generated!.geography!.seaRoutes[0].to = e.generated!.geography!.seaRoutes[0].from;
    },
    (e) => {
      e.generated!.geography!.seaRoutes[0].points[0].x = 1001;
    },
    (e) => {
      e.generated!.geography!.cells = Array.from({ length: 2401 }, (_, id) => ({
        ...e.generated!.geography!.cells[0],
        id,
      }));
    },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const data = fixture();
    mutate(editor(data));
    assert.throws(() => validateWorkspace(data), `mutation ${index}`);
  }
  const wrongType = fixture();
  editor(wrongType).generated!.geography!.divisions[0].entityId = wrongType.entities.find(
    (e) => e.type === 'character',
  )!.id;
  assert.throws(() => validateWorkspace(wrongType), /Invalid entity type for geographic division/);
  const crossWorld = fixture();
  crossWorld.worlds.push({ ...crossWorld.worlds[0], id: 'geo_other_world' });
  crossWorld.entities.push({
    ...crossWorld.entities[0],
    id: 'geo_cross_world',
    worldId: 'geo_other_world',
  });
  editor(crossWorld).generated!.geography!.areas[0].entityId = 'geo_cross_world';
  assert.throws(() => validateWorkspace(crossWorld), /cross-world entity reference/);
});

test('navigation validation uses the saved fine surface and rejects an island between water endpoints', () => {
  const valid = fixture();
  assert.doesNotThrow(() => validateWorkspace(valid));
  const interrupted = structuredClone(valid),
    snapshot = editor(interrupted).generated!,
    surface = snapshot.elevation!,
    route = snapshot.geography!.seaRoutes[0];
  route.points = [snapshot.geography!.ports[0].harbor, snapshot.geography!.ports[1].harbor];
  surface.values[8 * surface.columns + 16] = 100;
  assert(
    route.points.every((point) => isWaterPoint(surface, point)),
    'both endpoints remain safely in the sea',
  );
  assert.equal(
    snapshot.geography!.cells[2].land,
    false,
    'the coarse water region cannot detect its fine island',
  );
  assert.throws(() => validateWorkspace(interrupted), /航路必须完全沿实际水域/);
  const inlandHarbor = structuredClone(valid);
  editor(inlandHarbor).generated!.geography!.ports[0].harbor.x = 700;
  assert.throws(() => validateWorkspace(inlandHarbor), /港湾必须位于实际水域/);
  const missingSurface = structuredClone(valid);
  delete editor(missingSurface).generated!.elevation;
  assert.throws(() => validateWorkspace(missingSurface), /港口和航路需要已保存的高程图/);
  const detached = structuredClone(valid);
  editor(detached).generated!.geography!.seaRoutes[0].points[0].x = 840;
  assert.throws(() => validateWorkspace(detached), /航路端点必须连接对应港湾/);
  const noNavigation = structuredClone(missingSurface);
  editor(noNavigation).generated!.geography!.ports = [];
  editor(noNavigation).generated!.geography!.seaRoutes = [];
  assert.doesNotThrow(
    () => validateWorkspace(noNavigation),
    'maps without navigation do not require an elevation cache',
  );
});

test('public edits preserve fine-water navigation and private geography during projection and merge', () => {
  const data = fixture(),
    actor = reader();
  const geo = editor(data).generated!.geography!;
  geo.seaRoutes[0].name = '[[隐秘王陵地区]]航路';
  geo.ports[0].name = '[[隐藏的赤月帝国]]海港';
  const before = structuredClone(geo.seaRoutes),
    portsBefore = structuredClone(geo.ports),
    shown = visibleWorkspace(data, actor);
  assert(!JSON.stringify(shown).includes('隐秘王陵地区'));
  assert(!JSON.stringify(shown).includes('隐藏的赤月帝国'));
  assert.deepEqual(editor(shown).generated!.geography!.seaRoutes[0].points, before[0].points);
  editor(shown).generated!.geography!.areas[0].name = '公开大陆的新名字';
  const saved = mergeAuthorizedWorkspace(data, shown, actor);
  assert.deepEqual(editor(saved).generated!.geography!.seaRoutes, before);
  assert.deepEqual(editor(saved).generated!.geography!.ports, portsBefore);
  assert(
    editor(saved).generated!.geography!.divisions.some(
      (division) => division.id === 'geo_country_1',
    ),
  );
  assert.doesNotThrow(() => validateWorkspace(saved));
});

test('geographic recipe controls have explicit ranges and ordered latitude limits', () => {
  for (const patch of [
    { version: 2 },
    { source: 'remote' },
    { plateCount: 2 },
    { countryCount: 25 },
    { religionCount: -1 },
    { cultureCount: 0.5 },
    { latitudeNorth: 91 },
    { latitudeNorth: -70, latitudeSouth: 70 },
    { rainfall: 0 },
    { windAngle: Infinity },
    { roughness: 1.1 },
    { regionDensity: 3 },
    { meanSeaTemperature: 46 },
    { ports: 'yes' },
    { executable: 'eval' },
  ]) {
    const data = fixture();
    const recipe = editor(data).generation;
    assert(recipe?.version === 2);
    Object.assign(recipe.geography!, patch);
    assert.throws(() => validateWorkspace(data));
  }
});

test('oversized archives fail explicitly before replacing any saved creation', () => {
  const data = fixture();
  const original = data.entities[0];
  data.entities.push(
    ...Array.from({ length: 85 }, (_, index) => ({
      ...original,
      id: `geo_large_entry_${index}`,
      name: `大型资料 ${index}`,
      content: 'x'.repeat(200_000),
    })),
  );
  assert.throws(() => validateWorkspace(data), /超过 15 MiB 保存容量/);
});

test('front lines are constrained to existing land borders; free military arrows remain available', () => {
  const data = fixture();
  assert.doesNotThrow(() => validateWorkspace(data));
  const offBoundary = structuredClone(data);
  editor(offBoundary).military![0].points[1].x = 410;
  assert.throws(() => validateWorkspace(offBoundary), /前线必须沿陆地国界或区域边界/);
  const jumping = structuredClone(data);
  editor(jumping).military![0].points = [
    { x: 400, y: 0 },
    { x: 800, y: 640 },
  ];
  assert.throws(() => validateWorkspace(jumping), /前线必须沿陆地国界或区域边界/);
  const noGeography = structuredClone(data);
  delete editor(noGeography).generated!.geography;
  assert.throws(() => validateWorkspace(noGeography), /前线需要已保存/);
  for (const kind of ['advance', 'retreat', 'defense'] as const) {
    const arrow = structuredClone(offBoundary);
    editor(arrow).military![0].kind = kind;
    assert.doesNotThrow(() => validateWorkspace(arrow));
  }
  const invalidWidth = structuredClone(data);
  editor(invalidWidth).military![0].width = 0;
  assert.throws(() => validateWorkspace(invalidWidth));
});

test('public geography projection removes private names, links, ownership and political boundaries', () => {
  const data = fixture();
  const shown = visibleWorkspace(data, reader());
  const geo = editor(shown).generated!.geography!;
  const serialized = JSON.stringify(shown);
  for (const secret of [
    '隐藏的赤月帝国',
    '隐秘王陵地区',
    'geo_secret_faction',
    'geo_secret_area',
    'geo_country_1',
    'geo_province',
    'geo_border_0',
  ])
    assert(!serialized.includes(secret), secret);
  assert.equal(geo.cells[1].country, undefined);
  assert.equal(geo.divisions.length, 1);
  assert.equal(geo.areas.length, 2);
  assert(geo.borders.some((border) => border.id === 'geo_cell_border_0'));
  assert.deepEqual(mergeAuthorizedWorkspace(data, shown, reader()), data);
  assert.deepEqual(visibleWorkspace(data, ownerAccount()), data);
  const granted = reader();
  granted.records.geo_secret_faction = { read: true };
  granted.records.geo_secret_area = { read: true };
  assert.equal(editor(visibleWorkspace(data, granted)).generated!.geography!.divisions.length, 2);
});

test('cached labels and settlement recipe names redact private Wiki references and retain unchanged source text', () => {
  const data = fixture(),
    actor = reader();
  const secret = data.entities.find((entity) => entity.id === 'geo_secret_area')!;
  const reference = `[[${secret.name}]]`;
  const recipe = editor(data).generation;
  assert(recipe?.version === 2);
  recipe.settlementNames = { city_0: reference, town_0: '公开城镇' };
  editor(data).generated!.sites![0].name = reference;
  editor(data).generated!.geography!.plates[0].name = reference;
  const shown = visibleWorkspace(data, actor);
  assert(!JSON.stringify(shown).includes(secret.name));
  const shownRecipe = editor(shown).generation;
  assert(shownRecipe?.version === 2);
  shownRecipe.settlementNames!.town_0 = '城镇的新名字';
  editor(shown).generated!.sites![1].name = '另一个公开名字';
  editor(shown).generated!.geography!.plates[1].name = '另一个板块';
  const saved = mergeAuthorizedWorkspace(data, shown, actor);
  const savedRecipe = editor(saved).generation;
  assert(savedRecipe?.version === 2);
  assert.equal(savedRecipe.settlementNames!.city_0, reference);
  assert.equal(savedRecipe.settlementNames!.town_0, '城镇的新名字');
  assert.equal(editor(saved).generated!.sites![0].name, reference);
  assert.equal(editor(saved).generated!.geography!.plates[0].name, reference);
  const guessed = visibleWorkspace(fixture(), actor);
  editor(guessed).generated!.geography!.areas[0].name = reference;
  assert.throws(
    () => mergeAuthorizedWorkspace(fixture(), guessed, actor),
    /不能关联尚未获准查看的地图条目/,
  );
});

test('authorized public edits preserve all hidden geographic parts and cannot attach guessed private references', () => {
  const data = fixture(),
    actor = reader();
  const shown = visibleWorkspace(data, actor);
  editor(shown).generated!.geography!.areas[0].name = '新的大陆名称';
  editor(shown).generated!.geography!.divisions[0].name = '新的公开领地';
  shown.maps[0].summary = '公开地图编辑';
  const saved = mergeAuthorizedWorkspace(data, shown, actor);
  const geo = editor(saved).generated!.geography!;
  assert.equal(geo.areas.find((area) => area.id === 'geo_continent')!.name, '新的大陆名称');
  assert.deepEqual(
    geo.areas.find((area) => area.id === 'geo_province'),
    editor(data).generated!.geography!.areas[2],
  );
  assert.deepEqual(
    geo.divisions.find((division) => division.id === 'geo_country_1'),
    editor(data).generated!.geography!.divisions[1],
  );
  assert.equal(geo.cells[1].country, 'geo_country_1');
  assert(geo.borders.some((border) => border.id === 'geo_border_0'));
  const guessed = visibleWorkspace(data, actor);
  editor(guessed).generated!.geography!.areas[0].entityId = 'geo_secret_area';
  assert.throws(() => mergeAuthorizedWorkspace(data, guessed, actor), PermissionError);
  const overwrite = visibleWorkspace(data, actor);
  editor(overwrite).generated!.geography!.cells[1].country = 'geo_country_0';
  assert.throws(() => mergeAuthorizedWorkspace(data, overwrite, actor), /覆盖未公开疆域/);
  const regenerated = visibleWorkspace(data, actor);
  editor(regenerated).generated!.geography!.cells[1].polygon[0].x += 1;
  assert.throws(
    () => mergeAuthorizedWorkspace(data, regenerated, actor),
    /重新生成地理单元需要管理员/,
  );
  const removed = visibleWorkspace(data, actor);
  delete editor(removed).generated;
  assert.throws(() => mergeAuthorizedWorkspace(data, removed, actor), /包含未公开疆域或地名/);
  const stripped = visibleWorkspace(data, actor);
  delete editor(stripped).generated!.geography;
  assert.throws(() => mergeAuthorizedWorkspace(data, stripped, actor), /包含未公开疆域或地名/);
  const removedEditor = visibleWorkspace(data, actor);
  delete removedEditor.maps[0].editor;
  assert.throws(() => mergeAuthorizedWorkspace(data, removedEditor, actor), /包含未公开疆域或地名/);
});

test('entity rename and authorized deletion maintain geographic links without losing cached maps', () => {
  const data = fixture();
  const faction = data.entities.find(
    (entity) => entity.id === editor(data).generated!.geography!.divisions[0].entityId,
  )!;
  const changed = saveEntityInWorkspace(data, { ...faction, name: '新王朝名称' });
  assert.equal(editor(changed).generated!.geography!.divisions[0].name, '新王朝名称');
  assert.equal(editor(data).generated!.geography!.divisions[0].name, faction.name);
  const actor = reader();
  actor.records.geo_secret_area = { read: true, delete: true };
  actor.grants.maps = { create: false, update: 'none', delete: 'none' };
  const forbidden = visibleWorkspace(data, actor);
  forbidden.entities = forbidden.entities.filter((entity) => entity.id !== 'geo_secret_area');
  assert.throws(
    () => mergeAuthorizedWorkspace(data, forbidden, actor),
    /仍被没有修改权限的内容引用/,
  );
  const moderator: UserAccount = { ...ownerAccount(), role: 'moderator' };
  const removed = visibleWorkspace(data, moderator);
  removed.entities = removed.entities.filter((entity) => entity.id !== 'geo_secret_area');
  const saved = mergeAuthorizedWorkspace(data, removed, moderator);
  assert.equal(editor(saved).generated!.geography!.areas[2].entityId, undefined);
  assert.equal(editor(saved).generated!.objects.length, editor(data).generated!.objects.length);
});

test('public region painting rebuilds redacted borders after restoring hidden ownership', () => {
  const data = fixture(),
    actor = reader();
  editor(data).generated!.geography!.borders[0].id = 'country_0_1';
  const shown = visibleWorkspace(data, actor);
  editor(shown).generated!.geography = assignGeographicCells(
    editor(shown).generated!.geography!,
    'geo_country_0',
    new Set([0]),
  );
  const saved = mergeAuthorizedWorkspace(data, shown, actor);
  const geo = editor(saved).generated!.geography!;
  assert.equal(geo.cells[1].country, 'geo_country_1');
  assert.equal(geo.borders.filter((border) => border.kind === 'country').length, 1);
  assert.equal(geo.borders.find((border) => border.kind === 'country')!.id, 'country_0_1');
  assert(!JSON.stringify(visibleWorkspace(saved, actor)).includes('geo_country_1'));
});

test('Markdown details persisted layers, geographic names, ports and military lines while excluding secrets', () => {
  const data = fixture();
  const options = {
    worldId: data.worlds[0].id,
    entityIds: data.entities.map((entity) => entity.id),
    includeMaps: true,
    includeRelations: false,
    includePlots: false,
    includeSessions: false,
    includeSecrets: false,
  };
  const player = exportMarkdown(data, options);
  for (const phrase of [
    '完全随机生成',
    '已保存的生成快照',
    '打开地图不会重新生成',
    '气温图层',
    '降水图层',
    '大陆板块',
    '晴川大陆',
    '银帆海',
    '银帆港',
    '银帆航路',
    '北部前线',
  ])
    assert(player.includes(phrase), phrase);
  assert(!player.includes('隐藏的赤月帝国'));
  assert(!player.includes('隐秘王陵地区'));
  const gm = exportMarkdown(data, { ...options, includeSecrets: true });
  assert(gm.includes('隐藏的赤月帝国'));
  assert(gm.includes('隐秘王陵地区'));
  const recipe = editor(data).generation;
  assert(recipe?.version === 2);
  recipe.settlementCounts = { city: 1, town: 1, village: 0, castle: 0, camp: 0 };
  recipe.settlementNames = { city_0: '朝露都', town_0: '溪谷镇' };
  const renamed = exportMarkdown(data, options);
  assert(renamed.includes('已生成城市 **朝露都**'));
  assert(renamed.includes('已生成小镇 **溪谷镇**'));
  assert(renamed.includes('关联聚落 朝露都'));
  assert(!renamed.includes('已生成城市 **银帆城**'));
});
