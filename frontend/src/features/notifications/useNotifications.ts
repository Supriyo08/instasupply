import { useApiMutation, useLiveQuery } from '@instasupply/api-client/react';
import type { AppNotification } from '@instasupply/shared';
import { useCallback, useMemo } from 'react';

import { queries } from '@/lib/api';

/**
 * The signed-in user's inbox (newest 50), live over `user:{uid}:notifications`. "Mark read" and
 * "Mark all read" are optimistic (CLIENTS §1.12): the dot disappears at once and comes back only if
 * the server refuses.
 */
export function useNotifications(uid: string | null | undefined) {
  const query = queries.notifications(uid);
  const state = useLiveQuery(query);
  const key = query.key;

  const markReadMutation = useApiMutation((api, id: string) => api.notifications.markRead(id), {
    optimistic: (cache, id) =>
      cache.patch<AppNotification[]>(key, (list) =>
        list.map((item) => (item.id === id ? { ...item, read: true } : item)),
      ),
  });
  const markAllMutation = useApiMutation((api) => api.notifications.markAllRead(), {
    optimistic: (cache) =>
      cache.patch<AppNotification[]>(key, (list) => list.map((item) => ({ ...item, read: true }))),
  });

  const { run: runMarkRead } = markReadMutation;
  const { run: runMarkAll } = markAllMutation;
  // Failures roll the optimistic patch back; nothing else to tell the user for a read flag.
  const markRead = useCallback(
    (id: string) =>
      runMarkRead(id).then(
        () => undefined,
        () => undefined,
      ),
    [runMarkRead],
  );
  const markAllRead = useCallback(
    () =>
      runMarkAll().then(
        () => undefined,
        () => undefined,
      ),
    [runMarkAll],
  );

  const unreadCount = useMemo(() => state.data.filter((item) => !item.read).length, [state.data]);
  return { ...state, unreadCount, markRead, markAllRead };
}
