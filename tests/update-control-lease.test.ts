import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { MaintenanceGate, MaintenanceError } from '../server/maintenance';
import { UpdateControlLease } from '../server/update-control-lease';
import { InstallationManager } from '../server/installation';
import { readConfig } from '../server/config';
import { createApp } from '../server/app';
import { FullBackupService } from '../server/full-backup';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

test('only the owning lease can release a completed runner backup; legacy controls stay compatible', async () => {
  const gate = new MaintenanceGate(),
    control = new UpdateControlLease(gate);
  const lease = randomUUID();
  assert.equal(await control.backup(lease, async () => 'verified'), 'verified');
  assert.equal(gate.busy, true);
  assert.equal(control.release(), 'mismatch');
  assert.equal(control.release(randomUUID()), 'mismatch');
  await assert.rejects(
    gate.write(async () => true),
    MaintenanceError,
  );
  assert.equal(control.release(lease), 'released');
  assert.equal(await gate.write(async () => 'saved'), 'saved');
  await control.backup(undefined, async () => true);
  assert.equal(control.release(lease), 'mismatch');
  assert.equal(control.release(), 'released');
  assert.equal(gate.busy, false);
});

test('early release or lost HTTP response keeps writes drained until snapshot work finishes', async () => {
  for (const disconnected of [false, true]) {
    const gate = new MaintenanceGate(),
      control = new UpdateControlLease(gate);
    const lease = randomUUID(),
      entered = deferred(),
      finish = deferred();
    let abandon!: () => void;
    const backup = control.backup(
      lease,
      async () => {
        entered.resolve();
        await finish.promise;
        return 'consistent';
      },
      (release) => {
        abandon = release;
      },
    );
    await entered.promise;
    if (disconnected) abandon();
    else assert.equal(control.release(lease), 'pending');
    await assert.rejects(
      gate.write(async () => true),
      MaintenanceError,
    );
    await assert.rejects(
      control.backup(randomUUID(), async () => true),
      MaintenanceError,
    );
    finish.resolve();
    assert.equal(await backup, 'consistent');
    assert.equal(await gate.write(async () => 'new content'), 'new content');
    assert.equal(control.release(lease), 'absent');
  }
});

test('failed or disconnected acquisition never releases another maintenance owner', async () => {
  const gate = new MaintenanceGate(),
    control = new UpdateControlLease(gate);
  const external = await gate.acquire();
  await assert.rejects(
    control.backup(randomUUID(), async () => true),
    MaintenanceError,
  );
  assert.equal(control.release(), 'absent');
  assert.equal(gate.busy, true);
  external();
  const writing = deferred(),
    writerEntered = deferred();
  const writer = gate.write(async () => {
    writerEntered.resolve();
    await writing.promise;
  });
  await writerEntered.promise;
  let called = false;
  const backup = control.backup(
    randomUUID(),
    async () => {
      called = true;
    },
    (abandon) => abandon(),
  );
  writing.resolve();
  await writer;
  await assert.rejects(backup, MaintenanceError);
  assert.equal(called, false);
  assert.equal(gate.busy, false);
});

test('backup errors release their own lease while stale disconnect callbacks cannot release a newer owner', async () => {
  const gate = new MaintenanceGate(),
    control = new UpdateControlLease(gate);
  await assert.rejects(
    control.backup(randomUUID(), async () => {
      throw new Error('backup failed');
    }),
    /backup failed/,
  );
  assert.equal(gate.busy, false);
  let stale!: () => void;
  const first = randomUUID(),
    second = randomUUID();
  await control.backup(
    first,
    async () => true,
    (release) => {
      stale = release;
    },
  );
  assert.equal(control.release(first), 'released');
  await control.backup(second, async () => true);
  stale();
  assert.equal(gate.busy, true);
  assert.equal(control.release(second), 'released');
});

test('real runner HTTP rejects foreign/legacy releases and releases disconnected snapshots only after completion', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chronicle-update-lease-'));
  const token = randomBytes(32).toString('hex');
  const config = {
    ...readConfig({ DATA_DIR: path.join(directory, 'data'), COOKIE_SECURE: 'false' }),
    installRoot: directory,
    updaterToken: token,
    deployment: 'managed' as const,
  };
  const manager = await InstallationManager.open(config);
  await manager.install({
    storage: 'sqlite',
    title: '维护租约验证',
    theme: 'jade',
    access: 'local',
    username: 'gm',
    password: 'lease-test-password-2026',
    fillExample: false,
  });
  const before = await manager.read();
  const original = FullBackupService.prototype.create;
  let finish = deferred(),
    entered = deferred();
  FullBackupService.prototype.create = async function () {
    entered.resolve();
    await finish.promise;
    return { verified: true } as Awaited<ReturnType<typeof original>>;
  };
  const app = await createApp(config, manager);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(async () => {
    finish.resolve();
    FullBackupService.prototype.create = original;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await manager.close();
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const control = (action: string, lease?: string, signal?: AbortSignal) =>
    fetch(origin + '/_worldloom/update/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ...(lease ? { lease } : {}) }),
      signal,
    });
  const lease = randomUUID();
  const first = control('backup', lease);
  await entered.promise;
  assert.equal((await control('release')).status, 409);
  assert.equal((await control('release', randomUUID())).status, 409);
  assert.equal(manager.maintenance.busy, true);
  finish.resolve();
  assert.equal((await first).status, 200);
  assert.equal(manager.maintenance.busy, true);
  assert.equal((await control('release', lease)).status, 200);
  assert.equal(manager.maintenance.busy, false);

  finish = deferred();
  entered = deferred();
  const abort = new AbortController();
  const pending = control('backup', randomUUID(), abort.signal);
  await entered.promise;
  abort.abort();
  await assert.rejects(pending);
  // The response close event only requests release; it cannot unlock a live snapshot.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(manager.maintenance.busy, true);
  finish.resolve();
  for (let attempt = 0; manager.maintenance.busy && attempt < 100; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(manager.maintenance.busy, false);
  assert.deepEqual(await manager.read(), before);
});
