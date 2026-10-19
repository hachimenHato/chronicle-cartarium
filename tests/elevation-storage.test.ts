import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { MAP_ELEVATION_LIMITS } from '../shared/cartography';
import { createSeed } from '../shared/seed';
import { validateWorkspace } from '../server/validation';
import { DemoStore } from '../server/store';
import { exportMarkdown } from '../src/lib/export';
import { createEditorFixture } from './fixtures/map-editor';
import { createElevationFixture } from './fixtures/elevation';

function fixture() {
  const data = createSeed();
  const editor = createEditorFixture();
  assert.equal(editor.generation?.version, 2);
  if (editor.generation?.version !== 2) throw new Error('Expected a v2 fixture');
  const elevation = createElevationFixture();
  editor.generation.elevation = elevation;
  data.maps[0].editor = editor;
  return { data, elevation };
}

test('height recipes and ordered edits survive JSON validation without changing legacy recipes', () => {
  for (const preset of ['sketch', 'continent', 'archipelago', 'highlands'] as const) {
    const { data, elevation } = fixture();
    elevation.preset = preset;
    assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(data))), data);
  }
  const data = createSeed();
  data.maps[0].editor = createEditorFixture();
  const oldRecipe = data.maps[0].editor.generation!;
  assert.deepEqual(validateWorkspace(data), data);
  assert.equal(
    Object.hasOwn(validateWorkspace(data).maps[0].editor!.generation!, 'elevation'),
    false,
  );
  data.maps[0].editor.regions[0].biome = 'forest';
  data.maps[0].editor.generation = {
    version: 1,
    seed: oldRecipe.seed,
    climate: oldRecipe.climate,
    settlements: oldRecipe.settlements,
    rivers: oldRecipe.rivers,
    routes: oldRecipe.routes,
  };
  assert.deepEqual(validateWorkspace(data), data);
  Object.assign(data.maps[0].editor.generation, { elevation: createElevationFixture() });
  assert.throws(() => validateWorkspace(data), /Unrecognized key/);
});

test('height recipe schema rejects unknown fields and invalid finite scalar values', () => {
  for (const patch of [
    { version: 2 },
    { version: undefined },
    { preset: 'volcano' },
    { preset: undefined },
    { seed: -1 },
    { seed: 4_294_967_296 },
    { seed: 0.5 },
    { seed: '1' },
    { relief: 0.249 },
    { relief: 2.001 },
    { relief: Number.NaN },
    { relief: Infinity },
    { seaLevel: -1001 },
    { seaLevel: 1001 },
    { seaLevel: -Infinity },
    { seaLevel: null },
    { strokes: null },
    { strokes: undefined },
    { heightPixels: [] },
  ]) {
    const { data, elevation } = fixture();
    Object.assign(elevation, patch);
    assert.throws(() => validateWorkspace(data), JSON.stringify(patch));
  }
  for (const patch of [
    { id: '' },
    { id: 'invalid id' },
    { operation: 'erode' },
    { operation: undefined },
    { width: 4 },
    { width: 501 },
    { width: Number.NaN },
    { width: '100' },
    { strength: -0.01 },
    { strength: 1.01 },
    { strength: Infinity },
    { strength: undefined },
    { target: -2001 },
    { target: 6001 },
    { target: Number.NaN },
    { target: undefined },
    { points: [] },
    { points: [{ x: Infinity, y: 1 }] },
    { points: [{ x: 1, y: 1, z: 1 }] },
    { hidden: true },
  ]) {
    const { data, elevation } = fixture();
    Object.assign(elevation.strokes[0], patch);
    assert.throws(() => validateWorkspace(data), JSON.stringify(patch));
  }
});

test('height coordinates, stroke IDs and capacity are bounded across the whole workspace', () => {
  for (const point of [
    { x: -0.1, y: 0 },
    { x: 0, y: -0.1 },
    { x: 10001, y: 0 },
    { x: 0, y: 10001 },
  ]) {
    const { data, elevation } = fixture();
    elevation.strokes[0].points = [point];
    assert.throws(() => validateWorkspace(data), /Elevation point outside map/);
  }
  const identityFixture = fixture();
  for (const id of [
    identityFixture.data.worlds[0].id,
    identityFixture.data.maps[0].id,
    identityFixture.data.maps[0].pins[0].id,
    identityFixture.data.maps[0].editor!.regions[0].id,
    identityFixture.data.maps[0].editor!.objects[0].id,
    identityFixture.elevation.strokes[1].id,
  ]) {
    const { data, elevation } = fixture();
    elevation.strokes[0].id = id;
    assert.throws(() => validateWorkspace(data), /Duplicate ID/);
  }
  const repeated = (count: number, points: number) => {
    const value = fixture();
    value.elevation.strokes = Array.from({ length: count }, (_, index) => ({
      ...value.elevation.strokes[0],
      id: `height_${index}`,
      points: Array.from({ length: points }, () => ({ x: 10, y: 10 })),
    }));
    return value.data;
  };
  assert.doesNotThrow(() => validateWorkspace(repeated(MAP_ELEVATION_LIMITS.strokes, 1)));
  assert.throws(() => validateWorkspace(repeated(MAP_ELEVATION_LIMITS.strokes + 1, 1)));
  assert.doesNotThrow(() => validateWorkspace(repeated(1, MAP_ELEVATION_LIMITS.points)));
  assert.throws(() => validateWorkspace(repeated(1, MAP_ELEVATION_LIMITS.points + 1)));
  assert.doesNotThrow(() => validateWorkspace(repeated(32, 256)));
  assert.throws(
    () => validateWorkspace(repeated(33, 256)),
    /Elevation edits exceed 8192 total points/,
  );
});

test('height range endpoints and map edges are valid without clamping stored input', () => {
  for (const upper of [false, true]) {
    const { data, elevation } = fixture();
    const map = data.maps[0];
    elevation.seed = upper ? 4_294_967_295 : 0;
    elevation.relief = upper ? 2 : 0.25;
    elevation.seaLevel = upper ? 1000 : -1000;
    elevation.strokes[0].width = upper ? 500 : 5;
    elevation.strokes[0].strength = upper ? 1 : 0;
    elevation.strokes[0].target = upper ? 6000 : -2000;
    elevation.strokes[0].points = [
      { x: 0, y: 0 },
      { x: map.width, y: map.height },
    ];
    assert.deepEqual(validateWorkspace(data), data);
  }
});

test('saved height edits persist after a DemoStore restart alongside unchanged legacy maps', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worldloom-height-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'workspace.json');
  const first = await new DemoStore(filename).initialize();
  const { data } = fixture();
  await first.save(data, 0);
  const restored = await (await new DemoStore(filename).initialize()).read();
  assert.equal(restored.revision, 1);
  assert.deepEqual(restored.data, data);
  assert.deepEqual(restored.data.maps.slice(1), createSeed().maps.slice(1));
});

test('partial Markdown map export describes height source and ordered edits, and obeys map selection', () => {
  const { data } = fixture();
  data.maps[0].visibility = 'public';
  const options = {
    worldId: data.worlds[0].id,
    entityIds: [],
    includeMaps: true,
    includeRelations: false,
    includePlots: false,
    includeSessions: false,
    includeSecrets: false,
  };
  const markdown = exportMarkdown(data, options);
  assert.match(
    markdown,
    /海拔地形：版本 1；基础地貌 大陆；种子 91827；起伏 1.25 倍；海平面 -120 米；编辑 4 笔/,
  );
  assert.match(
    markdown,
    /海拔编辑 1：抬高；笔刷直径 120 地图单位；强度 70%；2 个控制点，\(12, 15\) → \(48, 60\)/,
  );
  assert.match(markdown, /海拔编辑 2：降低/);
  assert.match(markdown, /海拔编辑 3：整平；笔刷直径 100 地图单位；强度 65%；目标海拔 1500 米/);
  assert.match(markdown, /海拔编辑 4：平滑/);
  assert(markdown.indexOf('海拔编辑 1') < markdown.indexOf('海拔编辑 4'));
  assert(!exportMarkdown(data, { ...options, includeMaps: false }).includes('海拔地形'));
  assert(!exportMarkdown(createSeed(), options).includes('海拔地形'));
});
