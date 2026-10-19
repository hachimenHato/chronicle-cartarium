/** A preview can become a new parent only after its own dwell lock has completed. */
export interface TooltipEntry {
  id: string;
  entityId: string;
  parentId?: string;
  anchor: { left: number; top: number; right: number; bottom: number };
  locked: boolean;
}

export type TooltipAction =
  | { type: 'show'; entry: TooltipEntry }
  | { type: 'lock'; id: string }
  | { type: 'leave'; id: string }
  | { type: 'clear' };

export const TOOLTIP_SHOW_MS = 1000;
export const TOOLTIP_LOCK_MS = 2700;

export function tooltipReducer(entries: TooltipEntry[], action: TooltipAction): TooltipEntry[] {
  if (action.type === 'clear') return entries.length ? [] : entries;
  if (action.type === 'show') {
    const { entry } = action;
    if (entries.some((item) => item.id === entry.id)) return entries;
    if (entry.parentId) {
      let parent = entries.find((item) => item.id === entry.parentId);
      if (!parent?.locked) return entries;
      // Cyclic Wiki references are useful, but must not create an endless stack of the same card.
      while (parent) {
        if (parent.entityId === entry.entityId) return entries;
        parent = entries.find((item) => item.id === parent?.parentId);
      }
    }
    return [...entries, entry];
  }
  const target = entries.find((item) => item.id === action.id);
  if (!target) return entries;
  if (action.type === 'lock') {
    return target.locked
      ? entries
      : entries.map((item) => (item.id === target.id ? { ...item, locked: true } : item));
  }
  if (target.locked) return entries;
  const removed = new Set([target.id]);
  // Entries are inserted parent-first, so removing a parent also removes its whole branch.
  return entries.filter((item) => {
    if (item.parentId && removed.has(item.parentId)) removed.add(item.id);
    return !removed.has(item.id);
  });
}

export function tooltipPosition(
  anchor: TooltipEntry['anchor'],
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  nested: boolean,
) {
  const gap = 10;
  const maxX = Math.max(gap, viewport.width - card.width - gap);
  const maxY = Math.max(gap, viewport.height - card.height - gap);
  let left = nested ? anchor.right + gap : anchor.left;
  let top = nested ? anchor.top : anchor.bottom + gap;
  if (nested && left > maxX) left = anchor.left - card.width - gap;
  if (!nested && top > maxY) top = anchor.top - card.height - gap;
  return {
    left: Math.min(Math.max(left, gap), maxX),
    top: Math.min(Math.max(top, gap), maxY),
  };
}
