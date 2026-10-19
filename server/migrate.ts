import 'dotenv/config';
import mysql from 'mysql2/promise';
import { ensureSchema } from './store';

if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is required. Create a dedicated empty database and configure .env first.',
  );
  process.exitCode = 1;
} else {
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 1 });
  try {
    await ensureSchema(pool);
    console.log(
      'Chronicle Cartarium schema migrations through 005 applied successfully. Existing data was preserved.',
    );
  } catch (error) {
    console.error(
      'Migration failed:',
      (error as NodeJS.ErrnoException).code || (error as Error).name,
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
