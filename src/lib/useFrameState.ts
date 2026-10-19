import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

/** Pointer samples live in gesture refs; preview state needs at most one update per frame. */
export function useFrameState<T>(initial: T) {
  const [value, setValue] = useState(initial);
  const pending = useRef(initial);
  const frame = useRef<number | undefined>(undefined);
  const set = useCallback((action: SetStateAction<T>) => {
    // Compose every input sample against the latest queued value. In particular,
    // several wheel events in one animation frame must all contribute to zoom.
    const next =
      typeof action === 'function' ? (action as (previous: T) => T)(pending.current) : action;
    if (Object.is(next, pending.current)) return;
    pending.current = next;
    if (next == null) {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      setValue(next);
    } else if (frame.current === undefined) {
      frame.current = requestAnimationFrame(() => {
        frame.current = undefined;
        setValue(pending.current);
      });
    }
  }, []);
  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
    },
    [],
  );
  // A second gesture may start before React renders the previous final sample.
  const latest = useCallback(() => pending.current, []);
  return [value, set, latest] as const;
}
