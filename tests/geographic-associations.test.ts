import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AtlasMap, Entity } from '../shared/model';
import { createSeed } from '../shared/seed';
import { addGeographicFixture } from './fixtures/geographic';
import { associateGeographicDivisions } from '../src/lib/geographic-associations';
import { divisionEntityTypes } from '../shared/cartography';
import { validateWorkspace } from '../server/validation';

function fixture() {
  const data = addGeographicFixture(createSeed()),
    map = data.maps[0],
    geo = map.editor!.generated!.geography!,
    original = geo.divisions[0];
  geo.divisions = (['country', 'culture', 'religion'] as const).map((kind) => ({
    ...original,
    id: `generated_${kind}`,
    kind,
    name: { country: '雪境王国', culture: '月灯文化', religion: '星泉信仰' }[kind],
    entityId: undefined,
  }));
  for (const cell of geo.cells.filter((cell) => cell.land))
    for (const division of geo.divisions) cell[division.kind] = division.id;
  geo.borders = geo.borders.filter(
    (border) => !['country', 'culture', 'religion'].includes(border.kind),
  );
  map.visibility = 'gm';
  map.createdBy = 'original_author';
  data.worlds[0].entityTemplates = {
    faction: ['外交关系', '继承制度'],
    culture: ['方言'],
    religion: ['禁忌'],
  };
  return { data, map, world: data.worlds[0] };
}
const divisions = (map: AtlasMap) => map.editor!.generated!.geography!.divisions;

test('generated countries, cultures and beliefs link existing records only in the right world and type', () => {
  const { map, world, data } = fixture(),
    base = data.entities[0],
    existing: Entity[] = divisions(map).map((division) => ({
      ...base,
      id: `existing_${division.kind}`,
      worldId: map.worldId,
      type: divisionEntityTypes[division.kind],
      name: division.name,
    }));
  const wrongWorld = { ...existing[0], id: 'wrong_world', worldId: 'another_world' },
    wrongType = { ...existing[0], id: 'wrong_type', type: 'character' as const };
  divisions(map)[0].entityId = wrongWorld.id;
  divisions(map)[1].entityId = wrongType.id;
  const result = associateGeographicDivisions(map, [wrongWorld, wrongType, ...existing], {
    world,
    canCreate: true,
  });
  assert.equal(result.entities.length, 0);
  assert.equal(result.unlinked, 0);
  for (const division of divisions(result.map))
    assert.equal(division.entityId, `existing_${division.kind}`);
  assert.equal(divisions(map)[0].entityId, 'wrong_world', 'the input snapshot is never mutated');
});

test('missing generated associations create all three draft record kinds with inherited privacy, author and templates', () => {
  const { data, map, world } = fixture(),
    result = associateGeographicDivisions(map, [], {
      world,
      actorId: 'generating_author',
      canCreate: true,
    });
  assert.equal(result.entities.length, 3);
  assert.equal(result.unlinked, 0);
  for (const division of divisions(result.map)) {
    const entity = result.entities.find((entity) => entity.id === division.entityId)!;
    assert(entity);
    assert.equal(entity.type, divisionEntityTypes[division.kind]);
    assert.equal(entity.worldId, map.worldId);
    assert.equal(entity.visibility, 'gm');
    assert.equal(entity.createdBy, 'generating_author');
    assert.equal(entity.status, 'draft');
    assert.deepEqual(Object.keys(entity.attributes), world.entityTemplates![entity.type]);
    assert(
      entity.content.includes('平均海拔') &&
        entity.content.includes('社会历史与人物故事仍待作者完善'),
    );
  }
  data.maps[0] = result.map;
  data.entities.push(...result.entities);
  assert.doesNotThrow(
    () => validateWorkspace(data),
    'record links and the map can be committed in one valid workspace',
  );
});

test('regeneration preserves associations and creates no duplicate records, including fragmented ownership', () => {
  const { map, world } = fixture(),
    first = associateGeographicDivisions(map, [], { world, canCreate: true }),
    second = associateGeographicDivisions(first.map, first.entities, { world, canCreate: true });
  assert.equal(second.entities.length, 0);
  assert.deepEqual(divisions(second.map), divisions(first.map));
  const fragmented = structuredClone(second.map),
    original = divisions(fragmented)[0];
  divisions(fragmented).push({ ...original, id: 'country_exclave', name: '飞地' });
  const third = associateGeographicDivisions(fragmented, first.entities, {
    world,
    canCreate: true,
  });
  assert.equal(third.entities.length, 0);
  assert.equal(
    divisions(third.map).at(-1)!.entityId,
    original.entityId,
    'intentional fragments may share one nation record',
  );
});

test('an author without lore creation may reuse permitted records but cannot create missing ones', () => {
  const { map, world, data } = fixture(),
    existing = {
      ...data.entities.find((entity) => entity.type === 'faction')!,
      name: '已存在的王国',
    },
    result = associateGeographicDivisions(map, [existing], { world, canCreate: false });
  assert.equal(result.entities.length, 0);
  assert.equal(result.unlinked, 2);
  assert.equal(divisions(result.map)[0].entityId, existing.id);
  assert.equal(divisions(result.map)[0].name, existing.name);
  assert(
    divisions(result.map)
      .slice(1)
      .every((division) => !division.entityId),
  );
});

test('absent map visibility stays GM private and falls back to the map author; explicit public maps stay public', () => {
  const { map, world } = fixture();
  delete map.visibility;
  const privateResult = associateGeographicDivisions(map, [], { world, canCreate: true });
  assert(
    privateResult.entities.every(
      (entity) => entity.visibility === 'gm' && entity.createdBy === map.createdBy,
    ),
  );
  map.visibility = 'public';
  const publicResult = associateGeographicDivisions(map, [], { world, canCreate: true });
  assert(publicResult.entities.every((entity) => entity.visibility === 'public'));
});
