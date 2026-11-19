/** purgeExpiredRows, every hour (docs/PLATFORM.md §9.5): the successor of the Firestore TTL policies. */
import type { Deps } from '../../container';
import { deleteFileRow, pendingFilesOlderThan } from '../../platform/storage/files.repository';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export async function purgeExpiredRows(deps: Deps, now: number): Promise<Record<string, number>> {
  const at = (ms: number) => new Date(now - ms);
  const run = async (sql: string, values: unknown[]): Promise<number> =>
    (await deps.pool.query(sql, values)).rowCount ?? 0;
  const result: Record<string, number> = {
    rateLimits: await run('DELETE FROM rate_limits WHERE expires_at <= $1', [at(0)]),
    geocodeCache: await run('DELETE FROM geocode_cache WHERE expires_at <= $1', [at(0)]),
    devOutbox: await run('DELETE FROM dev_outbox WHERE expires_at <= $1', [at(0)]),
    otpChallenges: await run('DELETE FROM otp_challenges WHERE expires_at <= $1', [at(DAY)]),
    authTokens: await run(
      'DELETE FROM auth_tokens WHERE (used_at IS NOT NULL AND used_at <= $1) OR expires_at <= $1',
      [at(7 * DAY)],
    ),
    // Refresh tokens go with their session (cascade); those of a live session are never deleted (§6.3.5).
    sessions: await run(
      `DELETE FROM sessions WHERE (revoked_at IS NOT NULL AND revoked_at <= $1) OR (revoked_at IS NULL AND expires_at <= $1)`,
      [at(30 * DAY)],
    ),
    outboxDone: await run(`DELETE FROM outbox WHERE status = 'done' AND finished_at <= $1`, [at(7 * DAY)]),
    outboxDead: await run(`DELETE FROM outbox WHERE status = 'dead' AND finished_at <= $1`, [at(30 * DAY)]),
    pushTickets: await run('DELETE FROM push_tickets WHERE created_at <= $1', [at(DAY)]),
    pendingFiles: 0,
  };
  // The stored object first, then the row, so a crash in between leaves a row the next run retries.
  for (;;) {
    const rows = await pendingFilesOlderThan(deps.pool, now - DAY, 200);
    if (rows.length === 0) break;
    for (const row of rows) {
      await deps.storage.delete(row.upload_key).catch(() => {});
      await deps.storage.delete(row.path).catch(() => {});
      await deleteFileRow(deps.pool, row.id);
      result.pendingFiles! += 1;
    }
    if (rows.length < 200) break;
  }
  return result;
}
