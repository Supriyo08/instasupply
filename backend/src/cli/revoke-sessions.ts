/** `revoke-sessions --email <e>` (docs/PLATFORM.md §6.3.6): every session of one account, reason `admin`. */
import type { Config } from '../config/env';
import { createDeps } from '../container';
import { withTransaction } from '../platform/db/tx';
import { revokeUserSessions } from '../modules/auth/sessions-admin';
import { option } from './args';

export async function runRevokeSessions(config: Config, args: string[]): Promise<number> {
  const email = option(args, 'email')?.trim().toLowerCase();
  if (!email) {
    console.error('usage: revoke-sessions --email <email>');
    return 1;
  }
  const deps = createDeps(config);
  try {
    const count = await withTransaction(deps, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        'SELECT id FROM users WHERE lower(email) = $1 FOR NO KEY UPDATE',
        [email],
      );
      if (!rows[0]) return null;
      return revokeUserSessions(tx, rows[0].id);
    });
    if (count === null) {
      console.error('No account has that email.');
      return 1;
    }
    console.info(`Revoked ${count} session${count === 1 ? '' : 's'}.`);
    return 0;
  } finally {
    await deps.pool.end();
  }
}
