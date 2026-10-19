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
import { visibleWorkspace, mergeAuthorizedWorkspace } from '../server/permissions';
import { renameSettlementArtwork } from '../src/lib/settlement-names';
import { generationSignature } from '../src/lib/generated-map';
import { exportMarkdown } from '../src/lib/export';

function fixture() {
  const data = addGeographicFixture(createSeed());
  const map = data.maps[0],
    editor = map.editor!,
    recipe = editor.generation;
  assert(recipe?.version === 2);
  const secret = data.entities.find((entity) => entity.id === 'geo_secret_area')!;
  const open = { ...secret, id: 'public_town_page', name: '南湾镇', visibility: 'public' as const };
  data.entities.push(open);
  recipe.settlementLinks = { city_0: secret.id, town_0: open.id };
  recipe.settlementNames = { city_0: secret.name, town_0: open.name };
  editor.generated!.sites![0] = {
    ...editor.generated!.sites![0],
    name: secret.name,
    entityId: secret.id,
  };
  editor.generated!.sites![1] = {
    ...editor.generated!.sites![1],
    name: open.name,
    entityId: open.id,
  };
  editor.generated!.geography!.ports[0].name = `${secret.name}港`;
  editor.generated!.geography!.seaRoutes[0].name = `${secret.name}航路`;
  const { symbol: _symbol, ...base } = editor.generated!.objects[0];
  const label = {
    ...base,
    id: 'generated_city_label',
    kind: 'text' as const,
    name: '聚落 1 · 名称',
    text: secret.name,
  };
  editor.generated!.objects.push(label);
  try {
    return validateWorkspace(data);
  } catch (error) {
    throw new Error(JSON.stringify((error as { issues?: unknown }).issues));
  }
}
const reader = (): UserAccount => ({
  ...ownerAccount('地图编辑者'),
  id: 'place_editor',
  role: 'user',
  canExport: false,
  canViewPrivate: false,
  grants: { maps: { create: true, update: 'any', delete: 'none' } },
});

test('settlement location links persist with snapshots and reject wrong-world, wrong-type and guessed IDs', async (t) => {
  const data = fixture();
  assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(data))), data);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cartarium-places-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'places.sqlite');
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
    invalid.maps[0].editor!.generated!.sites![0].entityId = id;
    assert.throws(() => validateWorkspace(invalid));
    const recipe = invalid.maps[0].editor!.generation;
    assert(recipe?.version === 2);
    recipe.settlementLinks!.city_0 = id;
    assert.throws(() => validateWorkspace(invalid));
  }
  const foreign = structuredClone(data),
    entity = foreign.entities.find((item) => item.id === 'public_town_page')!;
  entity.worldId = foreign.worlds[1]?.id ?? 'missing_world';
  assert.throws(() => validateWorkspace(foreign));
});

test('place names and links reuse physical generation while unlinking clears cached association', () => {
  const data = fixture(),
    map = data.maps[0],
    snapshot = map.editor!.generated!,
    recipe = map.editor!.generation;
  assert(recipe?.version === 2);
  const signature = generationSignature(
    map.editor!.regions,
    map.width,
    map.height,
    recipe,
    map.scaleKm,
    map.kind,
  );
  const next = { ...recipe, settlementLinks: {}, settlementNames: { city_0: '樱岸都' } };
  assert.equal(
    generationSignature(map.editor!.regions, map.width, map.height, next, map.scaleKm, map.kind),
    signature,
  );
  const named = renameSettlementArtwork(snapshot.objects, snapshot.sites, next);
  assert.equal(named.sites![0].name, '樱岸都');
  assert(!Object.hasOwn(named.sites![0], 'entityId'));
  assert.equal(named.objects.find((object) => object.name === '聚落 1 · 名称')!.text, '樱岸都');
  assert.strictEqual(named.objects[0], snapshot.objects[0]);
  assert.equal(snapshot.sites![0].entityId, 'geo_secret_area');
});

test('private linked settlement names, cached labels, ports and recipe IDs are hidden and preserved on public edits', () => {
  const data = fixture(),
    actor = reader(),
    shown = visibleWorkspace(data, actor);
  const encoded = JSON.stringify(shown);
  assert(!encoded.includes('隐秘王陵地区'));
  assert(!encoded.includes('geo_secret_area'));
  assert.equal(shown.maps[0].editor!.generated!.sites![0].name, '未公开聚落');
  assert.equal(shown.maps[0].editor!.generated!.geography!.ports[0].name, '未公开港口');
  assert.deepEqual(mergeAuthorizedWorkspace(data, shown, actor), data);
  shown.maps[0].summary = '可编辑的公开说明';
  const saved = mergeAuthorizedWorkspace(data, shown, actor);
  assert.deepEqual(saved.maps[0].editor, data.maps[0].editor);
  const guessed = visibleWorkspace(data, actor),
    recipe = guessed.maps[0].editor!.generation;
  assert(recipe?.version === 2);
  recipe.settlementLinks!.town_0 = 'geo_secret_area';
  assert.throws(() => mergeAuthorizedWorkspace(data, guessed, actor), /不能关联尚未获准查看/);
  const regenerated = visibleWorkspace(data, actor);
  regenerated.maps[0].editor!.generated!.signature = 'fedcba0987654321-20';
  assert.throws(() => mergeAuthorizedWorkspace(data, regenerated, actor), /未公开聚落/);
});

test('renaming a linked page follows default settlement names while retaining custom names and cleanup detaches all links', () => {
  const data = fixture(),
    page = data.entities.find((entity) => entity.id === 'public_town_page')!;
  const renamed = saveEntityInWorkspace(data, { ...page, name: '月桥镇' });
  const recipe = renamed.maps[0].editor!.generation;
  assert(recipe?.version === 2);
  assert.equal(recipe.settlementNames!.town_0, '月桥镇');
  assert.equal(renamed.maps[0].editor!.generated!.sites![1].name, '月桥镇');
  const custom = fixture(),
    customRecipe = custom.maps[0].editor!.generation;
  assert(customRecipe?.version === 2);
  customRecipe.settlementNames!.town_0 = '自己写的名称';
  custom.maps[0].editor!.generated!.sites![1].name = '自己写的名称';
  const kept = saveEntityInWorkspace(custom, { ...page, name: '月桥镇' }).maps[0].editor!
    .generation;
  assert(kept?.version === 2);
  assert.equal(kept.settlementNames!.town_0, '自己写的名称');
  const map = clearMapEntityLinks(data.maps[0], new Set(['public_town_page', 'geo_secret_area']));
  const cleaned = map.editor!.generation;
  assert(cleaned?.version === 2);
  assert.deepEqual(cleaned.settlementLinks, {});
  assert(map.editor!.generated!.sites!.every((site) => !site.entityId));
  assert(
    !map.editor!.generated!.geography!.areas.find((area) => area.id === 'geo_province')!.entityId,
  );
  assert.strictEqual(map.editor!.generated!.elevation, data.maps[0].editor!.generated!.elevation);
});

test('Markdown resolves visible settlement and port associations without exporting private linked place names', () => {
  const data = fixture(),
    options = {
      worldId: data.worlds[0].id,
      entityIds: ['public_town_page'],
      includeMaps: true,
      includeRelations: false,
      includePlots: false,
      includeSessions: false,
      includeSecrets: false,
    };
  const markdown = exportMarkdown(data, options);
  assert(markdown.includes('关联 [南湾镇](#public_town_page)'));
  assert(markdown.includes('关联档案 [南湾镇](#public_town_page)'));
  assert(!markdown.includes('隐秘王陵地区'));
  const full = exportMarkdown(data, { ...options, includeSecrets: true });
  assert(full.includes('隐秘王陵地区'));
});
