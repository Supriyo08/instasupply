/** checkPushReceipts, every 15 minutes (docs/PLATFORM.md §10.2). */
import type { Deps } from '../../container';
import { registerJob } from '../scheduler/registry';

const CONFIG_ERRORS = new Set([
  'MessageTooBig',
  'MessageRateExceeded',
  'MismatchSenderId',
  'InvalidCredentials',
]);
const DAY_MS = 86_400_000;

export async function checkPushReceipts(deps: Deps, now: number): Promise<Record<string, number>> {
  const result = { checked: 0, removedDevices: 0, errors: 0, expired: 0 };
  const expired = await deps.pool.query('DELETE FROM push_tickets WHERE created_at < $1', [
    new Date(now - DAY_MS),
  ]);
  result.expired = expired.rowCount ?? 0;
  if (!deps.config.PUSH_ENABLED) return result;
  for (;;) {
    const { rows } = await deps.pool.query<{ ticket_id: string; token: string }>(
      'SELECT ticket_id, token FROM push_tickets WHERE check_after <= $1 ORDER BY check_after LIMIT 1000',
      [new Date(now)],
    );
    if (rows.length === 0) break;
    const receipts = await deps.push.getReceipts(rows.map((row) => row.ticket_id));
    for (const row of rows) {
      const receipt = receipts[row.ticket_id];
      if (receipt?.status === 'error') {
        const code = receipt.details?.error;
        if (code === 'DeviceNotRegistered') {
          const removed = await deps.pool.query('DELETE FROM devices WHERE token = $1', [row.token]);
          result.removedDevices += removed.rowCount ?? 0;
        } else if (code && CONFIG_ERRORS.has(code)) {
          result.errors += 1;
          deps.log.error({ receipt: code }, 'push receipt reports a configuration problem');
        }
      }
    }
    // A ticket without a receipt yet stays until the next run (or the 24-hour expiry above).
    const processed = rows.filter((row) => receipts[row.ticket_id] !== undefined).map((row) => row.ticket_id);
    await deps.pool.query('DELETE FROM push_tickets WHERE ticket_id = ANY($1::text[])', [processed]);
    result.checked += processed.length;
    if (rows.length < 1000 || processed.length === 0) break;
  }
  return result;
}

export function registerPushReceiptsJob(): void {
  registerJob({ name: 'checkPushReceipts', schedule: { everyMs: 15 * 60_000 }, run: checkPushReceipts });
}
