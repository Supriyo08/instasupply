/**
 * When the Dispatch tab may call `markRead`. A failed call rolls its optimistic patch back, which brings
 * the same unread count back; without a gate the effect would fire again at once and loop while the
 * request keeps failing (offline, a server error). So each server state of the thread (its unread count
 * and `updatedAt`) is tried once. A new message (a new `updatedAt`), leaving and re-entering the tab, or
 * the app coming back to the foreground (`reset`) allows the next try.
 */
export interface MarkReadGate {
  /** True when this thread state should be marked read now; records the attempt. */
  shouldMark(input: { visible: boolean; unread: number; updatedAt: number | null }): boolean;
}

export function createMarkReadGate(): MarkReadGate {
  let tried: string | null = null;
  return {
    shouldMark({ visible, unread, updatedAt }) {
      if (!visible) {
        tried = null;
        return false;
      }
      if (unread <= 0) return false;
      const key = `${unread}:${updatedAt ?? ''}`;
      if (key === tried) return false;
      tried = key;
      return true;
    },
  };
}
