import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSeed } from '../shared/seed';
import {
  mapFeatures,
  featureHidden,
  toggleMapFeature,
  hiddenFeatureObjects,
} from '../shared/map-features';
import { addGeographicFixture } from './fixtures/geographic';
import { createMapObject, bakeMapArtwork } from '../src/lib/cartography';
import { generationSignature } from '../src/lib/generated-map';
import { authoredLegend } from '../src/lib/map-legend';
import { layoutCartographicLabels } from '../src/lib/cartographic-labels';

function fixture() {
  const map = addGeographicFixture(createSeed()).maps[0];
  map.pins = [];
  map.strokes = [];
  map.editor!.objects = [];
  map.editor!.regions = [];
  const snapshot = map.editor!.generated!;
  snapshot.objects = [
    createMapObject(
      'symbol',
      { x: 760, y: 140 },
      { id: 'city_roof', name: '聚落 1 · 地标', symbol: 'city' },
    ),
    createMapObject('polygon', { x: 760, y: 140 }, { id: 'city_shadow', name: '聚落 1 · 投影' }),
    createMapObject('text', { x: 760, y: 160 }, { id: 'city_label', name: '聚落 1 · 名称' }),
    createMapObject(
      'symbol',
      { x: 760, y: 500 },
      { id: 'town_roof', name: '聚落 2 · 地标', symbol: 'town' },
    ),
    ...[1, 2].flatMap((i) => [
      createMapObject(
        'path',
        { x: 100, y: 100 },
        {
          id: `road_${i}`,
          name: `道路 ${i}`,
          points: [
            { x: 100, y: 100 },
            { x: 400, y: 400 },
          ],
          stroke: '#654321',
        },
      ),
      createMapObject(
        'path',
        { x: 100, y: 100 },
        {
          id: `road_base_${i}`,
          name: `道路 ${i} · 路基`,
          points: [
            { x: 100, y: 100 },
            { x: 400, y: 400 },
          ],
          stroke: '#eee',
        },
      ),
    ]),
    createMapObject(
      'path',
      { x: 250, y: 250 },
      {
        id: 'shared_bridge',
        name: '道路桥栏',
        points: [
          { x: 245, y: 250 },
          { x: 255, y: 250 },
        ],
      },
    ),
  ];
  return map;
}

test('individual feature display preserves complete settlement groups and shared bridge ownership', () => {
  const map = fixture(),
    before = structuredClone(map);
  const hiddenCity = toggleMapFeature(map, 'settlements', 'city_0');
  assert.deepEqual([...hiddenFeatureObjects(hiddenCity)].sort(), [
    'city_label',
    'city_roof',
    'city_shadow',
  ]);
  const oneRoad = toggleMapFeature(hiddenCity, 'roads', 'generated_road_1');
  assert.ok(hiddenFeatureObjects(oneRoad).has('road_1'));
  assert.ok(hiddenFeatureObjects(oneRoad).has('road_base_1'));
  assert.ok(!hiddenFeatureObjects(oneRoad).has('shared_bridge'));
  const bothRoads = toggleMapFeature(oneRoad, 'roads', 'generated_road_2');
  assert.ok(hiddenFeatureObjects(bothRoads).has('shared_bridge'));
  assert.ok(
    !featureHidden(toggleMapFeature(hiddenCity, 'settlements', 'city_0'), 'settlements', 'city_0'),
  );
  assert.deepEqual(map, before);
  assert.equal(mapFeatures(map).filter((f) => f.kind === 'ports').length, 2);
  assert.equal(mapFeatures(map).filter((f) => f.kind === 'seaRoutes').length, 1);
});

test('legacy city pins and hand-drawn roads can be hidden without changing the generation key', () => {
  const map = fixture(),
    generation = map.editor!.generation;
  const signature = generationSignature(
    map.editor!.regions,
    map.width,
    map.height,
    generation,
    map.scaleKm,
    map.kind,
  );
  const hidden = toggleMapFeature(
    toggleMapFeature(map, 'ports', 'geo_port_0'),
    'seaRoutes',
    'geo_sea_route_0',
  );
  assert.equal(
    generationSignature(
      hidden.editor!.regions,
      hidden.width,
      hidden.height,
      hidden.editor!.generation,
      hidden.scaleKm,
      hidden.kind,
    ),
    signature,
  );
  assert.equal(hidden.editor!.generated, map.editor!.generated);
  const legacy = {
    ...map,
    editor: undefined,
    pins: [
      { id: 'manual_city', kind: 'city' as const, label: '旧城', description: '', x: 50, y: 80 },
    ],
    strokes: [
      {
        id: 'manual_road',
        tool: 'road' as const,
        width: 3,
        color: '#654321',
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
      },
    ],
  };
  const updated = toggleMapFeature(
    toggleMapFeature(legacy, 'settlements', 'manual_city'),
    'roads',
    'manual_road',
  );
  assert.equal(updated.editor!.baseVisible, true);
  assert.ok(featureHidden(updated, 'settlements', 'manual_city'));
  assert.ok(featureHidden(updated, 'roads', 'manual_road'));
  assert.deepEqual(updated.strokes, legacy.strokes);
  assert.deepEqual(authoredLegend(updated, false, true), []);
});

test('baking retains hidden city and road groups and allows revealing them afterward', () => {
  let map = fixture();
  map.strokes = [
    {
      id: 'manual_road',
      tool: 'road',
      width: 3,
      color: '#654321',
      points: [
        { x: 2, y: 2 },
        { x: 100, y: 120 },
      ],
    },
  ];
  for (const [kind, id] of [
    ['settlements', 'city_0'],
    ['roads', 'generated_road_1'],
    ['roads', 'manual_road'],
  ] as const)
    map = toggleMapFeature(map, kind, id);
  const frozen = {
    ...map,
    strokes: [],
    editor: { ...map.editor!, generation: undefined, regions: [], objects: bakeMapArtwork(map) },
  };
  const hidden = hiddenFeatureObjects(frozen, 'object');
  const groups = mapFeatures(frozen);
  for (const id of ['city_0', 'generated_road_1', 'manual_road']) {
    const feature = groups.find((f) => f.id === id)!;
    assert.ok(feature?.objectIds?.length);
    const owned = feature.objectIds.filter(
      (objectId) => frozen.editor.objects.find((o) => o.id === objectId)?.name !== '道路桥栏',
    );
    assert.ok(owned.length > 0);
    assert.ok(
      owned.every((objectId) => hidden.has(objectId)),
      `${id} remains hidden after baking`,
    );
  }
  assert.equal(groups.filter((f) => f.kind === 'roads').length, 3);
  const restored = toggleMapFeature(frozen, 'settlements', 'city_0');
  const city = mapFeatures(restored).find((f) => f.id === 'city_0')!;
  assert.ok(city.objectIds!.every((id) => !hiddenFeatureObjects(restored, 'object').has(id)));
});

test('hidden settlements do not shift the visible settlement building index used by label placement', () => {
  const map = fixture(),
    snapshot = map.editor!.generated!,
    geography = snapshot.geography!;
  const hidden = layoutCartographicLabels({
    geography,
    sites: snapshot.sites,
    objects: snapshot.objects,
    hiddenSiteIds: ['city_0'],
  });
  const equivalent = layoutCartographicLabels({
    geography,
    sites: snapshot.sites!.slice(1),
    objects: snapshot.objects
      .filter((o) => o.name.startsWith('聚落 2 ·'))
      .map((o) => ({ ...o, name: o.name.replace('聚落 2 ·', '聚落 1 ·') })),
  });
  assert.ok(!hidden.some((label) => label.id === 'city_0'));
  assert.deepEqual(
    hidden.find((label) => label.id === 'town_0'),
    equivalent.find((label) => label.id === 'town_0'),
  );
});

test('indexed settlement groups retain exact ordinal prefixes and frozen authored road edges', () => {
  const map = fixture(),
    snapshot = map.editor!.generated!;
  for (let ordinal = 3; ordinal <= 10; ordinal++) {
    snapshot.sites!.push({ ...snapshot.sites![0], id: `site_${ordinal}`, name: `聚落${ordinal}` });
  }
  snapshot.objects.push(
    createMapObject(
      'symbol',
      { x: 500, y: 500 },
      { id: 'tenth_roof', name: '聚落 10 ·地标', symbol: 'town' },
    ),
    createMapObject(
      'symbol',
      { x: 510, y: 500 },
      { id: 'noncanonical_roof', name: '聚落 01 · 地标', symbol: 'town' },
    ),
  );
  const city = mapFeatures(map).find((feature) => feature.id === 'city_0')!;
  const tenth = mapFeatures(map).find((feature) => feature.id === 'site_10')!;
  assert.deepEqual(city.objectIds, ['city_roof', 'city_shadow', 'city_label']);
  assert.deepEqual(tenth.objectIds, ['tenth_roof']);

  map.editor!.objects = [
    createMapObject(
      'path',
      { x: 10, y: 10 },
      {
        id: 'hand_road',
        name: '原手绘道路',
        points: [
          { x: 10, y: 10 },
          { x: 90, y: 90 },
        ],
      },
    ),
    createMapObject(
      'path',
      { x: 10, y: 10 },
      {
        id: 'hand_edge',
        name: '原手绘道路 · 边缘',
        points: [
          { x: 10, y: 10 },
          { x: 90, y: 90 },
        ],
      },
    ),
  ];
  const hidden = toggleMapFeature(map, 'roads', 'hand_road');
  assert.deepEqual([...hiddenFeatureObjects(hidden, 'object')], ['hand_road', 'hand_edge']);
  assert.equal(hiddenFeatureObjects(hidden).size, 0);
  assert.equal(hiddenFeatureObjects(toggleMapFeature(map, 'ports', 'geo_port_0')).size, 0);
});
