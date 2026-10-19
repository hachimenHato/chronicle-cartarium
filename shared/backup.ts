export interface FullBackupSummary {
  id: string;
  createdAt: string;
  applicationVersion: string;
  storage: 'sqlite' | 'mysql' | 'demo';
  revision: number;
  files: number;
  bytes: number;
  verified: boolean;
}
export interface BackupProgress {
  phase: 'idle' | 'waiting' | 'database' | 'files' | 'verifying' | 'complete' | 'error';
  message: string;
}
export interface BackupStatus {
  busy: boolean;
  progress: BackupProgress;
  backups: FullBackupSummary[];
}
