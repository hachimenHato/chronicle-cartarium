import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availability, evaluateCondition } from '../src/lib/plot-engine.ts';
import { exportMarkdown, type ExportOptions } from '../src/lib/export.ts';
import { createSeed } from '../shared/seed.ts';
import type { Condition, Plot, PlotNode, StateVariable, Workspace } from '../shared/model.ts';

const condition = (
  operator: Condition['operator'],
  value: string,
  variable = '警戒度',
): Condition => ({ variable, operator, value });
const variable = (name: string, value: string): StateVariable => ({
  id: `v_${name}`,
  worldId: 'world',
  name,
  value,
});
const node = (id: string, patch: Partial<PlotNode> = {}): PlotNode => ({
  id,
  title: id,
  summary: '',
  entityIds: [],
  x: 0,
  y: 0,
  kind: 'scene',
  status: 'locked',
  conditions: [],
  conditionMode: 'all',
  effects: [],
  ...patch,
});
const plot = (nodes: PlotNode[], edges: Plot['edges'] = []): Plot => ({
  id: 'plot',
  worldId: 'world',
  name: '测试路线',
  summary: '',
  nodes,
  edges,
});

function exportFixture(): { data: Workspace; options: ExportOptions } {
  const data = createSeed();
  const secret = data.entities.find((entity) => entity.id === 'e_key')!;
  secret.visibility = 'gm';
  secret.content = 'SECRET_ENTITY_BODY_927';
  data.plots[0].summary = 'SECRET_PLOT_BODY_928';
  data.sessions[0].content = 'SECRET_SESSION_BODY_929';
  data.maps[0].pins.push({
    id: 'pin_secret',
    x: 50,
    y: 50,
    label: 'SECRET_PIN_930',
    description: 'SECRET_PIN_BODY',
    kind: 'note',
    entityId: secret.id,
  });
  return {
    data,
    options: {
      worldId: data.worlds[0].id,
      entityIds: data.entities.map((entity) => entity.id),
      includeMaps: true,
      includeRelations: true,
      includePlots: true,
      includeSessions: true,
      includeSecrets: false,
    },
  };
}

test('conditions use exact text equality and substring matching without numeric coercion', () => {
  assert.equal(evaluateCondition(condition('eq', '01'), { 警戒度: '1' }), false);
  assert.equal(evaluateCondition(condition('neq', '01'), { 警戒度: '1' }), true);
  assert.equal(evaluateCondition(condition('eq', 'true'), { 警戒度: 'true' }), true);
  assert.equal(evaluateCondition(condition('contains', '灰羽'), { 警戒度: '伊莱娅·灰羽' }), true);
  assert.equal(
    evaluateCondition(condition('contains', '不存在'), { 警戒度: '伊莱娅·灰羽' }),
    false,
  );
});

test('numeric comparisons accept finite complete numbers and reject blanks, suffixes and infinity', () => {
  for (const [op, value, expected] of [
    ['gt', '2', true],
    ['gte', '10.5', true],
    ['lt', '11', true],
    ['lte', '10.5', true],
  ] as const) {
    assert.equal(evaluateCondition(condition(op, value), { 警戒度: '10.5' }), expected);
  }
  for (const invalid of ['', ' ', '2abc', 'NaN', 'Infinity', '-Infinity', '1e999']) {
    for (const op of ['gt', 'gte', 'lt', 'lte'] as const) {
      assert.equal(
        evaluateCondition(condition(op, '0'), { 警戒度: invalid }),
        false,
        `${op} received ${JSON.stringify(invalid)}`,
      );
      assert.equal(
        evaluateCondition(condition(op, invalid), { 警戒度: '0' }),
        false,
        `${op} expected ${JSON.stringify(invalid)}`,
      );
    }
  }
});

test('unknown variables never match, including object-prototype property names', () => {
  for (const name of ['不存在', 'constructor', 'toString', '__proto__']) {
    for (const op of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'] as const) {
      assert.equal(evaluateCondition(condition(op, '1', name), {}), false, `${name} ${op}`);
    }
  }
  assert.equal(
    evaluateCondition(
      condition('eq', '1', 'constructor'),
      Object.fromEntries([['constructor', '1']]),
    ),
    true,
  );
});

test('AND requires every condition while OR requires one condition', () => {
  const conditions = [condition('gte', '2'), condition('eq', '是', '通行证')];
  const all = node('all', { conditions, conditionMode: 'all' });
  const any = node('any', { conditions, conditionMode: 'any' });
  const story = plot([all, any]);
  const onePassed = [variable('警戒度', '2'), variable('通行证', '否')];
  assert.equal(availability(all, story, onePassed).ready, false);
  assert.equal(availability(any, story, onePassed).ready, true);
  assert.equal(
    availability(all, story, [...onePassed.slice(0, 1), variable('通行证', '是')]).ready,
    true,
  );
  assert.equal(
    availability(any, story, [variable('警戒度', '0'), variable('通行证', '否')]).ready,
    false,
  );
});

test('empty condition lists impose no gate for either combination mode', () => {
  for (const conditionMode of ['all', 'any'] as const) {
    const scene = node(conditionMode, { conditionMode });
    assert.equal(availability(scene, plot([scene]), []).ready, true);
  }
});

test('at least one completed predecessor is required independently of condition mode', () => {
  const first = node('first'),
    second = node('second'),
    target = node('target', { status: 'available', conditionMode: 'any' });
  const story = plot(
    [first, second, target],
    [
      { id: 'a', source: first.id, target: target.id, label: '' },
      { id: 'b', source: second.id, target: target.id, label: '' },
    ],
  );
  assert.equal(
    availability(target, story, []).ready,
    false,
    'stored available status must not bypass predecessors',
  );
  first.status = 'completed';
  assert.equal(
    availability(target, story, []).ready,
    true,
    'a single completed predecessor is sufficient',
  );
  target.conditions = [condition('eq', '是', '通行证')];
  assert.equal(
    availability(target, story, [variable('通行证', '否')]).ready,
    false,
    'a predecessor does not bypass conditions',
  );
  assert.equal(availability(target, story, [variable('通行证', '是')]).ready, true);
});

test('completed scenes cannot be advanced again even when all other gates pass', () => {
  const scene = node('complete', {
    status: 'completed',
    effects: [{ variable: '警戒度', value: '1' }],
  });
  const result = availability(scene, plot([scene]), [variable('警戒度', '0')]);
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((reason) => reason.includes('已经完成')));
});

test('seed has unique IDs and complete same-world structural and wiki references', () => {
  const data = createSeed();
  const ids = new Set<string>();
  const register = (id: string) => {
    assert.ok(!ids.has(id), `duplicate ${id}`);
    ids.add(id);
  };
  for (const group of Object.values(data)) for (const item of group) register(item.id);
  const entities = new Map(data.entities.map((entity) => [entity.id, entity]));
  const maps = new Map(data.maps.map((map) => [map.id, map]));
  for (const map of data.maps) {
    if (map.parentId) assert.equal(maps.get(map.parentId)?.worldId, map.worldId);
    for (const pin of map.pins) {
      register(pin.id);
      if (pin.entityId) assert.equal(entities.get(pin.entityId)?.worldId, map.worldId);
      if (pin.childMapId) assert.equal(maps.get(pin.childMapId)?.worldId, map.worldId);
    }
    for (const stroke of map.strokes) register(stroke.id);
  }
  for (const relation of data.relations) {
    assert.equal(entities.get(relation.sourceId)?.worldId, relation.worldId);
    assert.equal(entities.get(relation.targetId)?.worldId, relation.worldId);
  }
  for (const story of data.plots) {
    const sceneIds = new Set(story.nodes.map((scene) => scene.id));
    const variableNames = new Set(
      data.variables.filter((value) => value.worldId === story.worldId).map((value) => value.name),
    );
    for (const scene of story.nodes) {
      register(scene.id);
      for (const id of scene.entityIds) assert.equal(entities.get(id)?.worldId, story.worldId);
      for (const rule of [...scene.conditions, ...scene.effects])
        assert.ok(variableNames.has(rule.variable));
    }
    for (const edge of story.edges) {
      register(edge.id);
      assert.ok(sceneIds.has(edge.source) && sceneIds.has(edge.target));
    }
  }
  for (const entity of data.entities) {
    for (const match of `${entity.summary}\n${entity.content}\n${Object.values(entity.attributes).join('\n')}`.matchAll(
      /\[\[([^\]]+)\]\]/g,
    )) {
      assert.ok(
        data.entities.some(
          (target) => target.worldId === entity.worldId && target.name === match[1].trim(),
        ),
        `missing wiki reference ${match[1]}`,
      );
    }
  }
});

test('seed instances are independent and the example plot progresses through both clue conditions', () => {
  const data = createSeed(),
    independent = createSeed();
  const story = data.plots[0];
  assert.deepEqual(
    story.nodes.map((scene) => availability(scene, story, data.variables).ready),
    [true, false, false, false],
  );
  story.nodes[0].status = 'completed';
  data.variables.find((value) => value.name === '收到来信')!.value = 'true';
  assert.equal(independent.plots[0].nodes[0].status, 'available');
  assert.equal(independent.variables[0].value, 'false');
  assert.deepEqual(
    story.nodes.map((scene) => availability(scene, story, data.variables).ready),
    [false, true, true, false],
  );
  story.nodes[1].status = 'completed';
  data.variables.find((value) => value.name === '星象师信任')!.value = '1';
  assert.equal(availability(story.nodes[3], story, data.variables).ready, false);
  story.nodes[2].status = 'completed';
  data.variables.find((value) => value.name === '发现日记')!.value = 'true';
  assert.equal(availability(story.nodes[3], story, data.variables).ready, true);
});

test('player Markdown excludes GM entities, their pins, plot state and session content', () => {
  const { data, options } = exportFixture();
  const markdown = exportMarkdown(data, options);
  for (const forbidden of [
    'SECRET_ENTITY_BODY_927',
    'SECRET_PLOT_BODY_928',
    'SECRET_SESSION_BODY_929',
    'SECRET_PIN_930',
    '回声之钥',
    'id="e_key"',
    '## 剧情路线',
    '## 团务日志',
    '### 世界变量',
  ])
    assert.ok(!markdown.includes(forbidden), `leaked ${forbidden}`);
  assert.ok(markdown.includes('〔未公开条目〕'));
  assert.ok(markdown.includes('## 地图集'));
});

test('player Markdown redacts whitespace-padded secret wiki links consistently', () => {
  const { data, options } = exportFixture();
  data.entities.find((entity) => entity.id === 'e_port')!.content =
    '调查 [[ 回声之钥 ]] 与 [[\t回声之钥\t]]。';
  const markdown = exportMarkdown(data, options);
  assert.ok(!markdown.includes('回声之钥'));
  assert.ok(markdown.includes('调查 〔未公开条目〕 与 〔未公开条目〕。'));
});

test('player Markdown processes wiki privacy in world descriptions too', () => {
  const { data, options } = exportFixture();
  data.worlds[0].description = '危险来自 [[回声之钥]]，故事从 [[雾港]] 开始。';
  const markdown = exportMarkdown(data, options);
  assert.ok(!markdown.includes('回声之钥'));
  assert.ok(markdown.includes('危险来自 〔未公开条目〕，故事从 [雾港](#e_port) 开始。'));
});

test('partial Markdown has only resolvable internal entity anchors and respects optional sections', () => {
  const { data, options } = exportFixture();
  options.entityIds = ['e_port', 'e_council'];
  options.includeMaps = false;
  options.includePlots = false;
  options.includeSessions = false;
  options.includeSecrets = true;
  const markdown = exportMarkdown(data, options);
  const anchors = new Set(
    [...markdown.matchAll(/<a id="([^"]+)"><\/a>/g)].map((match) => match[1]),
  );
  assert.deepEqual([...anchors].sort(), ['e_council', 'e_port']);
  for (const match of markdown.matchAll(/\]\(#([^)]+)\)/g))
    assert.ok(anchors.has(match[1]), `dangling exported link ${match[1]}`);
  assert.ok(markdown.includes('[银帆议会](#e_council)'));
  assert.ok(markdown.includes('渡鸦酒馆'));
  assert.ok(!markdown.includes('(#e_tavern)'));
  for (const heading of ['## 地图集', '## 剧情路线', '## 团务日志'])
    assert.ok(!markdown.includes(heading));
});

test('GM export includes secrets only when requested and never exports another world', () => {
  const { data, options } = exportFixture();
  options.includeSecrets = true;
  data.worlds.push({ ...data.worlds[0], id: 'world_other', name: 'OTHER_WORLD' });
  data.entities.push({
    ...data.entities[0],
    id: 'entity_other',
    worldId: 'world_other',
    name: 'OTHER_ENTITY',
    content: 'OTHER_CONTENT',
  });
  options.entityIds.push('entity_other');
  const markdown = exportMarkdown(data, options);
  for (const expected of [
    'SECRET_ENTITY_BODY_927',
    'SECRET_PLOT_BODY_928',
    'SECRET_SESSION_BODY_929',
    'SECRET_PIN_930',
    '```mermaid',
    '### 世界变量',
  ])
    assert.ok(markdown.includes(expected), `missing ${expected}`);
  assert.ok(
    !markdown.includes('OTHER_WORLD') &&
      !markdown.includes('OTHER_ENTITY') &&
      !markdown.includes('OTHER_CONTENT'),
  );
});

test('empty selection is a valid metadata-only export and unknown worlds fail clearly', () => {
  const { data, options } = exportFixture();
  Object.assign(options, {
    entityIds: [],
    includeMaps: false,
    includeRelations: false,
    includePlots: false,
    includeSessions: false,
  });
  const markdown = exportMarkdown(data, options);
  assert.ok(markdown.startsWith('# 艾瑟兰'));
  assert.ok(!markdown.includes('<a id='));
  assert.throws(() => exportMarkdown(data, { ...options, worldId: 'missing' }), /世界不存在/);
});
