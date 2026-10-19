import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generateSketchMap } from '../src/lib/sketch-generation';
import { layoutClues, roundedCluePath, connectionLanes } from '../src/lib/graph-layout';
import type { MapRegion, SketchGenerationV2 } from '../shared/cartography';
import { createSeed } from '../shared/seed';
import { getEntityTypes } from '../shared/entity-types';
import { validateWorkspace } from '../server/validation';
import { SqliteStore } from '../server/sqlite-store';
import { exportMarkdown } from '../src/lib/export';
import { renameSettlementArtwork } from '../src/lib/settlement-names';
import { coverPresets } from '../shared/cover-presets';
import { surroundingBuildingCount } from '../src/lib/settlement-surroundings';

test('parallel and reciprocal clue links fan out in stable bounded lanes independently of dragging', () => {
  const links = [
    { id: 'b', source: 'first', target: 'second' },
    { id: 'a', source: 'first', target: 'second' },
    { id: 'c', source: 'first', target: 'third' },
    { id: 'd', source: 'second', target: 'first' },
  ];
  const lanes = connectionLanes(links, 106);
  assert.deepEqual(connectionLanes([...links].reverse(), 106), lanes);
  assert.equal(new Set(['a', 'b', 'c'].map((id) => lanes[id].sourceOffset)).size, 3);
  assert.notEqual(lanes.a.targetOffset, lanes.b.targetOffset);
  assert.notEqual(lanes.a.corridor, lanes.d.corridor);
  for (const lane of Object.values(lanes)) {
    assert(Math.abs(lane.sourceOffset) <= 37);
    assert(Math.abs(lane.targetOffset) <= 37);
    assert(lane.clearance > 53);
  }
});
test('only bundled preset covers or uploaded covers are accepted, arbitrary static paths are rejected', () => {
  const data = createSeed();
  for (const preset of coverPresets) {
    data.entities[0].cover = preset.url;
    assert.equal(validateWorkspace(data).entities[0].cover, preset.url);
    const markdown = exportMarkdown(data, {
      worldId: data.worlds[0].id,
      entityIds: [data.entities[0].id],
      includeMaps: false,
      includeRelations: false,
      includePlots: false,
      includeSessions: false,
      includeSecrets: true,
    });
    assert(markdown.includes(preset.url));
  }
  for (const bad of [
    '/covers/unknown.png',
    '/covers/../installation.json',
    '/assets/arbitrary.png',
    'https://example.com/cover.png',
  ]) {
    data.entities[0].cover = bad;
    assert.throws(() => validateWorkspace(data));
  }
});
import {
  reconcileSnapshot,
  rebaseSnapshot,
  SnapshotRebaseConflict,
} from '../src/lib/reconcile-snapshot';
test('in-flight acknowledgements rebase authorship and repaired references while keeping newer edits and geometry', () => {
  const base = createSeed(),
    local = structuredClone(base),
    saved = structuredClone(base);
  local.maps[0].summary = '保存期间继续写的新摘要';
  saved.entities[0].createdBy = 'owner';
  saved.worlds[0].description = '服务端同步的新引用';
  const next = rebaseSnapshot(base, local, saved);
  assert.equal(next.maps[0].summary, local.maps[0].summary);
  assert.equal(next.maps[0].pins, local.maps[0].pins);
  assert.equal(next.entities[0].createdBy, 'owner');
  assert.equal(next.worlds[0].description, saved.worlds[0].description);
  assert.equal(local.worlds[0].description, base.worlds[0].description);
});
test('competing same-field changes preserve the draft and report an explicit conflict', () => {
  const base = createSeed(),
    local = structuredClone(base),
    saved = structuredClone(base);
  local.entities[0].content = '我新写的内容';
  saved.entities[0].content = '另一个关联修正';
  assert.throws(() => rebaseSnapshot(base, local, saved), SnapshotRebaseConflict);
  assert.equal(local.entities[0].content, '我新写的内容');
});
test('save acknowledgement preserves large unchanged geometry and accepts server-owned metadata and reference repairs', () => {
  const old = createSeed();
  const wire = JSON.parse(JSON.stringify(old));
  assert.equal(reconcileSnapshot(old, wire), old);
  wire.entities[0].createdBy = 'owner';
  const next = reconcileSnapshot(old, wire);
  assert.notEqual(next, old);
  assert.equal(next.maps, old.maps);
  assert.equal(next.entities[1], old.entities[1]);
  assert.equal(next.entities[0].createdBy, 'owner');
  const optional = { first: 1, second: undefined };
  assert.equal(reconcileSnapshot(optional, { first: 1 }), optional);
});

const grass: MapRegion = {
  id: 'grass',
  name: '平原',
  biome: 'grass',
  geometry: 'polygon',
  points: [
    { x: 60, y: 50 },
    { x: 940, y: 50 },
    { x: 940, y: 590 },
    { x: 60, y: 590 },
  ],
  width: 80,
  seed: 37,
  density: 0.6,
  roughness: 0.15,
  visible: true,
  locked: false,
};
const settings: SketchGenerationV2 = {
  version: 2,
  seed: 618,
  climate: 'temperate',
  detail: 'standard',
  settlements: 5,
  rivers: false,
  routes: true,
  linework: 'organic',
  settlementCounts: { village: 1, town: 1, city: 1, castle: 1, camp: 1 },
};
test('all five settlement types have dense world surroundings, sparse region surroundings and no town surroundings', () => {
  const kinds = ['village', 'town', 'city', 'castle', 'camp'] as const;
  for (const kind of kinds) {
    assert(
      surroundingBuildingCount(kind, 'world', 60) > surroundingBuildingCount(kind, 'region', 60),
    );
    assert.equal(surroundingBuildingCount(kind, 'town', 5), 0);
  }
  const generated = (['world', 'region', 'town'] as const).map((kind) =>
    generateSketchMap(
      [grass],
      1000,
      640,
      settings,
      kind === 'world' ? 6000 : kind === 'region' ? 400 : 10,
      kind,
    ),
  );
  const buildings = generated.map((map) =>
    map.objects.filter(
      (object) => object.name.includes(' · 周边建筑 ') && object.name.endsWith(' · 屋面'),
    ),
  );
  assert(buildings[0].length > buildings[1].length * 2);
  assert.equal(buildings[2].length, 0);
  for (let i = 0; i < 5; i++) {
    const count = (objects: (typeof buildings)[0]) =>
      objects.filter((object) => object.name.startsWith(`聚落 ${i + 1} · `)).length;
    assert(
      count(buildings[0]) > count(buildings[1]),
      `Settlement ${i + 1} should be denser on a world map`,
    );
  }
  for (const map of generated) assert(map.objects.length <= 8000);
});
test('typed settlements have deterministic distinct glyph sizes, names and land positions; names do not move the network', () => {
  const original = generateSketchMap([grass], 1000, 640, settings, 400, 'region');
  assert.equal(original.sites!.length, 5);
  assert.equal(new Set(original.sites!.map((s) => s.kind)).size, 5);
  const glyphs = original.objects.filter((o) => /聚落 \d+ · 地标/.test(o.name));
  assert.equal(new Set(glyphs.map((o) => o.symbol)).size, 5);
  assert(
    glyphs.find((o) => o.symbol === 'city')!.size >
      glyphs.find((o) => o.symbol === 'village')!.size,
  );
  const changed = generateSketchMap(
    [grass],
    1000,
    640,
    { ...settings, settlementNames: { city_0: '月樱城', castle_0: '青鹭要塞' } },
    400,
    'region',
  );
  assert.equal(changed.sites!.find((s) => s.id === 'city_0')!.name, '月樱城');
  assert(changed.objects.some((o) => o.kind === 'text' && o.text === '青鹭要塞'));
  const renamed = renameSettlementArtwork(original.objects, original.sites, {
    ...settings,
    settlementNames: { city_0: '月樱城' },
  });
  assert.equal(renamed.sites!.find((s) => s.id === 'city_0')!.name, '月樱城');
  assert.equal(renamed.objects.find((o) => o.name === '聚落 1 · 名称')!.text, '月樱城');
  for (let i = 0; i < original.objects.length; i++)
    if (original.objects[i].name !== '聚落 1 · 名称')
      assert.equal(renamed.objects[i], original.objects[i]);
  assert.deepEqual(changed.diagnostics.settlements, original.diagnostics.settlements);
  assert.deepEqual(changed.diagnostics.routes, original.diagnostics.routes);
  assert.deepEqual(
    changed.objects.filter((o) => !o.name.endsWith('名称')),
    original.objects.filter((o) => !o.name.endsWith('名称')),
  );
  for (const index of original.diagnostics.settlements)
    assert(
      original.diagnostics.cells[index].land && original.diagnostics.cells[index].elevation < 0.56,
    );
});
test('expanded clue layout avoids overlapping cards, handles cycles and isolated clues and supplies bend routes', () => {
  const ids = Array.from({ length: 24 }, (_, i) => `clue_${i}`);
  const links = ids
    .slice(1, 20)
    .map((id, i) => ({ id: `edge_${i}`, source: ids[Math.floor(i / 3)], target: id }));
  links.push({ id: 'cycle', source: ids[19], target: ids[0] });
  const result = layoutClues(ids, links, 240, 120);
  assert.deepEqual(result, layoutClues(ids, links, 240, 120));
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = result.positions[ids[i]],
        b = result.positions[ids[j]];
      assert(
        Math.abs(a.x - b.x) >= 240 || Math.abs(a.y - b.y) >= 120,
        `${ids[i]} overlaps ${ids[j]}`,
      );
    }
  assert.equal(Object.keys(result.routes).length, links.length);
  assert(Object.values(result.routes).some((points) => points.length > 3));
  assert.match(
    roundedCluePath([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 40 },
    ]),
    /Q/,
  );
});
test('SQLite restart and Markdown retain catalogue, cover, graph positions, typed settlement limits and authored names', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worldloom-creation-'));
  const filename = path.join(directory, 'worldloom.sqlite');
  let store = await new SqliteStore(filename).initialize();
  t.after(async () => {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const data = createSeed();
  data.worlds[0].entityTypes = [
    ...getEntityTypes(),
    { id: 'custom_geist', name: '怪异传闻', description: '可追踪的奇妙现象' },
  ];
  data.entities[0].createdBy = 'owner';
  data.entities[0].cover = '/uploads/cover.png';
  data.entities[1].cover = coverPresets[0].url;
  data.entities[0].graphPosition = { x: 480, y: 670 };
  data.entities[0].type = 'custom_geist';
  data.maps[0].createdBy = 'owner';
  data.maps[0].visibility = 'public';
  data.maps[0].editor = {
    version: 1,
    mode: 'sculpt',
    baseVisible: false,
    regions: [grass],
    objects: [],
    generation: { ...settings, settlementNames: { city_0: '月樱城' } },
  };
  data.plots[0].layoutVersion = 1;
  data.plots[0].createdBy = 'owner';
  await store.save(validateWorkspace(data), 0);
  await store.close();
  store = await new SqliteStore(filename).initialize();
  assert.deepEqual((await store.read()).data, data);
  const markdown = exportMarkdown(data, {
    worldId: data.worlds[0].id,
    entityIds: [data.entities[0].id],
    includeMaps: true,
    includeRelations: false,
    includePlots: true,
    includeSessions: false,
    includeSecrets: true,
  });
  assert.match(markdown, /怪异传闻/);
  assert.match(markdown, /cover\.png/);
  assert.match(markdown, /月樱城/);
});
