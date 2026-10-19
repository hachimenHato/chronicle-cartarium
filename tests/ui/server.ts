// This server never loads .env or creates a MySQL connection.
// Each browser run uses a new, ignored directory and its own DemoStore.
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { createApp } from '../../server/app';
import { DemoStore } from '../../server/store';
import { readConfig } from '../../server/config';
import { InstallationManager } from '../../server/installation';
import { createEmptyWorkspace } from '../../shared/empty';

const root = path.resolve('.runtime');
await mkdir(root, { recursive: true });
const directory = await mkdtemp(path.join(root, 'ui-run-'));
const config = readConfig({ NODE_ENV: 'test', PORT: '3311', DATA_DIR: directory });
const store = await new DemoStore(path.join(directory, 'workspace.json')).initialize();
const app = await createApp(config, store);
// The install UI has its own freshly created DEMO store. It never connects to
// SQLite/MySQL; durable SQLite behavior is covered separately by backend tests.
const installConfig = { ...config, dataDir: path.join(directory, 'installation') };
const manager = await InstallationManager.open(installConfig, (filename) =>
  new DemoStore(filename + '.json', createEmptyWorkspace).initialize(),
);
const installApp = await createApp(installConfig, manager);
const multiuserConfig = { ...config, dataDir: path.join(directory, 'multiuser') };
const multiuserManager = await InstallationManager.open(multiuserConfig, (filename) =>
  new DemoStore(filename + '.json', createEmptyWorkspace).initialize(),
);
const multiuserApp = await createApp(multiuserConfig, multiuserManager);
const backupsConfig = { ...config, dataDir: path.join(directory, 'backups') };
const backupsManager = await InstallationManager.open(backupsConfig, (filename) =>
  new DemoStore(filename + '.json', createEmptyWorkspace).initialize(),
);
const backupsApp = await createApp(backupsConfig, backupsManager);
const router = express();
router.use('/__installation', installApp);
router.use('/__multiuser', multiuserApp);
router.use('/__backups', backupsApp);
router.use(app);
router.listen(3311, '127.0.0.1', () => console.log('Isolated UI test server ready'));
