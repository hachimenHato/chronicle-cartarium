// Explicit opt-in runner. The test creates and removes only its own brand-new database.
import { spawnSync } from 'node:child_process';
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', 'tests/backend.mysql.test.ts', 'tests/backup.mysql.test.ts'],
  {
    env: { ...process.env, MYSQL_INTEGRATION: '1' },
    stdio: 'inherit',
  },
);
process.exit(result.status ?? 1);
