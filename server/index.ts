import 'dotenv/config';
import { readConfig } from './config';
import { InstallationManager } from './installation';
import { createApp } from './app';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { acquireInstanceLock } from './instance-lock';
import { BRAND_EN } from '../shared/branding';

let releaseInstance: (() => Promise<void>) | undefined;

try {
  const config = readConfig({
    ...process.env,
    INSTALLATION_WIZARD: 'true',
    ENV_FILE: process.env.ENV_FILE || path.resolve('.env'),
  });
  releaseInstance = await acquireInstanceLock(config.dataDir);
  const store = await InstallationManager.open(config);
  if (config.deployment === 'docker') {
    const directory = path.join(config.dataDir, '.worldloom');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const key = path.join(directory, 'runner.key');
    try {
      await writeFile(key, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    config.updaterToken = await readFile(key, 'utf8');
  }
  let hold =
    (process.env.CHRONICLE_CARTARIUM_UPDATE_HOLD || process.env.WORLDLOOM_UPDATE_HOLD) === 'true';
  if (config.deployment === 'docker') {
    const state = await readFile(
      path.join(config.dataDir, '.worldloom/update-state.json'),
      'utf8',
    ).then(JSON.parse, (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return undefined;
    });
    if (state?.phase === 'complete') hold = false;
    else if (state && ['backup', 'switching', 'checking'].includes(state.phase)) hold = true;
  }
  if (hold) await store.maintenance.holdAtStartup();
  if (
    store.setupRequired &&
    process.env.HOST &&
    !['127.0.0.1', 'localhost', '::1'].includes(process.env.HOST) &&
    !config.setupToken
  )
    throw new Error('Network bootstrap requires SETUP_TOKEN.');
  if (process.env.COOKIE_SECURE === undefined) config.secureCookies = false;
  const app = await createApp(
    config,
    store,
    () => {
      if (!process.env.HOST && store.settings.access === 'server') {
        setTimeout(() => {
          server.close(() => server.listen(config.port, '0.0.0.0'));
          server.closeAllConnections();
        }, 500).unref();
      }
    },
    () => shutdown(),
  );
  const server = app.listen(
    config.port,
    process.env.HOST ||
      (store.settings.access === 'server' && !store.setupRequired ? '0.0.0.0' : '127.0.0.1'),
    () => {
      console.log(
        `${BRAND_EN}: http://localhost:${config.port} | storage=${store.mode} | setup=${store.setupRequired}`,
      );
      if (store.mode === 'demo')
        console.warn('DEMO MODE: local JSON persistence only. Configure DATABASE_URL for MySQL.');
    },
  );
  let closing = false;
  function shutdown() {
    if (closing) return;
    closing = true;
    server.close(() => {
      void store.close().then(async () => {
        await releaseInstance?.();
        process.exit(0);
      });
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, shutdown);
} catch (error) {
  await releaseInstance?.();
  const err = error as NodeJS.ErrnoException;
  console.error(
    `Startup failed (${err.code || err.name}). Verify environment, database connectivity, migration permissions, and data format. No database fallback was used.`,
  );
  process.exit(1);
}
