import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GeneratedGeography, GeographicCell } from '../shared/geography';
import type { GeneratedMapSnapshot } from '../shared/generated-map';
import type { TerrainBiome } from '../shared/cartography';
import { buildTerrainRelief } from '../src/lib/terrain-relief';
import { TerrainRelief } from '../src/components/TerrainRelief';

function geography(biomes: TerrainBiome[] = ['grass']): GeneratedGeography {
  const width = 960,
    height = 600;
  const cells: GeographicCell[] = biomes.map((biome, i) => {
    const x = (i * width) / biomes.length,
      right = ((i + 1) * width) / biomes.length;
    return {
      id: i,
      center: { x: (x + right) / 2, y: height / 2 },
      polygon: [
        { x, y: 0 },
        { x: right, y: 0 },
        { x: right, y: height },
        { x, y: height },
      ],
      neighbors: [],
      land: biome !== 'water',
      plate: 0,
      elevation: biome === 'water' ? -600 : 400,
      temperature: 15,
      precipitation: 1100,
      biome,
      shelf: false,
    };
  });
  return {
    version: 1,
    seed: 71623,
    width,
    height,
    cells,
    plates: [],
    divisions: [],
    areas: [],
    borders: [],
    ports: [],
    seaRoutes: [],
  };
}
function elevation(
  sample: (x: number, y: number) => number,
): NonNullable<GeneratedMapSnapshot['elevation']> {
  const columns = 80,
    rows = 50,
    width = 960,
    height = 600;
  const values = Array.from({ length: columns * rows }, (_, i) =>
    sample(
      (((i % columns) + 0.5) * width) / columns,
      ((Math.floor(i / columns) + 0.5) * height) / rows,
    ),
  );
  return {
    columns,
    rows,
    width,
    height,
    values,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('continuous relief uses accepted elevation, responds to aspect, and preserves saved data', () => {
  const g = freeze(geography(['hill'])),
    east = freeze(elevation((x) => 500 + x * 4)),
    west = freeze(elevation((x) => 500 + (960 - x) * 4)),
    original = JSON.stringify({ g, east, west });
  const a = buildTerrainRelief(g, east),
    b = buildTerrainRelief(g, west);
  assert.equal(a.source, 'fine-elevation');
  assert(a.washes.some((wash) => wash.kind === 'light'));
  assert(b.washes.some((wash) => wash.kind === 'shadow'));
  assert.notDeepEqual(a.washes, b.washes);
  assert.deepEqual(a, buildTerrainRelief(g, east));
  assert.equal(JSON.stringify({ g, east, west }), original);
  const flat = buildTerrainRelief(
    g,
    elevation(() => 400),
  );
  assert(!flat.washes.some((wash) => wash.kind === 'shadow' || wash.kind === 'light'));
});

test('fine sea and inland lake heights suppress ground washes even beneath stale land cells', () => {
  const g = geography(['forest']);
  const sea = buildTerrainRelief(
    g,
    elevation(() => -500),
  );
  assert.equal(sea.washes.length, 0);
  const halfLand = buildTerrainRelief(
    g,
    elevation((x) => (x < 480 ? -500 : 500)),
  );
  assert(halfLand.washes.length > 0);
  for (const wash of halfLand.washes) {
    const xs = [...wash.path.matchAll(/[MQ ](-?[\d.]+),-?[\d.]+/g)].map((match) =>
      Number(match[1]),
    );
    assert(
      xs.every((x) => x >= 470),
      'no ground is placed on the open-water half',
    );
  }
  const lake = buildTerrainRelief(
    g,
    elevation((x, y) => (Math.hypot(x - 480, y - 300) < 115 ? -300 : 500)),
  );
  assert(
    lake.washes.some((wash) => (wash.path.match(/Z/g) ?? []).length > 1),
    'the joined wash retains an inland water hole',
  );
  assert.equal(buildTerrainRelief(geography(['water'])).washes.length, 0);
});

test('habitat washes form six continuous families with bounded vector work, including town scale', () => {
  const g = freeze(geography(['forest', 'grass', 'desert', 'swamp', 'mountain', 'snow']));
  for (const kind of ['world', 'region', 'town'] as const) {
    const field = elevation(
        (x, y) => 300 + Math.pow(Math.sin(x / 85 + Math.sin(y / 110)), 2) * 2100,
      ),
      relief = buildTerrainRelief(g, field, kind),
      kinds = new Set(relief.washes.map((wash) => wash.kind));
    for (const cover of ['woodland', 'meadow', 'arid', 'wetland', 'rock', 'cold'] as const)
      assert(kinds.has(cover), cover);
    assert(relief.washes.length <= 37);
    assert(relief.vertices <= 26000);
    assert(relief.samples <= 44100);
    assert(!/NaN|Infinity|undefined/.test(JSON.stringify(relief)));
    assert(JSON.stringify(relief).length < 1100000, 'fixed path budget bounds heavy saved maps');
  }
});

test('an unusually noisy accepted height field cannot exhaust later highlights or habitat washes', () => {
  const g = geography(['forest', 'grass', 'desert', 'swamp', 'mountain', 'snow']),
    field = elevation((x, y) => 500 + Math.sin(x * 1.78 + y * 2.73) * 450),
    relief = buildTerrainRelief(g, field, 'town'),
    kinds = new Set(relief.washes.map((wash) => wash.kind));
  for (const cover of [
    'shadow',
    'light',
    'woodland',
    'meadow',
    'arid',
    'wetland',
    'rock',
    'cold',
  ] as const)
    assert(kinds.has(cover), cover);
  assert(relief.vertices <= 26000);
  assert(relief.washes.length <= 37);
});

test('continuous relief exports self-contained quiet fills below map furniture with exact shore clipping', () => {
  const svg = renderToStaticMarkup(
    createElement(TerrainRelief, {
      geography: geography(['forest', 'hill']),
      elevation: elevation((x, y) => 300 + (x + y) * 3),
      clipPath: 'url(#fine-land-and-lakes)',
      subtle: true,
      mapKind: 'region',
    }),
  );
  assert(svg.includes('data-terrain-relief="continuous"'));
  assert(svg.includes('clip-path="url(#fine-land-and-lakes)"'));
  assert(svg.includes('fill-rule="evenodd"'));
  assert(svg.includes('pointer-events="none"'));
  assert((svg.match(/<path /g) ?? []).length <= 37);
  assert(!/filter=|<image|https?:/.test(svg));
});
