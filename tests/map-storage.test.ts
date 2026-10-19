import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSeed } from '../shared/seed';
import type { MapEditorData } from '../shared/cartography';
import { biomeCatalog, generationDetailCatalog, legacyBiomeIds } from '../shared/cartography';
import { validateWorkspace } from '../server/validation';
import { DemoStore } from '../server/store';
import { exportMarkdown } from '../src/lib/export';
import { composeTerrainRegions } from '../src/lib/cartography';
import { createEditorFixture } from './fixtures/map-editor';

const withEditor = () => {
  const data = createSeed();
  data.maps[0].editor = createEditorFixture();
  return data;
};

test('legacy maps remain valid without injecting editor defaults', () => {
  const seed = createSeed();
  assert.deepEqual(validateWorkspace(seed), seed);
  assert.equal(Object.hasOwn(validateWorkspace(seed).maps[0], 'editor'), false);
});

test('editor modes and vector settings survive validation and JSON backup', () => {
  for (const mode of ['sketch', 'sculpt', 'detail'] as const) {
    const data = withEditor();
    data.maps[0].editor!.mode = mode;
    assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(data))), data);
  }
});

test('editor rejects unknown versions, enums, fields, invalid colors and scalar limits', () => {
  const mutations: ((editor: MapEditorData) => void)[] = [
    (e) => {
      e.version = 2 as never;
    },
    (e) => {
      e.mode = 'advanced' as never;
    },
    (e) => {
      e.regions[0].biome = 'lava' as never;
    },
    (e) => {
      e.objects[0].symbol = 'javascript' as never;
    },
    (e) => {
      e.objects[0].kind = 'html' as never;
    },
    (e) => {
      e.objects[0].layer = 'unknown' as never;
    },
    (e) => {
      e.objects[0].color = 'url(https://example.com/image)';
    },
    (e) => {
      e.objects[0].stroke = '#12345';
    },
    (e) => {
      e.objects[0].opacity = Number.NaN;
    },
    (e) => {
      e.objects[0].blur = -1;
    },
    (e) => {
      e.objects[0].blur = 41;
    },
    (e) => {
      e.objects[0].size = Infinity;
    },
    (e) => {
      e.objects[0].rotation = 361;
    },
    (e) => {
      e.objects[0].text = 'a'.repeat(2001);
    },
    (e) => {
      e.regions[0].density = 1.1;
    },
    (e) => {
      e.regions[0].roughness = -0.1;
    },
    (e) => {
      e.regions[0].width = 0;
    },
    (e) => {
      Object.assign(e.objects[0], { html: '<script>' });
    },
  ];
  for (const mutate of mutations) {
    const data = withEditor();
    mutate(data.maps[0].editor!);
    assert.throws(() => validateWorkspace(data));
  }
});

test('editor enforces geometry point counts and in-canvas coordinates', () => {
  const mutations: ((editor: MapEditorData) => void)[] = [
    (e) => {
      e.regions[0].points.length = 2;
    },
    (e) => {
      e.objects[1].points.length = 1;
    },
    (e) => {
      e.objects[0].points.push({ x: 1, y: 1 });
    },
    (e) => {
      e.objects[0].symbol = undefined;
    },
    (e) => {
      e.objects[1].symbol = 'tree';
    },
    (e) => {
      e.regions[0].points[0].x = -1;
    },
    (e) => {
      e.objects[0].points[0].y = 10001;
    },
    (e) => {
      e.objects[0].points[0].x = Infinity;
    },
  ];
  for (const mutate of mutations) {
    const data = withEditor();
    mutate(data.maps[0].editor!);
    assert.throws(() => validateWorkspace(data));
  }
  const boundary = withEditor();
  boundary.maps[0].editor!.objects[0].points = [
    { x: boundary.maps[0].width, y: boundary.maps[0].height },
  ];
  assert.doesNotThrow(() => validateWorkspace(boundary));
});

test('generation recipes reject unsupported algorithms and unbounded settings', () => {
  const invalid = [
    { version: 3 },
    { version: 1 },
    { detail: undefined },
    { detail: 'custom' },
    { linework: 'straight' },
    { linework: true },
    { seed: -1 },
    { seed: 4_294_967_296 },
    { seed: 0.5 },
    { climate: 'anything' },
    { settlements: 13 },
    { settlements: -1 },
    { settlements: 2.5 },
    { rivers: 'true' },
    { routes: null },
    { remoteUrl: 'https://example.com' },
  ];
  for (const patch of invalid) {
    const data = withEditor();
    Object.assign(data.maps[0].editor!.generation!, patch);
    assert.throws(() => validateWorkspace(data));
  }
  const legacy = withEditor();
  delete legacy.maps[0].editor!.generation;
  assert.deepEqual(validateWorkspace(legacy), legacy);
});

test('v1 generation is retained exactly and v2 quality and added biomes roundtrip without defaults', () => {
  const old = withEditor();
  old.maps[0].editor!.regions[0].biome = 'forest';
  old.maps[0].editor!.generation = {
    version: 1,
    seed: 2468,
    climate: 'temperate',
    settlements: 4,
    rivers: true,
    routes: true,
  };
  assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(old))), old);
  assert.equal(Object.hasOwn(validateWorkspace(old).maps[0].editor!.generation!, 'detail'), false);
  for (const { id: biome } of biomeCatalog) {
    old.maps[0].editor!.regions[0].biome = biome;
    if (legacyBiomeIds.some((id) => id === biome)) assert.deepEqual(validateWorkspace(old), old);
    else {
      assert.throws(() => validateWorkspace(old), /New biomes require generation version 2/);
      old.maps[0].editor!.regions[0].visible = false;
      assert.throws(() => validateWorkspace(old), /New biomes require generation version 2/);
      old.maps[0].editor!.regions[0].visible = true;
    }
  }
  delete old.maps[0].editor!.generation;
  assert.deepEqual(validateWorkspace(old), old, 'new biomes also work as a manual source draft');
  const previousV2 = withEditor();
  if (previousV2.maps[0].editor!.generation!.version === 2)
    delete previousV2.maps[0].editor!.generation!.linework;
  assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(previousV2))), previousV2);
  for (const { id: detail } of generationDetailCatalog) {
    for (const { id: biome } of biomeCatalog) {
      const data = withEditor();
      data.maps[0].editor!.generation = { ...data.maps[0].editor!.generation!, version: 2, detail };
      data.maps[0].editor!.regions[0].biome = biome;
      assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(data))), data);
    }
  }
});

test('all fourteen manual terrain types compose into valid persistable vectors without a recipe', () => {
  for (const { id: biome, label } of biomeCatalog) {
    const data = withEditor();
    const map = data.maps[0];
    delete map.editor!.generation;
    map.editor!.regions[0].biome = biome;
    map.editor!.regions[0].points = [
      { x: 80, y: 80 },
      { x: 480, y: 80 },
      { x: 480, y: 360 },
      { x: 80, y: 360 },
    ];
    map.editor!.objects = composeTerrainRegions(map.editor!.regions, map.width, map.height);
    assert.ok(
      map.editor!.objects.some((object) => object.name === `${label} · 融合地表`),
      biome,
    );
    assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(data))), data);
  }
});

test('editor IDs cannot collide with map items or other workspace records', () => {
  for (const target of ['test_region', 'test_path', createSeed().worlds[0].id]) {
    const data = withEditor();
    data.maps[0].editor!.objects[0].id = target;
    assert.throws(() => validateWorkspace(data), /Duplicate ID/);
  }
});

test('editor bounds region/object/point counts', () => {
  const tooManyRegions = withEditor();
  const editor = tooManyRegions.maps[0].editor!;
  editor.regions = Array.from({ length: 201 }, (_, i) => ({
    ...editor.regions[0],
    id: `region_${i}`,
  }));
  assert.throws(() => validateWorkspace(tooManyRegions));
  const tooManyObjects = withEditor();
  const objects = tooManyObjects.maps[0].editor!;
  objects.objects = Array.from({ length: 8001 }, (_, i) => ({
    ...objects.objects[0],
    id: `object_${i}`,
  }));
  assert.throws(() => validateWorkspace(tooManyObjects));
  const tooManyPoints = withEditor();
  tooManyPoints.maps[0].editor!.regions[0].points = Array.from({ length: 2001 }, () => ({
    x: 10,
    y: 10,
  }));
  assert.throws(() => validateWorkspace(tooManyPoints));
});

test('editor data persists through demo restart without altering legacy map layers', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worldloom-editor-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'workspace.json');
  const store = await new DemoStore(filename).initialize();
  const data = withEditor();
  await store.save(data, 0);
  const restarted = await new DemoStore(filename).initialize();
  assert.deepEqual((await restarted.read()).data, data);
});

test('Markdown records editor settings and keeps secret Wiki references filtered', () => {
  const data = withEditor();
  const secret = {
    ...data.entities[0],
    id: 'test_secret',
    name: '密封王陵',
    visibility: 'gm' as const,
  };
  data.entities.push(secret);
  data.maps[0].editor!.objects[2].text = `入口通向 [[ ${secret.name} ]]`;
  const options = {
    worldId: data.worlds[0].id,
    entityIds: data.entities.map((e) => e.id),
    includeMaps: true,
    includeRelations: false,
    includePlots: false,
    includeSessions: false,
    includeSecrets: false,
  };
  data.maps[0].visibility = 'public';
  const player = exportMarkdown(data, options);
  assert.match(player, /智能塑形/);
  assert.match(player, /针叶林/);
  assert.match(player, /高塔/);
  assert.match(player, /色块生成：版本 2；种子 2468；气候 温带；聚落上限 4；水系开启；道路开启/);
  assert.match(player, /地形采样：精细（长边目标 288 格，复杂笔迹可能降低）/);
  assert.match(player, /河路形态：柔和曲线/);
  assert.match(player, /入口通向 〔未公开条目〕/);
  assert(!player.includes(secret.name));
  const gm = exportMarkdown(data, { ...options, includeSecrets: true });
  assert(gm.includes(secret.name));
});
