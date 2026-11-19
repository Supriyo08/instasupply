/** The `push.send` outbox handler (docs/PLATFORM.md §10.2). */
import type { NotificationType, Role, UserPreferences } from '@instasupply/shared';
import { registerHandler } from '../outbox/registry';
import { channelFor, pushAllowed } from './channels';
import type { ExpoMessage } from './expo';

const RECEIPT_DELAY_MS = 15 * 60_000;

interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string>;
  push_status: string;
  role: Role | null;
  doc: { preferences?: UserPreferences };
}

interface DeviceRow {
  token: string;
  app: string;
}

export function registerPushHandler(): void {
  registerHandler<{ notificationId: string }>('push.send', async ({ notificationId }, { deps }) => {
    const { pool, config, push, clock } = deps;
    const { rows } = await pool.query<NotificationRow>(
      `SELECT n.id, n.user_id, n.type, n.title, n.body, n.data, n.push_status, u.role, u.doc
         FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.id = $1`,
      [notificationId],
    );
    const notification = rows[0];
    // Stop unless pending: an earlier run already finished (the handler may run twice).
    if (!notification || notification.push_status !== 'pending') return;

    const finish = async (status: string, success = 0, failure = 0) => {
      await pool.query(
        `UPDATE notifications SET push_status = $2, push_success = $3, push_failure = $4, push_sent_at = $5
          WHERE id = $1 AND push_status = 'pending'`,
        [notificationId, status, success, failure, new Date(clock.now())],
      );
    };

    if (!pushAllowed(notification.type, notification.role, notification.doc.preferences))
      return finish('skipped');
    const { rows: devices } = await pool.query<DeviceRow>(
      `SELECT token, app FROM devices WHERE user_id = $1 AND provider = 'expo' ORDER BY installation_id`,
      [notification.user_id],
    );
    if (devices.length === 0) return finish('no_devices');
    if (!config.PUSH_ENABLED) return finish('skipped');

    // One request never mixes Expo projects: the customer and driver apps are different projects.
    const byApp = new Map<string, DeviceRow[]>();
    for (const device of devices) byApp.set(device.app, [...(byApp.get(device.app) ?? []), device]);

    let success = 0;
    let failure = 0;
    for (const group of byApp.values()) {
      for (let start = 0; start < group.length; start += 100) {
        const chunk = group.slice(start, start + 100);
        const messages: ExpoMessage[] = chunk.map((device) => ({
          to: device.token,
          title: notification.title,
          body: notification.body,
          sound: 'default',
          priority: 'high',
          channelId: channelFor(notification.type),
          // The app ignores a tap on a push meant for another account on the same phone.
          data: {
            ...notification.data,
            notificationId,
            type: notification.type,
            userId: notification.user_id,
          },
        }));
        const tickets = await push.send(messages);
        for (const [index, device] of chunk.entries()) {
          const ticket = tickets[index];
          if (ticket?.status === 'ok') {
            success += 1;
            await pool.query(
              `INSERT INTO push_tickets (ticket_id, notification_id, user_id, token, created_at, check_after)
               VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (ticket_id) DO NOTHING`,
              [
                ticket.id,
                notificationId,
                notification.user_id,
                device.token,
                new Date(clock.now()),
                new Date(clock.now() + RECEIPT_DELAY_MS),
              ],
            );
          } else {
            failure += 1;
            if (ticket?.details?.error === 'DeviceNotRegistered') {
              await pool.query('DELETE FROM devices WHERE token = $1', [device.token]);
            }
          }
        }
      }
    }
    await finish(failure === 0 ? 'sent' : success === 0 ? 'failed' : 'partial', success, failure);
  });
}
