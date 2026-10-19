/** Preserve unchanged object identities when acknowledging a JSON snapshot.
 * Key order and omitted optional undefined properties do not change domain values. */
export function reconcileSnapshot<T>(previous: T, incoming: T): T {
  if (Object.is(previous, incoming)) return previous;
  if (!previous || !incoming || typeof previous !== 'object' || typeof incoming !== 'object')
    return incoming;
  if (Array.isArray(previous) || Array.isArray(incoming)) {
    if (!Array.isArray(previous) || !Array.isArray(incoming)) return incoming;
    const values = incoming.map((value, index) => reconcileSnapshot(previous[index], value));
    return (
      previous.length === values.length && values.every((value, index) => value === previous[index])
        ? previous
        : values
    ) as T;
  }
  const old = previous as Record<string, unknown>,
    next = incoming as Record<string, unknown>;
  const oldKeys = Object.keys(old).filter((key) => old[key] !== undefined);
  const keys = Object.keys(next).filter((key) => next[key] !== undefined);
  let same = oldKeys.length === keys.length;
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const value = reconcileSnapshot(old[key], next[key]);
    if (key === '__proto__')
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    else result[key] = value;
    if (!Object.hasOwn(old, key) || value !== old[key]) same = false;
  }
  return (same ? previous : result) as T;
}
export class SnapshotRebaseConflict extends Error {
  readonly status = 409;
  constructor() {
    super('保存期间，同一字段的关联内容也发生了变化。本地修改已保留，请核对后重新加载。');
  }
}
/** Apply server repairs without replacing edits made while a save was in flight. */
export function rebaseSnapshot<T>(base: T, local: T, server: T): T {
  if (reconcileSnapshot(base, local) === base) return reconcileSnapshot(local, server);
  if (reconcileSnapshot(base, server) === base) return local;
  if (reconcileSnapshot(local, server) === local) return local;
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(server)) {
    const sample: unknown = [...base, ...local, ...server].find((value) => value !== undefined);
    if (
      sample === null ||
      sample === undefined ||
      typeof sample !== 'object' ||
      !('id' in sample) ||
      typeof sample.id !== 'string'
    )
      throw new SnapshotRebaseConflict();
    const oldById = new Map(base.map((item) => [item.id, item]));
    const serverById = new Map(server.map((item) => [item.id, item]));
    const localIds = new Set(local.map((item) => item.id));
    const merged = local
      .map((item) => rebaseSnapshot(oldById.get(item.id), item, serverById.get(item.id)))
      .filter((item) => item !== undefined);
    merged.push(...server.filter((item) => !oldById.has(item.id) && !localIds.has(item.id)));
    return reconcileSnapshot(local, merged as T);
  }
  if (
    base &&
    local &&
    server &&
    typeof base === 'object' &&
    typeof local === 'object' &&
    typeof server === 'object' &&
    !Array.isArray(base) &&
    !Array.isArray(local) &&
    !Array.isArray(server)
  ) {
    const old = base as Record<string, unknown>,
      draft = local as Record<string, unknown>,
      saved = server as Record<string, unknown>;
    const merged = Object.fromEntries(
      [...new Set([...Object.keys(old), ...Object.keys(draft), ...Object.keys(saved)])]
        .map((key) => [key, rebaseSnapshot(old[key], draft[key], saved[key])])
        .filter(([, value]) => value !== undefined),
    );
    return reconcileSnapshot(local, merged as T);
  }
  throw new SnapshotRebaseConflict();
}
