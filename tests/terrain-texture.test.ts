import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { GeographicCell, GeneratedGeography } from '../shared/geography';
import type { MapObject, TerrainBiome } from '../shared/cartography';
import { biomeCatalog } from '../shared/cartography';
import { buildTerrainTexture, TERRAIN_TEXTURE_LIMITS } from '../src/lib/terrain-texture';
import { TerrainTexture } from '../src/components/TerrainTexture';
import { administrativeBorderPaths } from '../src/lib/administrative-borders';

function cell(id: number, biome: TerrainBiome = 'grass'): GeographicCell {
  return {
    id,
    center: { x: 500, y: 320 },
    polygon: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 640 },
      { x: 0, y: 640 },
    ],
    neighbors: [],
    land: biome !== 'water',
    plate: 0,
    elevation: 300,
    temperature: 18,
    precipitation: 950,
    biome,
    shelf: false,
    country: 'state-a',
  };
}
function geography(cells: GeographicCell[] = [cell(0)]): GeneratedGeography {
  return {
    version: 1,
    seed: 5421,
    width: 1000,
    height: 640,
    cells,
    plates: [],
    divisions: [],
    areas: [],
    borders: [],
    ports: [],
    seaRoutes: [],
  };
}
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

test('all thirteen land-cover engravings have distinct deterministic geometry without mutating a saved map', () => {
  const motifs = new Set<string>();
  for (const biome of biomeCatalog) {
    const g = freeze(geography([cell(0, biome.id)]));
    const first = buildTerrainTexture(g),
      second = buildTerrainTexture(g);
    assert.deepEqual(first, second);
    if (biome.id === 'water') assert.equal(first.marks, 0);
    else {
      assert(first.marks > 1000, biome.id);
      assert.equal(first.biomes[0].biome, biome.id);
      assert(!/NaN|Infinity|undefined/.test(JSON.stringify(first)));
      motifs.add(first.biomes[0].line);
    }
  }
  assert.equal(motifs.size, 13);
  assert.notDeepEqual(
    buildTerrainTexture(geography()),
    buildTerrainTexture({ ...geography(), seed: 5422 }),
  );
});

test('fine elevation rejects sea and lake samples and the relief ink responds to slope aspect', () => {
  const g = geography([cell(0, 'mountain')]);
  const grid = {
    width: 1000,
    height: 640,
    columns: 8,
    rows: 8,
    min: -500,
    max: 20000,
    values: Array(64).fill(-500),
  };
  assert.equal(buildTerrainTexture(g, grid).marks, 0);
  grid.values = Array(64).fill(500);
  const flat = buildTerrainTexture(g, grid);
  assert(flat.marks > 0);
  assert.equal(flat.slope + flat.slopeLight, '');
  grid.values = Array.from({ length: 64 }, (_, i) => 1000 + (i % 8) * 2500);
  const east = buildTerrainTexture(g, grid);
  grid.values = Array.from({ length: 64 }, (_, i) => 1000 + (7 - (i % 8)) * 2500);
  const west = buildTerrainTexture(g, grid);
  assert(east.slopeLight.length > 0 && west.slope.length > 0);
  assert.notEqual(east.slopeLight, west.slope);
});

test('natural cover remains continuous when a land biome is split into tiny administrative cells', () => {
  const original = geography([cell(0, 'forest')]),
    divided = geography();
  divided.cells = Array.from({ length: 1000 }, (_, i) => {
    const x = (i % 40) * 25,
      y = Math.floor(i / 40) * 25.6;
    return {
      ...cell(i, 'forest'),
      center: { x: x + 12.5, y: y + 12.8 },
      country: `state-${i % 5}`,
      polygon: [
        { x, y },
        { x: x + 25, y },
        { x: x + 25, y: y + 25.6 },
        { x, y: y + 25.6 },
      ],
    };
  });
  const continuous = buildTerrainTexture(freeze(original)),
    subdivided = buildTerrainTexture(freeze(divided));
  assert(continuous.marks > 3000);
  assert.deepEqual(subdivided, continuous, 'political cells cannot shrink marks or make seams');
  assert.deepEqual(
    buildTerrainTexture({ ...divided, cells: [...divided.cells].reverse() }),
    continuous,
  );
});

test('world, region and town cover changes scale without changing terrain or exceeding display budgets', () => {
  const g = freeze(geography([cell(0, 'forest')])),
    world = buildTerrainTexture(g, undefined, { mapKind: 'world' }),
    region = buildTerrainTexture(g, undefined, { mapKind: 'region' }),
    town = buildTerrainTexture(g, undefined, { mapKind: 'town' });
  assert(world.marks > region.marks && region.marks > town.marks);
  for (const ink of [world, region, town]) {
    assert(ink.marks <= TERRAIN_TEXTURE_LIMITS.marks);
    const characters = ink.biomes.reduce(
      (sum, b) => sum + b.line.length + b.shade.length + b.light.length,
      0,
    );
    assert(characters <= TERRAIN_TEXTURE_LIMITS.pathCharacters);
  }
});

test('cover leaves quiet ground for labels, settlements and visible routes without hidden ghost corridors', () => {
  // Use a biome below the character budget, so fewer stamps measures clearance
  // rather than another equally sized, uniformly distributed budget subset.
  const g = freeze(geography([cell(0, 'hill')])),
    base = buildTerrainTexture(g);
  const road: MapObject = {
    id: 'authored-road',
    name: '手绘道路',
    kind: 'path',
    points: [
      { x: 10, y: 320 },
      { x: 990, y: 320 },
    ],
    text: '',
    color: 'none',
    stroke: '#806342',
    strokeWidth: 6,
    size: 20,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
  };
  const roadCover = buildTerrainTexture(g, undefined, { objects: [road] });
  assert(roadCover.marks < base.marks && roadCover.marks > base.marks * 0.9);
  assert.deepEqual(
    buildTerrainTexture(g, undefined, { objects: [{ ...road, visible: false }] }),
    base,
  );
  const site = { id: 'site', kind: 'city' as const, name: '森林都城', x: 500, y: 320 };
  assert(buildTerrainTexture(g, undefined, { sites: [site] }).marks < base.marks);
  assert.equal(
    buildTerrainTexture(g, undefined, { obstacles: [{ x: 0, y: 0, width: 1000, height: 640 }] })
      .marks,
    0,
  );
  const quietHalf = buildTerrainTexture(g, undefined, {
    obstacles: [{ x: 0, y: 0, width: 500, height: 640 }],
  });
  assert(quietHalf.marks > base.marks * 0.4 && quietHalf.marks < base.marks * 0.55);
  const starts = quietHalf.biomes[0].line.matchAll(/M(-?\d+(?:\.\d+)?),/g);
  assert(
    [...starts].every((m) => Number(m[1]) >= 500),
    'engraving cannot trespass into reserved lettering space',
  );
});

test('an exceptionally dense forest spends its path budget across the whole map, never in a top strip', () => {
  const g = geography([cell(0, 'rainforest')]);
  g.height = 1000;
  g.cells[0].polygon[2].y = 1000;
  g.cells[0].polygon[3].y = 1000;
  const ink = buildTerrainTexture(freeze(g)),
    quadrants = [0, 0, 0, 0];
  let count = 0;
  for (const match of ink.biomes[0].line.matchAll(/M(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)) {
    const x = Number(match[1]),
      y = Number(match[2]);
    quadrants[(x >= 500 ? 1 : 0) + (y >= 500 ? 2 : 0)]++;
    count++;
  }
  assert(count > 1000);
  assert(
    quadrants.every((n) => n > count * 0.15),
    'all quadrants retain their engraving',
  );
  assert(ink.marks <= TERRAIN_TEXTURE_LIMITS.marks);
  assert(
    ink.biomes.reduce(
      (n, b) => n + b.line.length + b.shade.length + b.light.length,
      ink.slope.length + ink.slopeLight.length,
    ) <= TERRAIN_TEXTURE_LIMITS.pathCharacters,
  );
});

test('a complete engraving adds bounded SVG nodes, clips to the supplied coast and remains a self-contained export', () => {
  const g = geography();
  g.cells = biomeCatalog
    .filter((b) => b.id !== 'water')
    .map((biome, i) => {
      const c = cell(i, biome.id),
        x = (i % 4) * 250,
        y = Math.floor(i / 4) * 160;
      c.polygon = [
        { x, y },
        { x: x + 250, y },
        { x: x + 250, y: y + 160 },
        { x, y: y + 160 },
      ];
      return c;
    });
  const svg = renderToStaticMarkup(
    createElement(TerrainTexture, { geography: freeze(g), clipPath: 'url(#exact-shore)' }),
  );
  assert.equal((svg.match(/data-terrain-texture-biome=/g) ?? []).length, 13);
  assert((svg.match(/<path /g) ?? []).length <= 41);
  assert(svg.includes('clip-path="url(#exact-shore)"'));
  assert(!/filter=|<image |https?:/.test(svg));
});

test('province and district boundaries use shared edges and preserve the hierarchy with countries and base cells', () => {
  const g = geography(Array.from({ length: 6 }, (_, i) => cell(i * 10)));
  g.cells[4].country = 'state-b';
  g.cells[5].land = false;
  g.areas = [
    {
      id: 'large-landmass',
      kind: 'continent',
      name: '大陆',
      center: { x: 0, y: 0 },
      cells: [0, 10, 20, 30, 40],
    },
    { id: 'province-a', kind: 'province', name: '西省', center: { x: 0, y: 0 }, cells: [0, 10] },
    { id: 'province-b', kind: 'district', name: '东区', center: { x: 0, y: 0 }, cells: [20, 30] },
    { id: 'province-c', kind: 'province', name: '外国省', center: { x: 0, y: 0 }, cells: [40] },
  ];
  g.borders = Array.from({ length: 5 }, (_, i) => ({
    id: `edge-${i}`,
    kind: 'cell',
    cells: [i * 10, (i + 1) * 10],
    points: [
      { x: (i + 1) * 100, y: 0 },
      { x: (i + 1) * 100 + 4, y: 320 },
      { x: (i + 1) * 100, y: 640 },
    ],
  }));
  const paths = administrativeBorderPaths(freeze(g));
  assert(paths.grid.includes('100,0') && paths.grid.includes('300,0'));
  assert(paths.administrative.includes('200,0') && paths.administrative.includes('204,320'));
  assert(!paths.administrative.includes('400,0'), 'a state edge uses the stronger country stroke');
  assert(!paths.grid.includes('500,0'), 'water cells never become internal administrative edges');
});
