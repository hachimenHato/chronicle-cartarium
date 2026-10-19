import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import { ownerAccount, type UserAccount } from '../shared/access';
import { createSeed } from '../shared/seed';
import { visibleWorkspace, mergeAuthorizedWorkspace, PermissionError } from '../server/permissions';
import { InstallationManager } from '../server/installation';
import { readConfig } from '../server/config';
import { createApp } from '../server/app';
import { validateWorkspace } from '../server/validation';
import { applyEntityTypes, getEntityTypes } from '../shared/entity-types';
import { newEntity } from '../shared/entity-templates';

const reader = (): UserAccount => ({
  ...ownerAccount('player'),
  id: 'user_reader',
  role: 'user',
  canExport: false,
  canViewPrivate: false,
});
test('privacy is scoped to the current world and changing a plot title retains hidden entity associations', () => {
  const data = createSeed(),
    actor = reader();
  const publicEntity = data.entities[0];
  publicEntity.content = `同一世界的 [[${publicEntity.name}]]`;
  data.worlds.push({ ...data.worlds[0], id: 'other_world', name: '另一个世界' });
  data.entities.push({
    ...publicEntity,
    id: 'other_private_entity',
    worldId: 'other_world',
    visibility: 'gm',
  });
  const secret = data.entities[data.entities.length - 2];
  secret.visibility = 'gm';
  data.variables.forEach((v) => {
    v.visibility = 'public';
  });
  data.plots[0].visibility = 'public';
  data.plots[0].nodes[0].entityIds.push(secret.id);
  actor.grants.plots = { create: false, update: 'any', delete: 'none' };
  const shown = visibleWorkspace(data, actor);
  assert.equal(shown.entities.find((e) => e.id === publicEntity.id)!.content, publicEntity.content);
  assert(!shown.plots[0].nodes[0].entityIds.includes(secret.id));
  shown.plots[0].nodes[0].title = '只修改标题';
  const saved = mergeAuthorizedWorkspace(data, shown, actor);
  assert(saved.plots[0].nodes[0].entityIds.includes(secret.id));
});
test('public-only projection never deletes hidden records and rejects unauthorized edits and ownership forgery', () => {
  const data = createSeed();
  data.entities.at(-1)!.visibility = 'gm';
  const actor = reader();
  const shown = visibleWorkspace(data, actor);
  assert(shown.entities.length > 0 && shown.entities.length < data.entities.length);
  assert(shown.entities.every((e) => e.visibility === 'public'));
  assert.equal(shown.plots.length, 0);
  assert.deepEqual(mergeAuthorizedWorkspace(data, shown, actor), data);
  const changed = structuredClone(shown);
  changed.entities[0].name += '变更';
  assert.throws(() => mergeAuthorizedWorkspace(data, changed, actor), PermissionError);
  actor.grants.lore = { create: true, update: 'own', delete: 'own' };
  const entity = newEntity(data.worlds[0].id, 'location', data.worlds[0]);
  entity.name = '普通用户的地点';
  changed.entities = [...shown.entities, entity];
  const merged = mergeAuthorizedWorkspace(data, changed, actor);
  assert.equal(merged.entities.at(-1)?.createdBy, actor.id);
  assert.equal(merged.entities.length, data.entities.length + 1);
  const own = visibleWorkspace(merged, actor);
  own.entities.at(-1)!.summary = '我的修改';
  assert.equal(mergeAuthorizedWorkspace(merged, own, actor).entities.at(-1)?.summary, '我的修改');
  own.entities.at(-1)!.createdBy = 'owner';
  assert.throws(() => mergeAuthorizedWorkspace(merged, own, actor), PermissionError);
  const individual = reader();
  const target = shown.entities[0];
  individual.records[target.id] = { update: true };
  const granted = visibleWorkspace(data, individual);
  granted.entities[0].summary = '单独授权修改';
  assert.equal(
    mergeAuthorizedWorkspace(data, granted, individual).entities.find((e) => e.id === target.id)
      ?.summary,
    '单独授权修改',
  );
  individual.records[target.id].update = false;
  individual.grants[target.type === 'character' ? 'characters' : 'lore'] = {
    create: false,
    update: 'any',
    delete: 'any',
  };
  assert.throws(() => mergeAuthorizedWorkspace(data, granted, individual), PermissionError);
});

test('custom catalogues, field templates, covers and graph positions validate and protect used types', () => {
  let data = createSeed();
  const world = data.worlds[0];
  data = applyEntityTypes(data, world.id, [
    ...getEntityTypes(world),
    { id: 'custom_relic', name: '外貌研究', description: '自定义类型' },
  ]);
  const entity = newEntity(world.id, 'custom_relic', data.worlds[0]);
  entity.name = '封面的实验';
  entity.cover = '/uploads/example.png';
  entity.graphPosition = { x: 120, y: 500 };
  data.entities.push(entity);
  data.worlds[0].entityTemplates = { custom_relic: ['外貌'] };
  assert.deepEqual(validateWorkspace(data), data);
  assert.throws(() => applyEntityTypes(data, world.id, getEntityTypes(world)), /仍有条目/);
  assert.throws(
    () =>
      applyEntityTypes(
        data,
        world.id,
        getEntityTypes(world).filter((t) => t.id !== 'character'),
      ),
    /角色档案/,
  );
  assert.throws(() =>
    validateWorkspace({
      ...data,
      entities: [
        ...data.entities,
        { ...entity, id: 'other', name: 'other', type: 'custom_missing' },
      ],
    }),
  );
});
test('public map edits retain hidden pins and entity renames maintain private references without granting broader writes', () => {
  const data = createSeed(),
    actor = reader();
  const secret = data.entities.at(-1)!;
  secret.visibility = 'gm';
  const map = data.maps[0];
  map.visibility = 'public';
  map.pins.push({
    id: 'hidden_pin',
    x: 100,
    y: 100,
    label: '私密地点',
    description: '保持原文',
    kind: 'note',
    entityId: secret.id,
  });
  actor.grants.maps = { create: false, update: 'any', delete: 'none' };
  const shown = visibleWorkspace(data, actor);
  assert(!shown.maps[0].pins.some((p) => p.id === 'hidden_pin'));
  shown.maps[0].summary = '公开地图的修改';
  let result = mergeAuthorizedWorkspace(data, shown, actor);
  assert.deepEqual(result.maps[0].pins, data.maps[0].pins);
  shown.maps[0].pins.push({
    id: 'visible_new_pin',
    x: 140,
    y: 170,
    label: '新增公开地点',
    description: '',
    kind: 'note',
  });
  result = mergeAuthorizedWorkspace(data, shown, actor);
  assert.equal(result.maps[0].pins.filter((p) => p.id === 'hidden_pin').length, 1);
  const entity = data.entities[0];
  entity.createdBy = actor.id;
  actor.grants[entity.type === 'character' ? 'characters' : 'lore'] = {
    create: false,
    update: 'own',
    delete: 'own',
  };
  data.sessions[0].content = `保密记录 [[${entity.name}]]`;
  const editable = visibleWorkspace(data, actor);
  editable.entities.find((e) => e.id === entity.id)!.name = '新的条目名称';
  result = mergeAuthorizedWorkspace(data, editable, actor);
  assert.equal(result.sessions[0].content, '保密记录 [[新的条目名称]]');
  data.relations.push({
    id: 'protected_relation',
    worldId: entity.worldId,
    sourceId: entity.id,
    targetId: data.entities[1].id,
    label: '管理员建立的关系',
    description: '保留',
    kind: 'neutral',
    visibility: 'gm',
  });
  const deleted = visibleWorkspace(data, actor);
  deleted.entities = deleted.entities.filter((e) => e.id !== entity.id);
  assert.throws(() => mergeAuthorizedWorkspace(data, deleted, actor), PermissionError);
});

test('multiuser sessions, role gates, filtered saves, export and disabling take effect at the API boundary', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worldloom-access-'));
  const manager = await InstallationManager.open(
    readConfig({ DATA_DIR: directory, COOKIE_SECURE: 'false' }),
  );
  const app = await createApp(manager.config, manager);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  t.after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await manager.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (url: string, method = 'GET', body?: unknown, cookie?: string) =>
    fetch(base + url, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const install = await send('/api/install', 'POST', {
    storage: 'sqlite',
    title: '权限验收',
    theme: 'parchment',
    access: 'local',
    username: 'gm',
    password: 'testing-password-2026',
    fillExample: false,
  });
  assert.equal(install.status, 201);
  const owner = install.headers.get('set-cookie')!.split(';')[0];
  const seed = createSeed();
  seed.entities.at(-1)!.visibility = 'gm';
  assert.equal(
    (
      await send(
        '/api/workspace',
        'PUT',
        { data: seed, revision: (await manager.read()).revision },
        owner,
      )
    ).status,
    200,
  );
  const mode = await send('/api/admin/users/mode', 'PUT', { enabled: true, revision: 0 }, owner);
  assert.equal(mode.status, 200);
  const create = (name: string, role: string, revision: number) =>
    send(
      '/api/admin/users',
      'PUT',
      {
        username: name,
        role,
        disabled: false,
        grants: {},
        records: {},
        canExport: false,
        canViewPrivate: false,
        password: 'testing-password-2026',
        revision,
      },
      owner,
    );
  const created = await create('player', 'user', 1);
  assert.equal(created.status, 200);
  const accounts = await created.json();
  assert(!JSON.stringify(accounts).includes('passwordHash'));
  const playerId = accounts.users.find((u: UserAccount) => u.username === 'player').id;
  assert.equal((await create('assistant', 'moderator', 2)).status, 200);
  const login = async (name: string) => {
    const result = await send('/api/login', 'POST', {
      username: name,
      password: 'testing-password-2026',
    });
    assert.equal(result.status, 200);
    return result.headers.get('set-cookie')!.split(';')[0];
  };
  const player = await login('player');
  const moderator = await login('assistant');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=',
    'base64',
  );
  const upload = async () => {
    const body = new FormData();
    body.append('file', new Blob([png], { type: 'image/png' }), 'cover.png');
    const response = await fetch(base + '/api/uploads', {
      method: 'POST',
      headers: { Cookie: owner },
      body,
    });
    assert.equal(response.status, 201);
    return (await response.json()).url as string;
  };
  const privateImage = await upload(),
    publicImage = await upload();
  const images = await manager.read();
  images.data.entities.at(-1)!.cover = privateImage;
  images.data.entities[0].cover = publicImage;
  await manager.save(images.data, images.revision);
  assert.equal((await send(privateImage, 'GET', undefined, player)).status, 403);
  assert.equal((await send(publicImage, 'GET', undefined, player)).status, 200);
  assert.equal((await send(privateImage, 'GET', undefined, moderator)).status, 200);
  const envelope = await (await send('/api/workspace', 'GET', undefined, player)).json();
  assert(envelope.data.entities.every((e: { visibility: string }) => e.visibility === 'public'));
  assert.equal(envelope.data.plots.length, 0);
  assert.equal((await send('/api/workspace', 'PUT', envelope, player)).status, 400); // envelope includes mode, strict writes reject it
  assert.equal(
    (
      await send(
        '/api/workspace',
        'PUT',
        { data: envelope.data, revision: envelope.revision },
        player,
      )
    ).status,
    200,
  );
  assert.equal((await manager.read()).data.entities.length, createSeed().entities.length);
  envelope.data.entities[0].summary += '越权';
  assert.equal(
    (
      await send(
        '/api/workspace',
        'PUT',
        { data: envelope.data, revision: (await manager.read()).revision },
        player,
      )
    ).status,
    403,
  );
  for (const route of [
    '/api/admin',
    '/api/admin/users',
    '/api/backup',
    '/api/admin/full-backups',
    '/api/admin/updates',
  ])
    assert.equal((await send(route, 'GET', undefined, player)).status, 403);
  assert.equal((await send('/api/export', 'POST', {}, player)).status, 403);
  assert.equal((await send('/api/admin/users', 'GET', undefined, moderator)).status, 200);
  assert.equal((await send('/api/backup', 'GET', undefined, moderator)).status, 403);
  assert.equal((await send('/api/admin/full-backups', 'GET', undefined, moderator)).status, 403);
  assert.equal((await send('/api/admin/full-backups', 'POST', {}, moderator)).status, 403);
  assert.equal((await send('/api/admin/updates', 'GET', undefined, moderator)).status, 403);
  assert.equal((await send('/api/admin/updates/apply', 'POST', {}, moderator)).status, 403);
  assert.equal(
    (
      await send(
        '/api/admin/settings',
        'PUT',
        { title: '禁止', theme: 'jade', access: 'server' },
        moderator,
      )
    ).status,
    403,
  );
  assert.equal((await send('/api/admin/reset', 'POST', {}, moderator)).status, 403);
  const full = await (await send('/api/workspace', 'GET', undefined, moderator)).json();
  full.data.worlds[0].name = '禁止修改世界';
  assert.equal(
    (await send('/api/workspace', 'PUT', { data: full.data, revision: full.revision }, moderator))
      .status,
    403,
  );
  const record = accounts.users.find((u: UserAccount) => u.id === playerId);
  const disabled = await send(
    '/api/admin/users',
    'PUT',
    { ...record, tourCompleted: undefined, disabled: true, revision: 3 },
    owner,
  );
  assert.equal(disabled.status, 200);
  assert.equal((await send('/api/workspace', 'GET', undefined, player)).status, 401);
  const after = await send('/api/admin/users/mode', 'PUT', { enabled: false, revision: 4 }, owner);
  assert.equal(after.status, 200);
  assert.equal((await send('/api/workspace', 'GET', undefined, moderator)).status, 401);
});
