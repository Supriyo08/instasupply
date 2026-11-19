import { seg, writeThen, type ResourceContext } from './context';

export const notificationPaths = {
  notifications: '/notifications',
  unreadCount: '/notifications/unread-count',
  notification: (id: string) => `/notifications/${seg(id)}`,
  read: (id: string) => `/notifications/${seg(id)}/read`,
  readAll: '/notifications/read-all',
} as const;

export function createNotifications(ctx: ResourceContext) {
  return {
    markRead: (id: string) => writeThen(ctx, [['notifications']], () => ctx.rest.post(notificationPaths.read(id))),
    markAllRead: () => writeThen(ctx, [['notifications']], () => ctx.rest.post(notificationPaths.readAll)),
    remove: (id: string) =>
      writeThen(ctx, [['notifications']], () => ctx.rest.delete(notificationPaths.notification(id))),
  };
}
