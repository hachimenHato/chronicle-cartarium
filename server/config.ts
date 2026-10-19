import path from 'node:path';
import { randomBytes } from 'node:crypto';

export interface AppConfig {
  production: boolean;
  port: number;
  databaseUrl?: string;
  password?: string;
  sessionSecret: string;
  secureCookies: boolean;
  trustProxy: boolean;
  dataDir: string;
  distDir: string;
  setupToken?: string;
  envFile?: string;
  installRoot?: string;
  updaterToken?: string;
  deployment?: 'managed' | 'docker' | 'manual';
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env.SETUP_TOKEN && env.SETUP_TOKEN.length < 24)
    throw new Error('SETUP_TOKEN must contain at least 24 characters.');
  const production = env.NODE_ENV === 'production';
  const password = env.APP_PASSWORD?.trim();
  const databaseUrl = env.DATABASE_URL?.trim();
  const installRoot = env.CHRONICLE_CARTARIUM_INSTALL_ROOT || env.WORLDLOOM_INSTALL_ROOT;
  const updaterToken = env.CHRONICLE_CARTARIUM_UPDATER_TOKEN || env.WORLDLOOM_UPDATER_TOKEN;
  const deployment = env.CHRONICLE_CARTARIUM_DEPLOYMENT || env.WORLDLOOM_DEPLOYMENT;
  if (production && env.INSTALLATION_WIZARD !== 'true' && (!password || !databaseUrl)) {
    throw new Error(
      'Production requires both APP_PASSWORD and DATABASE_URL. Demo fallback is disabled.',
    );
  }
  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be between 1 and 65535.');
  return {
    production,
    port,
    databaseUrl,
    password,
    sessionSecret: env.SESSION_SECRET || randomBytes(48).toString('hex'),
    secureCookies: env.COOKIE_SECURE === undefined ? production : env.COOKIE_SECURE === 'true',
    trustProxy: env.TRUST_PROXY === 'true',
    dataDir: path.resolve(env.DATA_DIR || 'data'),
    distDir: path.resolve('dist'),
    setupToken: env.SETUP_TOKEN,
    envFile: env.ENV_FILE ? path.resolve(env.ENV_FILE) : undefined,
    installRoot: installRoot ? path.resolve(installRoot) : undefined,
    updaterToken,
    deployment:
      deployment === 'docker' ? 'docker' : installRoot && updaterToken ? 'managed' : 'manual',
  };
}
