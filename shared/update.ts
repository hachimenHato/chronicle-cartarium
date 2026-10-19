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
