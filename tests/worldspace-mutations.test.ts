import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveEntityInWorkspace } from '../src/lib/workspace-mutations.ts';
import { createSeed } from '../shared/seed.ts';
import type { Entity, Workspace } from '../shared/model.ts';

function renameFixture(): { data: Workspace; renamed: Entity } {
  const data = createSeed();
  const source = data.entities.find((entity) => entity.id === 'e_port')!;
  const oldReference = '从 [[ 雾港 ]] 通向 [[\t雾港\t]]，另有 [[雾港旧城]] 与普通文字雾港。';
  data.worlds[0].description = oldReference;
  for (const entity of data.entities) {
    entity.summary = oldReference;
    entity.content = oldReference;
    entity.attributes = { 所属地点: oldReference };
  }
  for (const map of data.maps) {
    map.summary = oldReference;
    for (const pin of map.pins) pin.description = oldReference;
  }
  for (const relation of data.relations) relation.description = oldReference;
  for (const plot of data.plots) {
    plot.summary = oldReference;
    for (const node of plot.nodes) node.summary = oldReference;
  }
  for (const session of data.sessions) session.content = oldReference;

  // Another world intentionally uses the same entity name and identical wiki text.
  data.worlds.push({ ...data.worlds[0], id: 'other_world' });
  data.entities.push({ ...source, id: 'other_entity', worldId: 'other_world' });
  data.maps.push({ ...structuredClone(data.maps[0]), id: 'other_map', worldId: 'other_world' });
  data.relations.push({ ...data.relations[0], id: 'other_relation', worldId: 'other_world' });
  data.plots.push({ ...structuredClone(data.plots[0]), id: 'other_plot', worldId: 'other_world' });
  data.sessions.push({ ...data.sessions[0], id: 'other_session', worldId: 'other_world' });
  data.variables.push({ ...data.variables[0], id: 'other_variable', worldId: 'other_world' });
  return { data, renamed: { ...source, name: '新雾港' } };
}

test('entity rename updates every wiki-bearing text field inside its own world', () => {
  const { data, renamed } = renameFixture();
  const result = saveEntityInWorkspace(data, renamed);
  const expected = '从 [[新雾港]] 通向 [[新雾港]]，另有 [[雾港旧城]] 与普通文字雾港。';
  assert.equal(result.worlds[0].description, expected);
  for (const entity of result.entities.filter((item) => item.worldId === renamed.worldId)) {
    assert.equal(entity.summary, expected);
    assert.equal(entity.content, expected);
    assert.equal(entity.attributes['所属地点'], expected);
  }
  for (const map of result.maps.filter((item) => item.worldId === renamed.worldId)) {
    assert.equal(map.summary, expected);
    for (const pin of map.pins) assert.equal(pin.description, expected);
  }
  for (const relation of result.relations.filter((item) => item.worldId === renamed.worldId)) {
    assert.equal(relation.description, expected);
  }
  for (const plot of result.plots.filter((item) => item.worldId === renamed.worldId)) {
    assert.equal(plot.summary, expected);
    for (const node of plot.nodes) assert.equal(node.summary, expected);
  }
  for (const session of result.sessions.filter((item) => item.worldId === renamed.worldId)) {
    assert.equal(session.content, expected);
  }
  assert.equal(result.entities.find((entity) => entity.id === renamed.id)?.name, '新雾港');
});

test('renaming a page never alters another world or structural links and does not mutate input', () => {
  const { data, renamed } = renameFixture();
  const snapshot = structuredClone(data);
  const result = saveEntityInWorkspace(data, renamed);
  assert.deepEqual(data, snapshot);
  assert.equal(
    result.worlds.find((world) => world.id === 'other_world'),
    data.worlds[1],
  );
  for (const key of ['entities', 'maps', 'relations', 'plots', 'sessions', 'variables'] as const) {
    assert.equal(
      result[key].find((item) => item.worldId === 'other_world'),
      data[key].find((item) => item.worldId === 'other_world'),
      `${key} from another world must remain untouched`,
    );
  }
  assert.equal(result.maps[0].pins[0].entityId, 'e_port');
  assert.equal(result.maps[0].pins[0].childMapId, 'm_port');
  assert.deepEqual(result.plots[0].edges, data.plots[0].edges);
  assert.deepEqual(result.plots[0].nodes[0].conditions, data.plots[0].nodes[0].conditions);
  assert.deepEqual(result.plots[0].nodes[0].effects, data.plots[0].nodes[0].effects);
  assert.equal(result.variables, data.variables);
});

test('saving unchanged names only replaces the page and creating a page leaves references intact', () => {
  const data = createSeed();
  const edited = { ...data.entities[0], summary: '新的摘要' };
  const result = saveEntityInWorkspace(data, edited);
  assert.equal(result.entities.length, data.entities.length);
  assert.equal(result.entities[0], edited);
  for (const key of ['worlds', 'maps', 'relations', 'plots', 'sessions', 'variables'] as const) {
    assert.equal(result[key], data[key]);
  }
  const created = { ...edited, id: 'new_entity', name: '新人物', content: '拜访 [[雾港]]' };
  const added = saveEntityInWorkspace(data, created);
  assert.equal(added.entities.length, data.entities.length + 1);
  assert.equal(added.entities.at(-1), created);
  assert.equal(added.entities[0], data.entities[0]);
  assert.equal(added.entities.at(-1)?.content, '拜访 [[雾港]]');
});

test('wiki rename treats names literally and preserves unrelated or incomplete references', () => {
  const data = createSeed();
  const source = data.entities[0];
  source.name = '雾港 (A+B).$';
  source.content = '[[雾港 (A+B).$]] [[ 雾港 (A+B).$ ]] [[雾港 (A+B).$旧址]] [[尚未完成';
  const result = saveEntityInWorkspace(data, { ...source, name: '雾港 $& 新城' });
  assert.equal(
    result.entities[0].content,
    '[[雾港 $& 新城]] [[雾港 $& 新城]] [[雾港 (A+B).$旧址]] [[尚未完成',
  );
});

test('map editor wiki references follow same-world renames without changing geometry or legacy maps', () => {
  const { data, renamed } = renameFixture();
  data.maps[0].editor = {
    version: 1,
    mode: 'detail',
    baseVisible: false,
    regions: [
      {
        id: 'region_harbor',
        name: '[[ 雾港 ]] 的森林，邻近 [[雾港旧城]]',
        biome: 'forest',
        geometry: 'polygon',
        points: [
          { x: 12, y: 24 },
          { x: 80, y: 30 },
          { x: 44, y: 92 },
        ],
        width: 28,
        seed: 97,
        roughness: 0.3,
        density: 0.8,
        visible: true,
        locked: true,
      },
    ],
    objects: [
      {
        id: 'object_harbor',
        name: '拜访 [[雾港]]',
        kind: 'text',
        points: [{ x: 50, y: 60 }],
        text: '从 [[\t雾港\t]] 出发，普通文字雾港不变。',
        color: '#336699',
        stroke: '#123456',
        strokeWidth: 2,
        size: 20,
        rotation: 30,
        opacity: 0.8,
        visible: true,
        locked: false,
      },
    ],
  };
  const otherMap = data.maps.find((map) => map.worldId === 'other_world')!;
  otherMap.editor = structuredClone(data.maps[0].editor);
  const snapshot = structuredClone(data);

  const result = saveEntityInWorkspace(data, renamed);
  const expectedEditor = structuredClone(data.maps[0].editor);
  expectedEditor.regions[0].name = '[[新雾港]] 的森林，邻近 [[雾港旧城]]';
  expectedEditor.objects[0].name = '拜访 [[新雾港]]';
  expectedEditor.objects[0].text = '从 [[新雾港]] 出发，普通文字雾港不变。';
  assert.deepEqual(result.maps[0].editor, expectedEditor);
  assert.equal(
    result.maps.find((map) => map.id === otherMap.id),
    otherMap,
  );
  assert.deepEqual(otherMap.editor, snapshot.maps.find((map) => map.id === otherMap.id)!.editor);
  assert.equal(
    Object.hasOwn(result.maps[1], 'editor'),
    false,
    'legacy maps stay without editor data',
  );
  assert.deepEqual(data, snapshot, 'renaming must not mutate any input map or editor');
});
