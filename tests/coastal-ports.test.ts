import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GeneratedSettlement } from '../shared/cartography';
import type { GeneratedGeography, GeographicCell } from '../shared/geography';
import { GEOGRAPHY_LIMITS } from '../shared/geography';
import { isWaterPoint, isWaterSegment, sampleMapSurface } from '../shared/map-surface';
import type { ElevationField } from '../src/lib/elevation';
import { buildGeographicNavigation } from '../src/lib/geography-navigation';

function coastalFixture(height?: (x: number, y: number) => number) {
  const width = 160,
    heightPx = 120,
    columns = 80,
    rows = 60;
  const land = (x: number, y: number) =>
    (x >= 10 && x <= 110 && y >= 10 && y <= 110 && !(x >= 50 && x <= 70 && y >= 50 && y <= 70)) ||
    (x >= 130 && x <= 150 && y >= 40 && y <= 70) ||
    (x >= 120 && x <= 122 && y >= 100 && y <= 102);
  const surface: ElevationField = {
    width,
    height: heightPx,
    columns,
    rows,
    min: -200,
    max: 100,
    values: Float32Array.from({ length: columns * rows }, (_, id) => {
      const x = ((id % columns) + 0.5) * 2,
        y = (Math.floor(id / columns) + 0.5) * 2;
      return height ? height(x, y) : land(x, y) ? 100 : -200;
    }),
  };
  const country = (x: number, y: number) =>
    x >= 120
      ? 'island_country'
      : x < 40
        ? 'west_country'
        : x > 90
          ? 'east_country'
          : y >= 30 && y <= 90
            ? 'inland_country'
            : 'coastal_country';
  const cells: GeographicCell[] = Array.from({ length: 16 * 12 }, (_, id) => {
    const left = (id % 16) * 10,
      top = Math.floor(id / 16) * 10;
    const samples = Array.from({ length: 25 }, (_, at) => ({
      x: left + (at % 5) * 2 + 1,
      y: top + Math.floor(at / 5) * 2 + 1,
    }));
    const actualLand = samples.filter((point) => sampleMapSurface(surface, point) > 0);
    const center = actualLand[Math.floor(actualLand.length / 2)] ?? { x: left + 5, y: top + 5 };
    return {
      id,
      center,
      polygon: [
        { x: left, y: top },
        { x: left + 10, y: top },
        { x: left + 10, y: top + 10 },
        { x: left, y: top + 10 },
      ],
      neighbors: [],
      land: Boolean(actualLand.length),
      plate: 0,
      elevation: actualLand.length ? 100 : -200,
      temperature: 18,
      precipitation: 900,
      biome: actualLand.length ? 'grass' : 'water',
      shelf: false,
      ...(actualLand.length ? { country: country(center.x, center.y) } : {}),
    };
  });
  const geography: GeneratedGeography = {
    version: 1,
    width,
    height: heightPx,
    seed: 83,
    cells,
    plates: [],
    divisions: [
      'west_country',
      'east_country',
      'inland_country',
      'coastal_country',
      'island_country',
    ].map((id) => ({
      id,
      kind: 'country',
      name: `${id}王国`,
      color: '#885544',
      center: { x: 50, y: 50 },
    })),
    areas: [],
    borders: [],
    ports: [],
    seaRoutes: [],
  };
  return { geography, surface };
}

test('coastal countries, a small island and a one-sample islet get independent ports without cities', () => {
  const { geography, surface } = coastalFixture();
  const original = structuredClone(geography);
  const navigation = buildGeographicNavigation(geography, [], 83, surface);
  assert.deepEqual(geography, original, 'navigation does not mutate the geographic source');
  assert(navigation.ports.length >= 5);
  assert(navigation.ports.every((port) => port.settlementId === undefined));
  const countries = new Set(navigation.ports.map((port) => geography.cells[port.cell].country));
  for (const id of ['west_country', 'east_country', 'coastal_country', 'island_country'])
    assert(countries.has(id), `${id} has an ocean dock`);
  assert(
    !countries.has('inland_country'),
    'an inland nation beside a lake is not forced to have a seaport',
  );
  assert(
    navigation.ports.some((port) => port.center.x >= 130),
    'large island has a port',
  );
  assert(
    navigation.ports.some((port) => port.center.x >= 120 && port.center.x <= 122),
    'fine islet inside a predominantly water cell has a separate port',
  );
  assert.equal(new Set(navigation.ports.map((port) => port.id)).size, navigation.ports.length);
  assert.equal(new Set(navigation.ports.map((port) => port.name)).size, navigation.ports.length);
  assert(navigation.ports.length <= GEOGRAPHY_LIMITS.ports);
  assert.deepEqual(buildGeographicNavigation(geography, [], 83, surface), navigation);
});

test('existing coastal city is retained and coverage docks do not change requested settlement counts', () => {
  const { geography, surface } = coastalFixture();
  const sites: GeneratedSettlement[] = [
    { id: 'kept_city', name: '晴海城', kind: 'city', x: 11, y: 21 },
  ];
  const original = structuredClone(sites),
    navigation = buildGeographicNavigation(geography, sites, 84, surface);
  assert.deepEqual(sites, original);
  assert.equal(navigation.ports.filter((port) => port.settlementId === sites[0].id).length, 1);
  assert(navigation.ports.some((port) => port.settlementId === undefined));
  const west = navigation.ports.filter(
    (port) => geography.cells[port.cell].country === 'west_country',
  );
  assert.equal(west.length, 1, 'existing city covers its landmass and coastal country');
});

test('generated shipping forms curved water-safe connections including standalone island docks', () => {
  const { geography, surface } = coastalFixture();
  const { ports, seaRoutes } = buildGeographicNavigation(geography, [], 85, surface);
  assert(seaRoutes.length >= ports.length - 1, 'all docks share a navigable ocean network');
  for (const port of ports) {
    assert(sampleMapSurface(surface, port.center) > 0);
    assert(isWaterPoint(surface, port.harbor, -5));
    assert(seaRoutes.some((route) => route.from === port.id || route.to === port.id));
  }
  for (const route of seaRoutes) {
    const from = ports.find((port) => port.id === route.from)!,
      to = ports.find((port) => port.id === route.to)!;
    assert.deepEqual(route.points[0], from.harbor);
    assert.deepEqual(route.points[route.points.length - 1], to.harbor);
    assert(route.points.length > 12, 'navigation saves soft sampled curves');
    assert(route.points.length <= GEOGRAPHY_LIMITS.routePoints);
    for (let index = 0; index < route.points.length; index++) {
      assert(isWaterPoint(surface, route.points[index], -5));
      if (index) assert(isWaterSegment(surface, route.points[index - 1], route.points[index], -5));
    }
  }
});

test('a map cropped entirely inland creates no ocean docks or false sea routes through lakes', () => {
  const { geography, surface } = coastalFixture((x, y) =>
    x > 60 && x < 90 && y > 40 && y < 70 ? -200 : 100,
  );
  assert.deepEqual(buildGeographicNavigation(geography, [], 83, surface), {
    ports: [],
    seaRoutes: [],
  });
  assert.deepEqual(buildGeographicNavigation(geography, [], 83), { ports: [], seaRoutes: [] });
});

test('an unclaimed archipelago receives one port per fine island and remains a bounded connected network', () => {
  const { geography, surface } = coastalFixture((x, y) =>
    Math.floor(x / 2) % 8 === 3 && Math.floor(y / 2) % 8 === 3 ? 100 : -200,
  );
  for (const cell of geography.cells) delete cell.country;
  geography.divisions = [];
  const { ports, seaRoutes } = buildGeographicNavigation(geography, [], 86, surface),
    islandCount = Array.from(surface.values).filter((value) => value > 0).length;
  assert.equal(ports.length, islandCount, 'every island is covered even without any countries');
  assert.equal(islandCount, 80);
  assert(seaRoutes.length <= GEOGRAPHY_LIMITS.seaRoutes);
  const reached = new Set([ports[0].id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const route of seaRoutes)
      if (reached.has(route.from) !== reached.has(route.to)) {
        reached.add(route.from);
        reached.add(route.to);
        changed = true;
      }
  }
  assert.equal(reached.size, ports.length);
  const points =
    geography.cells.reduce((sum, cell) => sum + cell.polygon.length, 0) +
    seaRoutes.reduce((sum, route) => sum + route.points.length, 0);
  assert(points <= 180_000, 'navigation fits the shared persisted geometry budget');
});
