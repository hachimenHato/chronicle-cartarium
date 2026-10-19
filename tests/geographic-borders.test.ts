import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultGeographicSettings } from '../shared/geography';
import type { GeneratedGeography, GeographicBorder, GeographicCell } from '../shared/geography';
import type { GeographicFieldContext, GeographicFields } from '../src/lib/geography-fields';
import { buildGeographicMesh, geographicTravelCost } from '../src/lib/geography-mesh';
import { buildCartographicBorders, mergeGeographicBorders } from '../src/lib/geographic-borders';
import { distanceToSegment, pointInPolygon } from '../src/lib/terrain';

function context(land: (x: number, y: number) => boolean = () => true): GeographicFieldContext {
  const columns = 100,
    rows = 100,
    width = 200,
    height = 200;
  const cells = Array.from({ length: columns * rows }, (_, i) => {
    const x = (((i % columns) + 0.5) * width) / columns,
      y = ((Math.floor(i / columns) + 0.5) * height) / rows,
      isLand = land(x, y);
    return {
      x,
      y,
      land: isLand,
      biome: isLand ? ('grass' as const) : ('water' as const),
      elevation: isLand ? 0.05 : -0.1,
      drainageElevation: isLand ? 0.05 : -0.1,
      downstream: -1,
      moisture: 0.5,
      slope: 0,
      accumulation: isLand ? 1 : 0,
    };
  });
  return {
    cells,
    field: Float64Array.from(cells, (c) => c.elevation),
    columns,
    rows,
    width,
    height,
    kind: 'town',
    settings: {
      version: 2,
      seed: 81924,
      detail: 'standard',
      linework: 'organic',
      climate: 'temperate',
      settlements: 0,
      rivers: true,
      routes: false,
      geography: { ...defaultGeographicSettings('town'), regionDensity: 0.5, source: 'sketch' },
    },
  };
}
function fields(c: GeographicFieldContext): GeographicFields {
  return {
    plates: [
      {
        id: 0,
        name: '陆板块',
        center: { x: 100, y: 100 },
        velocity: { x: 1, y: 0 },
        kind: 'continental',
        color: '#aa9988',
      },
    ],
    plate: new Int16Array(c.cells.length),
    temperature: new Float32Array(c.cells.length).fill(18),
    precipitation: new Float32Array(c.cells.length).fill(950),
    shelf: new Uint8Array(c.cells.length),
  };
}
function cell(id: number, x: number, y: number): GeographicCell {
  return {
    id,
    center: { x, y },
    polygon: [
      { x: x - 1, y: y - 1 },
      { x: x + 1, y: y - 1 },
      { x, y: y + 1 },
    ],
    neighbors: [],
    land: true,
    plate: 0,
    elevation: 300,
    temperature: 18,
    precipitation: 950,
    biome: 'grass',
    shelf: false,
  };
}
const edge = (id: string, points: GeographicBorder['points']): GeographicBorder => ({
  id,
  kind: 'country',
  cells: [0, 1],
  points,
});
function geography(borders: GeographicBorder[]): GeneratedGeography {
  return {
    version: 1,
    seed: 1,
    width: 200,
    height: 200,
    cells: Array.from({ length: 100 }, (_, i) => cell(i, 100, 100)),
    plates: [],
    divisions: [],
    areas: [],
    borders,
    ports: [],
    seaRoutes: [],
  };
}

test('a thin coastal land strip remains selectable and fully owned even when regional centers are offshore', () => {
  const c = context((x) => x >= 98 && x < 100),
    g = buildGeographicMesh(c, fields(c));
  const land = c.cells.filter((sample) => sample.land);
  assert(land.length > 0);
  for (const sample of land) {
    const region = g.cells.find((region) => pointInPolygon(sample, region.polygon));
    assert(
      region?.land,
      `fine shoreline land at ${sample.x},${sample.y} was lost by a coarse center test`,
    );
    for (const kind of ['country', 'culture', 'religion'] as const) assert(region[kind]);
  }
  for (const region of g.cells.filter((region) => region.land))
    assert(
      region.center.x >= 98 && region.center.x < 100,
      'coastal labels are anchored to actual land',
    );
});

test('country expansion reacts to visible rivers, ridge crossings and intervening sea, while beliefs remain permeable', () => {
  const c = context(),
    from = cell(0, 50, 100),
    to = cell(1, 150, 100),
    base = geographicTravelCost(c, from, to, 'country');
  const river = {
    ...c,
    riverChannels: [
      {
        kind: 'river' as const,
        points: [
          { x: 100, y: 0 },
          { x: 100, y: 200 },
        ],
        widths: [2, 2],
      },
    ],
  };
  const political = geographicTravelCost(river, from, to, 'country'),
    cultural = geographicTravelCost(river, from, to, 'culture'),
    religious = geographicTravelCost(river, from, to, 'religion');
  assert(political > base * 5, 'a real channel strongly hinders state expansion across it');
  assert(
    political > cultural && cultural > religious,
    'culture and belief may spread across state barriers',
  );
  const ridge = context();
  for (const fine of ridge.cells) if (fine.x >= 96 && fine.x < 104) fine.elevation = 0.6;
  assert(
    geographicTravelCost(ridge, from, to, 'country') > base * 5,
    'samples along the entire crossing detect a ridge even if both endpoint elevations match',
  );
  const strait = context((x) => x < 94 || x > 106);
  assert(
    geographicTravelCost(strait, from, to, 'country') > base * 5,
    'water between coastal centers is a real barrier',
  );
  assert.equal(
    geographicTravelCost(river, cell(2, 80, 20), cell(3, 80, 180), 'country'),
    160,
    'travel along the same bank does not cross the river',
  );
});

test('territorial centers use actual towns and cities instead of uninhabited geometric seeds', () => {
  const c = context();
  c.settlements = [
    { id: 'capital', kind: 'city', name: '王都', x: 35, y: 40 },
    { id: 'fort', kind: 'castle', name: '山关', x: 165, y: 160 },
  ];
  const g = buildGeographicMesh(c, fields(c)),
    hubs = c.settlements.map((site) =>
      g.cells.find((region) => pointInPolygon(site, region.polygon))!,
    );
  for (const kind of ['country', 'culture', 'religion'] as const) {
    const names = g.divisions
      .filter((division) => division.kind === kind)
      .map((division) => division.name);
    assert.equal(
      new Set(names).size,
      names.length,
      'separate territories have distinct generated names',
    );
  }
  for (const division of g.divisions.filter((d) => d.kind === 'country'))
    assert(hubs.some((hub) => distanceToSegment(division.center, hub.center, hub.center) < 0.001));
  assert.notEqual(hubs[0].country, hubs[1].country);
});

test('a visible river redirects generated state boundaries onto its banks instead of the flat geometric bisector', () => {
  const flat = context();
  flat.settlements = [
    { id: 'capital', kind: 'city', name: '北都', x: 35, y: 40 },
    { id: 'fort', kind: 'castle', name: '南都', x: 165, y: 160 },
  ];
  const river = {
      ...flat,
      cells: structuredClone(flat.cells),
      riverChannels: [
        {
          kind: 'river' as const,
          points: [
            { x: 100, y: 0 },
            { x: 100, y: 200 },
          ],
          widths: [2, 2],
        },
      ],
    },
    without = buildGeographicMesh(flat, fields(flat)),
    withRiver = buildGeographicMesh(river, fields(river));
  const distanceFromRiver = (g: GeneratedGeography) => {
    const points = g.borders.filter((b) => b.kind === 'country').flatMap((b) => b.points);
    assert(points.length > 10);
    return points.reduce((sum, p) => sum + Math.abs(p.x - 100), 0) / points.length;
  };
  assert(
    distanceFromRiver(withRiver) < distanceFromRiver(without) * 0.5,
    'the same mesh and two capitals must produce a markedly different boundary when a river makes crossings costly',
  );
});

test('cartographic tracing joins segments into one dash-continuous boundary and stops at three-way junctions', () => {
  const borders = [
    edge('a', [
      { x: 10, y: 10 },
      { x: 20, y: 12 },
      { x: 30, y: 10 },
    ]),
    edge('b', [
      { x: 50, y: 10 },
      { x: 40, y: 14 },
      { x: 30, y: 10 },
    ]),
    edge('c', [
      { x: 50, y: 10 },
      { x: 60, y: 11 },
      { x: 70, y: 10 },
    ]),
  ];
  const chain = mergeGeographicBorders(borders);
  assert.equal(chain.length, 1);
  assert.equal(chain[0].points.length, 7);
  assert.deepEqual(chain[0].points[0], { x: 10, y: 10 });
  assert.deepEqual(chain[0].points.at(-1), { x: 70, y: 10 });
  const junction = mergeGeographicBorders([
    ...borders,
    edge('branch', [
      { x: 50, y: 10 },
      { x: 50, y: 30 },
    ]),
  ]);
  assert.equal(
    junction.length,
    3,
    'a three-way border is traced as distinct branches without arbitrary crossovers',
  );
});

test('boundaries terminate on the real curved coast and cannot bridge lake holes or ocean inlets', () => {
  const shoreline = [
      { x: 20, y: 20 },
      { x: 80, y: 10 },
      { x: 180, y: 35 },
      { x: 170, y: 180 },
      { x: 30, y: 175 },
    ],
    lake = [
      { x: 85, y: 70 },
      { x: 115, y: 70 },
      { x: 115, y: 115 },
      { x: 85, y: 115 },
    ],
    g = geography([
      edge('coastal-gap', [
        { x: 100, y: 35 },
        { x: 100, y: 150 },
      ]),
    ]),
    paths = buildCartographicBorders(g, 'country', { coastline: [shoreline, lake] });
  assert.equal(
    paths.length,
    2,
    'the lake interrupts the international boundary instead of carrying an inland line over water',
  );
  const first = paths[0].points[0],
    last = paths.at(-1)!.points.at(-1)!;
  const onCoast = (p: { x: number; y: number }) =>
    shoreline.some((a, i) => distanceToSegment(p, a, shoreline[(i + 1) % shoreline.length]) < 1e-6);
  assert(
    onCoast(first) && onCoast(last),
    'both formerly inland coarse endpoints now meet the authoritative shoreline',
  );
  for (const path of paths)
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1],
        b = path.points[i],
        midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      assert(pointInPolygon(midpoint, shoreline) && !pointInPolygon(midpoint, lake));
    }
});

test('elevation-only coastal boundaries still meet a nearby shore when their end direction is tangent to it', () => {
  const columns = 100,
    rows = 100,
    elevation = {
      columns,
      rows,
      width: 200,
      height: 200,
      values: Array.from({ length: columns * rows }, (_, i) => {
        const x = ((i % columns) + 0.5) * 2,
          y = (Math.floor(i / columns) + 0.5) * 2;
        return x >= 10 && x <= 190 && y >= 30 && y <= 170 ? 100 : -100;
      }),
    },
    g = geography([
      edge('tangent', [
        { x: 70, y: 40 },
        { x: 130, y: 40 },
      ]),
    ]),
    paths = buildCartographicBorders(g, 'country', { elevation });
  assert.equal(paths.length, 1);
  assert.equal(paths[0].points[0].y, 30);
  assert.equal(paths[0].points.at(-1)!.y, 30);
  assert(paths[0].points.length > 2, 'local zero crossings close both coarse inland gaps');
});
