/**
 * Push devices (docs/PLATFORM.md §3.3, §5.3.3, §9.4 `onDeviceWritten`): one row per app install and account.
 * A push token belongs to the account that registered it last, so registering deletes every other row with
 * that token in the same transaction. `devices` is write-only for clients: only a count is ever exposed.
 */
import type { DevicePlatform } from '@instasupply/shared';
import type { Queryable, Tx } from '../../platform/db/tx';

export interface DeviceWrite {
  userId: string;
  installationId: string;
  token: string;
  platform: DevicePlatform;
  app: 'customer' | 'driver' | 'console';
  appVersion: string | null;
  deviceName: string | null;
}

/** The installation and app of the caller's session (the device row copies them, never the request). */
export async function sessionInstall(
  db: Queryable,
  sessionId: string,
): Promise<{ installation_id: string; app: DeviceWrite['app'] } | null> {
  const { rows } = await db.query<{ installation_id: string; app: DeviceWrite['app'] }>(
    `SELECT installation_id, app FROM sessions WHERE id = $1`,
    [sessionId],
  );
  return rows[0] ?? null;
}

/** Takes the token away from every other row, then upserts this install's row (rank 15, single rows). */
export async function upsertDevice(tx: Tx, device: DeviceWrite): Promise<void> {
  await tx.query(`DELETE FROM devices WHERE token = $3 AND NOT (user_id = $1 AND installation_id = $2)`, [
    device.userId,
    device.installationId,
    device.token,
  ]);
  await tx.query(
    `INSERT INTO devices (user_id, installation_id, token, provider, platform, app, app_version, device_name,
                          created_at, last_seen_at)
     VALUES ($1, $2, $3, 'expo', $4, $5, $6, $7, $8, $8)
     ON CONFLICT (user_id, installation_id) DO UPDATE SET
       token = EXCLUDED.token, provider = EXCLUDED.provider, platform = EXCLUDED.platform, app = EXCLUDED.app,
       app_version = EXCLUDED.app_version, device_name = EXCLUDED.device_name, last_seen_at = EXCLUDED.last_seen_at`,
    [
      device.userId,
      device.installationId,
      device.token,
      device.platform,
      device.app,
      device.appVersion,
      device.deviceName,
      new Date(tx.now),
    ],
  );
}

export async function deleteDevice(tx: Tx, userId: string, installationId: string): Promise<void> {
  await tx.query(`DELETE FROM devices WHERE user_id = $1 AND installation_id = $2`, [userId, installationId]);
}
