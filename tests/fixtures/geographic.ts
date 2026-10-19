import type { GeneratedGeography } from '../../shared/geography';
import { defaultGeographicSettings } from '../../shared/geography';
import type { Workspace } from '../../shared/model';
import { createEditorFixture } from './map-editor';

/** Three adjacent regions with public and private links; deliberately small for storage tests. */
export function addGeographicFixture(data: Workspace): Workspace {
  const map = data.maps[0];
  map.visibility = 'public';
  map.width = 1000;
  map.height = 640;
  const faction = data.entities.find((entity) => entity.type === 'faction')!;
  faction.visibility = 'public';
  const secretFaction = {
    ...faction,
    id: 'geo_secret_faction',
    name: '隐藏的赤月帝国',
    visibility: 'gm' as const,
  };
  const secretArea = {
    ...faction,
    id: 'geo_secret_area',
    type: 'location' as const,
    name: '隐秘王陵地区',
    visibility: 'gm' as const,
  };
  data.entities.push(secretFaction, secretArea);
  const settings = defaultGeographicSettings('world');
  settings.plateCount = 3;
  const geography: GeneratedGeography = {
    version: 1,
    seed: 2468,
    width: 1000,
    height: 640,
    cells: [0, 1, 2].map((index) => {
      const left = index * 400;
      const right = Math.min(1000, left + 400);
      return {
        id: index,
        center: { x: (left + right) / 2, y: 320 },
        polygon: [
          { x: left, y: 0 },
          { x: right, y: 0 },
          { x: right, y: 640 },
          { x: left, y: 640 },
        ],
        neighbors: index === 0 ? [1] : index === 1 ? [0, 2] : [1],
        land: index < 2,
        plate: index,
        elevation: index === 2 ? -500 : 100 + index * 200,
        temperature: 20 - index * 2,
        precipitation: 800 + index * 100,
        biome: index === 2 ? 'water' : 'grass',
        shelf: index === 2,
        ...(index < 2 ? { country: `geo_country_${index}` } : {}),
      };
    }),
    plates: [0, 1, 2].map((index) => ({
      id: index,
      name: `地质板块 ${index + 1}`,
      center: { x: 200 + index * 300, y: 320 },
      velocity: { x: 0.2, y: -0.5 },
      kind: index === 2 ? 'oceanic' : 'continental',
      color: '#a07050',
    })),
    divisions: [
      {
        id: 'geo_country_0',
        kind: 'country',
        name: faction.name,
        color: '#a07050',
        center: { x: 200, y: 320 },
        entityId: faction.id,
      },
      {
        id: 'geo_country_1',
        kind: 'country',
        name: secretFaction.name,
        color: '#b05555',
        center: { x: 600, y: 320 },
        entityId: secretFaction.id,
      },
    ],
    areas: [
      {
        id: 'geo_continent',
        kind: 'continent',
        name: '晴川大陆',
        center: { x: 400, y: 320 },
        cells: [0, 1],
      },
      { id: 'geo_ocean', kind: 'ocean', name: '银帆海', center: { x: 900, y: 320 }, cells: [2] },
      {
        id: 'geo_province',
        kind: 'province',
        name: secretArea.name,
        center: { x: 600, y: 320 },
        cells: [1],
        entityId: secretArea.id,
      },
    ],
    borders: [
      {
        id: 'geo_border_0',
        kind: 'country',
        cells: [0, 1],
        points: [
          { x: 400, y: 0 },
          { x: 400, y: 640 },
        ],
      },
      {
        id: 'geo_cell_border_0',
        kind: 'cell',
        cells: [0, 1],
        points: [
          { x: 400, y: 0 },
          { x: 400, y: 640 },
        ],
      },
      {
        id: 'geo_plate_border_1',
        kind: 'plate',
        cells: [1, 2],
        motion: 'divergent',
        points: [
          { x: 800, y: 0 },
          { x: 800, y: 640 },
        ],
      },
    ],
    ports: [
      {
        id: 'geo_port_0',
        settlementId: 'city_0',
        name: '银帆港',
        center: { x: 760, y: 140 },
        harbor: { x: 830, y: 140 },
        cell: 1,
      },
      {
        id: 'geo_port_1',
        settlementId: 'town_0',
        name: '南湾港',
        center: { x: 760, y: 500 },
        harbor: { x: 830, y: 500 },
        cell: 1,
      },
    ],
    seaRoutes: [
      {
        id: 'geo_sea_route_0',
        name: '银帆航路',
        from: 'geo_port_0',
        to: 'geo_port_1',
        points: [
          { x: 830, y: 140 },
          { x: 920, y: 320 },
          { x: 830, y: 500 },
        ],
      },
    ],
  };
  map.editor = createEditorFixture();
  if (map.editor.generation?.version === 2) map.editor.generation.geography = settings;
  map.editor.generated = {
    version: 1,
    signature: '1234567890abcdef-1a2b',
    objects: map.editor.objects.map((object) => ({
      ...structuredClone(object),
      id: `cached_${object.id}`,
    })),
    sites: [
      { id: 'city_0', kind: 'city', name: '银帆城', x: 760, y: 140 },
      { id: 'town_0', kind: 'town', name: '南湾镇', x: 760, y: 500 },
    ],
    stats: { landCells: 2, rivers: 4, settlements: 2, roads: 1 },
    elevation: {
      columns: 20,
      rows: 16,
      width: 1000,
      height: 640,
      values: Array.from({ length: 20 * 16 }, (_, index) => (index % 20 < 16 ? 100 : -100)),
      min: -100,
      max: 100,
    },
    geography,
  };
  map.editor.military = [
    {
      id: 'military_front_0',
      name: '北部前线',
      kind: 'front',
      points: [
        { x: 400, y: 50 },
        { x: 400, y: 100 },
        { x: 400, y: 300 },
      ],
      color: '#992233',
      width: 2,
      visible: true,
    },
  ];
  return data;
}
