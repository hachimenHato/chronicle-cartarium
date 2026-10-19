import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLASSICAL_RELIEF_LIMIT, makeClassicalRelief } from '../src/lib/classical-relief';
import type { SketchCell } from '../src/lib/sketch-generation-v1';
import { createSeed } from '../shared/seed';
import { validateWorkspace } from '../server/validation';
import { generateSketchMapV2 } from '../src/lib/sketch-generation-v2';
import type { MapObject, MapRegion, SketchGenerationSettings } from '../shared/cartography';

const peaks = (objects: MapObject[]) => objects.filter((o) => o.name.endsWith('峰谷轮廓'));

function terrain(columns: number, rows: number, width = 1000, height = 640) {
  return Array.from({ length: columns * rows }, (_, index): SketchCell => {
    const x = ((index % columns) + 0.5) * (width / columns),
      y = (Math.floor(index / columns) + 0.5) * (height / rows);
    const u = x / width,
      v = y / height;
    const elevation =
      0.12 +
      0.72 * Math.exp(-(((u - 0.5) / 0.27) ** 2 + ((v - 0.47) / 0.24) ** 2)) +
      0.045 * Math.sin(u * 36) * Math.cos(v * 30);
    return {
      x,
      y,
      elevation,
      land: u > 0.08 && u < 0.92 && v > 0.08 && v < 0.92,
      biome: 'mountain',
      drainageElevation: elevation,
      downstream: -1,
      moisture: 0.5,
      slope: 0.05,
      accumulation: 1,
    };
  });
}

test('connected engraved ridges follow high ground without changing height or adding mountain icons', () => {
  const cells = terrain(160, 102),
    before = structuredClone(cells);
  const objects = makeClassicalRelief(cells, 160, 102, 1000, 640, 29);
  assert(objects.length > 70, 'mountain field must produce recognisable pictorial relief');
  assert(objects.length <= CLASSICAL_RELIEF_LIMIT);
  assert.deepEqual(cells, before);
  assert.deepEqual(makeClassicalRelief(cells, 160, 102, 1000, 640, 29), objects);
  assert.notDeepEqual(makeClassicalRelief(cells, 160, 102, 1000, 640, 39), objects);
  assert.equal(new Set(objects.map((object) => object.id)).size, objects.length);
  const ridges = objects.filter((object) => object.name.endsWith('连续山脊'));
  assert(ridges.length > 0);
  assert(
    ridges.every((ridge) => ridge.points.length >= 8),
    'neighboring peaks join through curved saddles',
  );
  assert(!objects.some((object) => object.kind === 'symbol' || object.name.endsWith('峰面')));
  assert(objects.some((object) => object.name.endsWith('细钢笔排线')));
  assert(objects.some((object) => object.name.endsWith('连绵鞍部')));
  assert(
    objects
      .filter((object) => object.name.endsWith('连绵鞍部'))
      .every(
        (object) => object.kind === 'path' && object.color === 'none' && object.opacity <= 0.12,
      ),
    'saddle connections must never leave opaque shelves between summits',
  );
  const bodies = objects.filter((object) => object.name.endsWith('连绵山体'));
  assert(
    new Set(bodies.map((body) => body.opacity)).size >= 3,
    'mountain washes fade toward the ground',
  );
  for (const ridge of ridges)
    for (const p of ridge.points) {
      const cell = cells[Math.floor(p.y / (640 / 102)) * 160 + Math.floor(p.x / (1000 / 160))];
      assert(cell?.land, 'mountain and foothill ridges must remain on actual land');
    }
  assert.equal(
    makeClassicalRelief(
      cells.map((c) => ({ ...c, elevation: 0.15 })),
      160,
      102,
      1000,
      640,
      29,
    ).length,
    0,
  );
  assert.equal(
    makeClassicalRelief(
      cells.map((c) => ({ ...c, elevation: 0.8 })),
      160,
      102,
      1000,
      640,
      29,
    ).length,
    0,
    'a level high plateau must not acquire fictional summits',
  );
  assert.equal(
    makeClassicalRelief(
      cells.map((c) => ({ ...c, land: false })),
      160,
      102,
      1000,
      640,
      29,
    ).length,
    0,
  );
});

test('classical engraving remains bounded, sharp, editable, and consistent in physical scale across resolutions', () => {
  const counts: number[] = [];
  for (const columns of [192, 288, 384]) {
    const rows = Math.round(columns * 0.64),
      cells = terrain(columns, rows),
      objects = makeClassicalRelief(cells, columns, rows, 1000, 640, 29);
    counts.push(objects.length);
    for (const object of objects) {
      assert(['path', 'polygon'].includes(object.kind));
      assert(!object.blur);
      assert(object.points.length <= 2000);
      assert(object.strokeWidth >= 0 && object.strokeWidth < 1);
      for (const point of object.points) {
        assert(Number.isFinite(point.x) && Number.isFinite(point.y));
        assert(point.x >= 0 && point.x <= 1000 && point.y >= 0 && point.y <= 640);
      }
    }
  }
  assert(
    Math.max(...counts) / Math.min(...counts) < 1.3,
    'higher sampling must not multiply peak density',
  );
  const small = makeClassicalRelief(terrain(80, 51, 80, 51), 80, 51, 80, 51, 29);
  assert(
    small.length > 0 &&
      small.every((object) => object.points.every((point) => point.x <= 80 && point.y <= 51)),
  );
  assert.deepEqual(makeClassicalRelief([], 0, 0, 1000, 640, 29), []);
});

test('a deep inland gorge separates mountain backbones instead of acquiring an invented ridge', () => {
  const cells = terrain(288, 184);
  for (const cell of cells) if (cell.x > 465 && cell.x < 535) cell.elevation = 0.1;
  const objects = makeClassicalRelief(cells, 288, 184, 1000, 640, 29);
  const passes = objects.filter((object) => object.name.endsWith('连绵鞍部'));
  assert(passes.length > 0);
  assert(objects.some((object) => object.name.endsWith('峰谷轮廓') && object.points[0].x < 465));
  assert(objects.some((object) => object.name.endsWith('峰谷轮廓') && object.points[0].x > 535));
  for (const pass of passes)
    assert(
      !(
        Math.min(...pass.points.map((p) => p.x)) < 465 &&
        Math.max(...pass.points.map((p) => p.x)) > 535
      ),
      'saddles must not bridge the low gorge merely because two summits are close',
    );
});

test('pictorial relief stays inland around narrow lakes and accepts the persistent object contract', () => {
  for (const [width, height, columns, rows] of [
    [1000, 640, 288, 184],
    [640, 1000, 184, 288],
    [10000, 6400, 384, 246],
  ]) {
    const cells = terrain(columns, rows, width, height);
    // A narrow, curved flooded channel passes through the mountain chain. Its
    // width is smaller than a mountain symbol, exercising a case that checking
    // only the icon's anchor or a few corners cannot safely cover.
    for (const cell of cells)
      if (
        Math.abs(cell.x / width - 0.49 - 0.06 * Math.sin((cell.y / height) * 14)) < 0.008 &&
        cell.y > height * 0.22 &&
        cell.y < height * 0.66
      ) {
        cell.land = false;
        cell.elevation = -0.1;
      }
    const objects = makeClassicalRelief(cells, columns, rows, width, height, 29);
    assert(objects.length > 70 && objects.length <= CLASSICAL_RELIEF_LIMIT);
    for (const object of objects)
      for (
        let index = 0;
        index < (object.kind === 'polygon' ? object.points.length : object.points.length - 1);
        index++
      ) {
        const start = object.points[index];
        const end = object.points[(index + 1) % object.points.length];
        const steps = Math.ceil(
          Math.hypot(end.x - start.x, end.y - start.y) /
            (Math.min(width / columns, height / rows) / 3),
        );
        for (let step = 0; step <= steps; step++) {
          const t = steps ? step / steps : 0;
          const x = start.x + (end.x - start.x) * t;
          const y = start.y + (end.y - start.y) * t;
          const cell =
            cells[Math.floor((y / height) * rows) * columns + Math.floor((x / width) * columns)];
          assert(cell?.land, 'engraved silhouettes must not project over lakes or sea');
        }
      }
    const workspace = createSeed();
    workspace.maps[0] = {
      ...workspace.maps[0],
      width,
      height,
      pins: [],
      strokes: [],
      editor: { version: 1, mode: 'detail', baseVisible: false, regions: [], objects },
    };
    assert.doesNotThrow(() => validateWorkspace(workspace));
  }
});

test('dense highlands cover the range while regional density can still make them sparse or empty', () => {
  const cells = terrain(288, 184);
  const withDensity = (value: number) =>
    makeClassicalRelief(cells, 288, 184, 1000, 640, 29, {
      density: new Float64Array(cells.length).fill(value),
    });
  const dense = withDensity(1),
    sparse = withDensity(0.15);
  assert(
    peaks(dense).length > 110,
    'broad highlands must no longer be limited to 38 isolated peaks',
  );
  assert(
    peaks(dense).length > peaks(sparse).length * 2,
    'density must change actual peak coverage',
  );
  assert.deepEqual(withDensity(0), []);
  assert(
    dense.some(
      (o) => o.name.endsWith('细钢笔排线') && o.kind === 'polygon' && o.points.length > 100,
    ),
    'fine tapered hatching must remain present without one object for every pen stroke',
  );
  for (const [left, upper] of [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ]) {
    const covered = peaks(dense).filter((o) => {
      const x = o.points.reduce((sum, p) => sum + p.x, 0) / o.points.length;
      const y = o.points.reduce((sum, p) => sum + p.y, 0) / o.points.length;
      return x < 500 === left && y < 300 === upper;
    });
    assert(covered.length >= 15, 'dense decoration must cover both flanks of the range');
  }
});

test('a restricted art budget keeps both separated ranges and complete mountain bodies', () => {
  const cells = terrain(288, 184);
  for (const c of cells) {
    const v = (c.y / 640 - 0.5) / 0.24;
    c.elevation =
      0.12 +
      0.84 * Math.exp(-(((c.x / 1000 - 0.28) / 0.16) ** 2 + v ** 2)) +
      0.63 * Math.exp(-(((c.x / 1000 - 0.74) / 0.16) ** 2 + v ** 2));
  }
  for (const objectBudget of [18, 19, 200, 760]) {
    const objects = makeClassicalRelief(cells, 288, 184, 1000, 640, 29, { objectBudget });
    assert(objects.length <= objectBudget);
    assert.equal(
      objects.filter((o) => o.name.endsWith('连绵山体')).length,
      peaks(objects).length * 3,
      'budgeting must not truncate a mountain halfway through its rendering',
    );
  }
  const objects = makeClassicalRelief(cells, 288, 184, 1000, 640, 29, { objectBudget: 760 });
  assert(peaks(objects).filter((o) => o.points[0].x < 500).length >= 10);
  assert(
    peaks(objects).filter((o) => o.points[0].x > 500).length >= 10,
    'the smaller range must not lose all its mountains to the taller range',
  );
});

test('changing color-brush density changes mountain art without changing geography or networks', () => {
  const source: MapRegion[] = [
    {
      id: 'land',
      name: 'land',
      biome: 'grass',
      geometry: 'brush',
      points: [
        { x: 230, y: 320 },
        { x: 760, y: 330 },
      ],
      width: 380,
      seed: 527,
      roughness: 0.35,
      density: 0.75,
      visible: true,
      locked: false,
    },
    {
      id: 'range',
      name: 'range',
      biome: 'mountain',
      geometry: 'brush',
      points: [
        { x: 350, y: 230 },
        { x: 650, y: 260 },
      ],
      width: 145,
      seed: 527,
      roughness: 0.35,
      density: 0.9,
      visible: true,
      locked: false,
    },
  ];
  const settings: Extract<SketchGenerationSettings, { version: 2 }> = {
    version: 2,
    detail: 'standard',
    linework: 'organic',
    seed: 471,
    climate: 'temperate',
    settlements: 5,
    rivers: true,
    routes: true,
  };
  const dense = generateSketchMapV2(source, 1000, 640, settings);
  const sparse = generateSketchMapV2(
    source.map((r) => (r.id === 'range' ? { ...r, density: 0.1 } : r)),
    1000,
    640,
    settings,
  );
  const primary = (objects: MapObject[]) =>
    peaks(objects).filter((o) => !o.name.includes('very-low/'));
  const denseCount = primary(dense.objects).length,
    sparseCount = primary(sparse.objects).length;
  assert(
    denseCount > sparseCount * 1.5,
    `painted mountain density must affect the main range (${denseCount} dense vs ${sparseCount} sparse); unchanged low foothills are separate`,
  );
  assert.deepEqual(dense.elevation, sparse.elevation);
  for (const key of [
    'rivers',
    'riverChannels',
    'routes',
    'roadPaths',
    'bridges',
    'settlements',
  ] as const)
    assert.deepEqual(dense.diagnostics[key], sparse.diagnostics[key]);
  assert.deepEqual(dense.stats, sparse.stats);
  assert(dense.objects.length <= 8000);
});
