export interface ProgramUpdateStatus {
  mode: 'managed' | 'manual' | 'docker';
  phase:
    | 'idle'
    | 'prepared'
    | 'preparing'
    | 'backup'
    | 'switching'
    | 'checking'
    | 'complete'
    | 'rolled-back'
    | 'error';
  message: string;
  version?: string;
  packageId?: string;
}

export interface OnlineUpdateSettings {
  channel: 'stable' | 'preview';
  source: 'github' | 'mirror';
  mirrorBaseUrl?: string;
}

export interface OnlineUpdateRelease {
  version: string;
  name: string;
  notes: string;
  publishedAt: string;
  releaseUrl: string;
  asset?: { name: string; bytes: number; sha256: string };
}

export interface OnlineUpdateTask {
  id: string;
  phase: 'downloading' | 'verifying' | 'prepared' | 'error' | 'cancelled';
  version: string;
  received: number;
  total: number;
  source: 'github' | 'mirror';
  message: string;
  packageId?: string;
}

export interface OnlineUpdateStatus {
  currentVersion: string;
  platform: string;
  architecture: string;
  settings: OnlineUpdateSettings;
  checking: boolean;
  checkedAt?: string;
  checkError?: string;
  notice?: string;
  release?: OnlineUpdateRelease;
  upToDate: boolean;
  supported: boolean;
  supportMessage?: string;
  task?: OnlineUpdateTask;
}
