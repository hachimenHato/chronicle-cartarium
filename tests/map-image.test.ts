import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSeed } from '../shared/seed';
import { mapSymbolIds, symbolCatalog, symbolCategories } from '../shared/cartography';
import { validateWorkspace } from '../server/validation';
import { MapGlyph } from '../src/components/MapArtwork';
import { fitMapImage } from '../src/lib/map-image';
import { bakeMapArtwork, createEditorData, createMapObject } from '../src/lib/cartography';
import { resizeMap } from '../src/lib/map-scale';
import { exportMarkdown } from '../src/lib/export';

const url = '/uploads/image-fixture.png';
const fixture = () => {
  const data = createSeed(),
    map = data.maps[0];
  map.seed = 0;
  map.pins = [];
  map.strokes = [];
  map.editor = {
    ...createEditorData(),
    mode: 'detail',
    baseVisible: false,
    objects: [fitMapImage(url, '遗迹底图', map.width, map.height, 1200, 800)],
  };
  return data;
};

test('expanded symbol catalog has a distinct renderable glyph and validated contract for every entry', () => {
  assert.deepEqual([...mapSymbolIds].sort(), symbolCatalog.map((s) => s.id).sort());
  const data = fixture();
  const glyphs = symbolCatalog.map((symbol) => {
    assert.ok(symbol.category in symbolCategories);
    const markup = renderToStaticMarkup(
      createElement('svg', {}, createElement(MapGlyph, { kind: symbol.id })),
    );
    assert.match(markup, /<(path|circle|ellipse|rect|polygon)/);
    assert.doesNotMatch(markup, /NaN|undefined|Infinity|<image|<script/);
    data.maps[0].editor!.objects.push(
      createMapObject('symbol', { x: 50, y: 50 }, { symbol: symbol.id }),
    );
    return markup;
  });
  assert.equal(new Set(glyphs).size, 66);
  assert.deepEqual(validateWorkspace(data), data);
  assert.deepEqual(
    new Set(symbolCatalog.map((s) => s.category)),
    new Set(Object.keys(symbolCategories)),
  );
});

test('image placement contains every aspect ratio, centers it, and defaults to a locked layer', () => {
  for (const [iw, ih] of [
    [1200, 800],
    [100, 3000],
    [3000, 100],
    [500, 500],
  ]) {
    for (const overlay of [false, true]) {
      const object = fitMapImage(url, '  底图  ', 1000, 640, iw, ih, overlay),
        [a, b] = object.points;
      assert.equal(object.name, '底图');
      assert.equal(object.locked, true);
      assert.equal(object.layer, overlay ? 'detail' : 'base');
      assert.ok(a.x >= 0 && a.y >= 0 && b.x <= 1000 && b.y <= 640 && b.x > a.x && b.y > a.y);
      assert.ok(Math.abs((b.x - a.x) / (b.y - a.y) - iw / ih) < 1e-8);
      assert.equal(a.x + b.x, 1000);
      assert.equal(a.y + b.y, 640);
    }
  }
  assert.throws(() => fitMapImage(url, '图', 1000, 640, 0, 100));
  assert.throws(() => fitMapImage(url, '图', 1000, 640, Infinity, 100));
  // Large valid rasters can round their fitted width a few ulps beyond the canvas.
  const large = fitMapImage(url, '大尺寸底图', 10000, 1000, 16673, 1000);
  assert.equal(large.points[0].x, 0);
  assert.equal(large.points[1].x, 10000);
});

test('image validation rejects arbitrary URLs, missing media, degenerate geometry and misuse on vector objects', () => {
  const invalid = [
    { imageUrl: undefined },
    { imageUrl: 'https://example.com/image.png' },
    { imageUrl: '/uploads/../image.png' },
    { imageUrl: '/uploads/fixture.svg' },
    { imageUrl: 'data:image/png;base64,abc' },
    { points: [{ x: 10, y: 10 }] },
    {
      points: [
        { x: 10, y: 10 },
        { x: 10, y: 30 },
      ],
    },
    {
      points: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
      ],
    },
    {
      points: [
        { x: 30, y: 30 },
        { x: 10, y: 10 },
      ],
    },
    {
      points: [
        { x: 10, y: 10 },
        { x: 30, y: 30 },
        { x: 50, y: 50 },
      ],
    },
    { kind: 'symbol', symbol: 'tree', points: [{ x: 10, y: 10 }] },
  ];
  for (const change of invalid) {
    const data = fixture();
    Object.assign(data.maps[0].editor!.objects[0], change);
    assert.throws(() => validateWorkspace(data), JSON.stringify(change));
  }
});

test('image metadata survives backup, map resize and freezing without discarding authored layers', () => {
  const data = fixture(),
    map = data.maps[0],
    image = map.editor!.objects[0];
  const overlay = {
    ...fitMapImage('/uploads/overlay.webp', '参考图', map.width, map.height, 900, 600, true),
    opacity: 0.45,
    rotation: 12,
  };
  map.editor!.objects.push(overlay);
  assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(data))), data);
  const frozen = bakeMapArtwork(map);
  assert.deepEqual(
    frozen.filter((o) => o.kind === 'image'),
    [image, { ...overlay, layer: 'base' }],
  );
  const resized = resizeMap(map, map.width * 2, map.height * 1.5, 400);
  assert.deepEqual(
    resized.editor!.objects[0].points,
    image.points.map((p) => ({ x: p.x * 2, y: p.y * 1.5 })),
  );
  assert.equal(resized.editor!.objects[1].imageUrl, overlay.imageUrl);
  assert.equal(resized.editor!.objects[1].opacity, 0.45);
  const backup = structuredClone(data);
  backup.maps[0] = resized;
  assert.deepEqual(validateWorkspace(backup), backup);
  assert.deepEqual(map.editor!.objects, [image, overlay]);
});

test('Markdown includes image references and the resource migration requirement', () => {
  const data = fixture();
  const markdown = exportMarkdown(data, {
    worldId: data.worlds[0].id,
    entityIds: [],
    includeMaps: true,
    includeRelations: false,
    includePlots: false,
    includeSessions: false,
    includeSecrets: true,
  });
  assert.match(markdown, /遗迹底图/);
  assert.ok(markdown.includes(url));
  assert.match(markdown, /备份 uploads 目录/);
});
