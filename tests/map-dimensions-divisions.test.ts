import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSeed } from '../shared/seed';
import type { AtlasMap } from '../shared/model';
import type { DivisionPaint } from '../shared/cartography';
import { createEditorFixture } from './fixtures/map-editor';
import { createElevationFixture } from './fixtures/elevation';
import { resizeMap, mapScaleBar } from '../src/lib/map-scale';
import { divisionAt, divisionAnchor, divisionStrokePath } from '../src/lib/divisions';
import { generateSketchMap } from '../src/lib/sketch-generation';
import { generateTerrain } from '../src/lib/terrain';
import { workspaceSchema } from '../server/validation';
import { DemoStore } from '../server/store';
import { exportMarkdown } from '../src/lib/export';
import { saveEntityInWorkspace } from '../src/lib/workspace-mutations';

function fixture() {
  const data = createSeed(),
    map = data.maps[0];
  map.scaleKm = 400;
  map.editor = createEditorFixture();
  map.strokes = [
    {
      id: 'resize_stroke',
      tool: 'brush',
      width: 12,
      color: '#587b7f',
      points: [
        { x: 100, y: 120 },
        { x: 190, y: 130 },
      ],
    },
  ];
  const faction = data.entities.find((e) => e.type === 'faction')!;
  map.editor.divisions = [
    {
      id: 'country_a',
      kind: 'country',
      name: faction.name,
      entityId: faction.id,
      color: '#a36550',
      visible: true,
    },
    { id: 'country_b', kind: 'country', name: '南境', color: '#587b7f', visible: true },
    { id: 'culture_a', kind: 'culture', name: '古文化', color: '#82854d', visible: true },
  ];
  const stroke = (id: string, divisionId: string, x: number): DivisionPaint => ({
    id,
    divisionId,
    operation: 'paint',
    geometry: 'brush',
    points: [
      { x, y: 240 },
      { x: x + 120, y: 260 },
    ],
    width: 120,
    roughness: 0.3,
    seed: 91,
  });
  map.editor.divisionPaint = [
    stroke('border_a', 'country_a', 240),
    stroke('border_b', 'country_b', 300),
    stroke('border_c', 'culture_a', 240),
  ];
  return data;
}
test('resizing adapts every authored geometry including elevation and borders without mutation', () => {
  const data = fixture(),
    original = structuredClone(data.maps[0]);
  const map = data.maps[0];
  if (map.editor!.generation?.version === 2)
    map.editor!.generation.elevation = createElevationFixture();
  const before = structuredClone(map),
    result = resizeMap(map, map.width * 2, map.height * 2, 12000);
  assert.equal(result.pins[0].x, before.pins[0].x * 2);
  assert.equal(result.strokes[0].points[0].y, before.strokes[0].points[0].y * 2);
  assert.equal(result.editor!.regions[0].width, before.editor!.regions[0].width * 2);
  assert.equal(result.editor!.objects[0].size, before.editor!.objects[0].size * 2);
  assert.equal(result.editor!.divisionPaint![0].points[0].x, 480);
  if (result.editor!.generation?.version === 2 && before.editor!.generation?.version === 2)
    assert.equal(
      result.editor!.generation.elevation!.strokes[0].width,
      Math.min(500, before.editor!.generation.elevation!.strokes[0].width * 2),
    );
  assert.deepEqual(map, before);
  assert.deepEqual(result.editor!.divisions, original.editor!.divisions);
  data.maps[0] = result;
  assert(workspaceSchema.safeParse(data).success);
  const narrow = resizeMap(result, 100, 100, 0.01);
  data.maps[0] = narrow;
  assert(workspaceSchema.safeParse(data).success);
  assert.throws(() => resizeMap(map, 99, 640, 400));
  assert.throws(() => resizeMap(map, 1000, 640, NaN));
});
test('geographic-only resize preserves coordinates and the scale bar follows the coverage', () => {
  const map = fixture().maps[0],
    result = resizeMap(map, map.width, map.height, 12000);
  assert.deepEqual(result.pins, map.pins);
  assert.deepEqual(result.editor!.divisionPaint, map.editor!.divisionPaint);
  const bar = mapScaleBar(result);
  assert.equal(bar.width / result.width, bar.km / 12000);
  assert(mapScaleBar({ ...map, scaleKm: 0.01 }).label.includes('m'));
});
test('same-layer borders overwrite, erase leaves a hole and other thematic layers remain independent', () => {
  const map = fixture().maps[0],
    p = { x: 330, y: 250 };
  assert.equal(divisionAt(map, 'country', p)?.id, 'country_b');
  assert.equal(divisionAt(map, 'culture', p)?.id, 'culture_a');
  map.editor!.divisionPaint!.push({
    ...map.editor!.divisionPaint![1],
    id: 'hole',
    operation: 'erase',
    points: [p],
    width: 25,
  });
  assert.equal(
    divisionAt(map, 'country', p),
    undefined,
    'Erasing must not restore an older country',
  );
  assert.equal(divisionAt(map, 'country', { x: 410, y: 260 })?.id, 'country_b');
  assert.equal(divisionAt(map, 'culture', p)?.id, 'culture_a');
  const anchor = divisionAnchor(map, 'country_b');
  assert(anchor);
  assert.equal(divisionAt(map, 'country', anchor)?.id, 'country_b');
});
test('natural brush outlines are deterministic, curved, clipped and exact polygons retain precision', () => {
  const map = fixture().maps[0],
    stroke = map.editor!.divisionPaint![0];
  const drawn = divisionStrokePath(stroke, map.width, map.height);
  assert.equal(drawn, divisionStrokePath(structuredClone(stroke), map.width, map.height));
  assert((drawn.match(/L/g) ?? []).length > 60);
  assert.notEqual(drawn, divisionStrokePath({ ...stroke, roughness: 0 }, map.width, map.height));
  const polygon = {
    ...stroke,
    geometry: 'polygon' as const,
    roughness: 0,
    points: [
      { x: 10.12, y: 20.34 },
      { x: 70, y: 25 },
      { x: 55, y: 90 },
    ],
  };
  assert.equal(divisionStrokePath(polygon, 100, 100), 'M10.12,20.34 L70,25 L55,90 Z');
  assert(divisionStrokePath({ ...stroke, points: [{ x: 0, y: 0 }] }, 100, 100).length);
});
test('strict map validation enforces dimensions, type/world associations, ownership refs and capacities', () => {
  const data = fixture();
  assert(workspaceSchema.safeParse(data).success);
  const bad = (mutate: (data: ReturnType<typeof fixture>) => void) => {
    const copy = structuredClone(data);
    mutate(copy);
    assert.equal(workspaceSchema.safeParse(copy).success, false);
  };
  bad((v) => {
    v.maps[0].scaleKm = Infinity;
  });
  bad((v) => {
    v.maps[0].editor!.divisions![0].entityId = v.entities.find((e) => e.type === 'character')!.id;
  });
  bad((v) => {
    v.worlds.push({ ...v.worlds[0], id: 'another_world' });
    v.entities.find((e) => e.id === v.maps[0].editor!.divisions![0].entityId)!.worldId =
      'another_world';
  });
  bad((v) => {
    v.maps[0].editor!.divisionPaint![0].divisionId = 'missing';
  });
  bad((v) => {
    v.maps[0].editor!.divisionPaint![0].points[0].x = 10001;
  });
  bad((v) => {
    v.maps[0].editor!.divisionPaint![0].id = v.maps[0].editor!.divisions![0].id;
  });
  bad((v) => {
    v.maps[0].editor!.divisionPaint = Array.from({ length: 65 }, (_, i) => ({
      ...v.maps[0].editor!.divisionPaint![0],
      id: `large_${i}`,
      points: Array.from({ length: 256 }, () => ({ x: 10, y: 10 })),
    }));
  });
});
test('new physical scales affect actual generated terrain, drainage and settlements, retaining legacy recipes', () => {
  const map = fixture().maps[0];
  const regions = [
    {
      ...map.editor!.regions[0],
      biome: 'grass' as const,
      points: [
        { x: 140, y: 120 },
        { x: 860, y: 120 },
        { x: 860, y: 520 },
        { x: 140, y: 520 },
      ],
    },
  ];
  const settings = {
    version: 2 as const,
    detail: 'standard' as const,
    linework: 'organic' as const,
    climate: 'temperate' as const,
    seed: 7281,
    settlements: 8,
    rivers: true,
    routes: true,
  };
  const region = generateSketchMap(regions, 1000, 640, settings, 400);
  const world = generateSketchMap(regions, 1000, 640, settings, 12000);
  assert.notDeepEqual(
    region.diagnostics.cells.map((c) => c.elevation),
    world.diagnostics.cells.map((c) => c.elevation),
  );
  assert.notDeepEqual(region.diagnostics.rivers, world.diagnostics.rivers);
  assert.notDeepEqual(region.diagnostics.settlements, world.diagnostics.settlements);
  assert.deepEqual(world, generateSketchMap(regions, 1000, 640, settings, 12000));
  assert.deepEqual(region, generateSketchMap(regions, 1000, 640, settings));
  const large = generateSketchMap(regions, 2000, 1280, settings, 12000);
  assert(large.diagnostics.cells.length > world.diagnostics.cells.length);
  assert.notDeepEqual(
    generateTerrain(101, 1000, 640, 'town', 100),
    generateTerrain(101, 1000, 640, 'town', 10),
  );
});
test('division references rename with entities and private divisions are excluded from player Markdown', () => {
  const data = fixture(),
    entity = data.entities.find((e) => e.id === data.maps[0].editor!.divisions![0].entityId)!;
  const renamed = saveEntityInWorkspace(data, { ...entity, name: '新国名' });
  assert.equal(renamed.maps[0].editor!.divisions![0].name, '新国名');
  const options = {
    worldId: data.worlds[0].id,
    entityIds: data.entities.map((e) => e.id),
    includeMaps: true,
    includeRelations: false,
    includePlots: false,
    includeSessions: false,
    includeSecrets: true,
  };
  assert(exportMarkdown(data, options).includes('国家分区'));
  assert(exportMarkdown(data, options).includes('400 km'));
  entity.visibility = 'gm';
  data.maps[0].visibility = 'public';
  const publicText = exportMarkdown(data, { ...options, includeSecrets: false });
  assert(!publicText.includes(`分区 **${entity.name}**`));
  assert(publicText.includes('古文化'));
});
test('full map sizing and division paint survive DemoStore and JSON restoration', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'worldloom-divisions-'));
  try {
    const filename = path.join(directory, 'workspace.json');
    const data = fixture(),
      store = await new DemoStore(filename).initialize();
    await store.save(data, 0);
    const restored = await new DemoStore(filename).initialize();
    assert.deepEqual((await restored.read()).data, JSON.parse(JSON.stringify(data)));
    assert(workspaceSchema.safeParse((await restored.read()).data).success);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
