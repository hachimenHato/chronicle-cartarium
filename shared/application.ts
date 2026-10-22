import type { WorkspaceEnvelope } from './model';
import type { UserAccount } from './access';
export const APPLICATION_VERSION = '0.2.0-beta.19';

export const themes = { parchment: '羊皮卷', jade: '青玉庭', midnight: '星夜' } as const;
export type Theme = keyof typeof themes;
export interface ApplicationSettings {
  title: string;
  theme: Theme;
  access: 'local' | 'server';
}
export interface InstallationStatus {
  setupRequired: boolean;
  setupTokenRequired?: boolean;
  configuredStorage?: 'mysql' | 'sqlite';
  authenticated: boolean;
  loginRequired: boolean;
  username?: string;
  settings?: ApplicationSettings;
  actor?: UserAccount;
  multiUser?: boolean;
}
export const RESET_CONFIRMATION = '初始化全部创作数据';
export interface ResetResult {
  envelope: WorkspaceEnvelope;
  backup: string;
  cleanupWarning: boolean;
}
