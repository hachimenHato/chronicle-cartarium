import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { Workspace, WorkspaceEnvelope } from '../../shared/model';
import { saveWorkspace } from './api';
import { reconcileSnapshot, rebaseSnapshot } from './reconcile-snapshot';
export function useWorkspace(initial: WorkspaceEnvelope) {
  const [data, setDataState] = useState(initial.data);
  const [status, setStatus] = useState<'saved' | 'saving' | 'pending' | 'error' | 'conflict'>(
    'saved',
  );
  const [error, setError] = useState('');
  const current = useRef(data);
  const persisted = useRef(data);
  const revision = useRef(initial.revision);
  const inFlight = useRef(false);
  const blocked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  // Keep the save/reload guard in sync immediately, including before React renders.
  const setData = useCallback((action: SetStateAction<Workspace>) => {
    const next = typeof action === 'function' ? action(current.current) : action;
    current.current = next;
    setDataState(next);
  }, []);
  const flush = useCallback(async () => {
    if (blocked.current || inFlight.current || current.current === persisted.current) return;
    inFlight.current = true;
    setStatus('saving');
    try {
      // Drain edits made while an earlier revision is being written. Only one save
      // is in flight, and each subsequent request uses the revision just returned.
      while (current.current !== persisted.current && alive.current) {
        const snapshot = current.current;
        const result = await saveWorkspace(snapshot, revision.current);
        revision.current = result.revision;
        if (current.current === snapshot) {
          // Server assigns authorship and may normalize fields. Adopt the acknowledged
          // snapshot only when no newer local edit exists.
          const acknowledged = reconcileSnapshot(snapshot, result.data);
          current.current = acknowledged;
          persisted.current = acknowledged;
          if (alive.current && acknowledged !== snapshot) setDataState(acknowledged);
        } else {
          const latest = rebaseSnapshot(snapshot, current.current, result.data);
          current.current = latest;
          persisted.current = result.data;
          if (alive.current) setDataState(latest);
        }
      }
      setError('');
      if (alive.current) setStatus('saved');
    } catch (e) {
      const issue = e as Error & { status?: number };
      blocked.current = issue.status === 409;
      setError(issue.message);
      if (alive.current) setStatus(blocked.current ? 'conflict' : 'error');
    } finally {
      inFlight.current = false;
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (data === persisted.current) return;
    if (!blocked.current) setStatus('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 650);
    return () => clearTimeout(timer.current);
  }, [data, flush]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (current.current !== persisted.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
  const replaceSaved = (envelope: WorkspaceEnvelope) => {
    revision.current = envelope.revision;
    persisted.current = envelope.data;
    current.current = envelope.data;
    blocked.current = false;
    setData(envelope.data);
    setStatus('saved');
    setError('');
  };
  const reloadWhenSaved = (editorDirty: boolean) => {
    if (
      editorDirty ||
      status !== 'saved' ||
      current.current !== persisted.current ||
      inFlight.current ||
      blocked.current
    )
      return false;
    window.location.reload();
    return true;
  };
  return { data, setData, status, error, retry: flush, replaceSaved, revision, reloadWhenSaved };
}
