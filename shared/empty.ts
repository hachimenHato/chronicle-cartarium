import type { Workspace } from './model';
export function createEmptyWorkspace(): Workspace {
  return {
    worlds: [],
    entities: [],
    maps: [],
    relations: [],
    plots: [],
    sessions: [],
    variables: [],
  };
}
