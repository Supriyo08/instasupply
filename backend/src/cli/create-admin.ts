/**
 * `create-admin --email <e> --name <n>` (docs/PLATFORM.md §2.6, §6.3.8 without an inviter): creates the
 * admin when the email is free and prints a fresh one-time set-password link, to standard output only.
 */
import { isValidEmail } from '@instasupply/shared';
import type { Config } from '../config/env';
import { createDeps } from '../container';
import { withTransaction } from '../platform/db/tx';
import { ApiError } from '../platform/http/errors';
import { inviteUser } from '../modules/auth/account.service';
import { option } from './args';

export async function runCreateAdmin(config: Config, args: string[]): Promise<number> {
  const email = option(args, 'email')?.trim().toLowerCase() ?? '';
  const name = option(args, 'name')?.trim().replace(/\s+/g, ' ') ?? '';
  if (!isValidEmail(email) || name.length < 1 || name.length > 80) {
    console.error('usage: create-admin --email <email> --name "<name, 1 to 80 characters>"');
    return 1;
  }
  const deps = createDeps(config);
  try {
    const { rows } = await deps.pool.query<{ role: string | null; password_hash: string | null }>(
      'SELECT role, password_hash FROM users WHERE lower(email) = $1',
      [email],
    );
    const existing = rows[0];
    if (existing && existing.role !== 'admin') {
      console.error('That email belongs to an account that is not an administrator.');
      return 1;
    }
    const link = await withTransaction(deps, async (tx) => {
      if (existing && existing.password_hash !== null) {
        // An existing admin with a password: a fresh link lets them set a new one (a recovery path).
        const { rows: ids } = await tx.query<{ id: string }>(
          'SELECT id FROM users WHERE lower(email) = $1 FOR NO KEY UPDATE',
          [email],
        );
        await tx.query('UPDATE users SET password_hash = NULL WHERE id = $1', [ids[0]!.id]);
      }
      return inviteUser(tx, config, {
        email,
        displayName: name,
        role: 'admin',
        invitedBy: null,
        doc: { preferences: { chatPush: true, deliveryPush: true } },
      });
    });
    console.info(`Administrator ${email} (${link.uid}).`);
    console.info(`One-time set-password link, valid ${config.INVITE_LINK_TTL_HOURS} hours:`);
    console.info(link.passwordSetupLink);
    return 0;
  } catch (error) {
    console.error(error instanceof ApiError ? error.message : error);
    return 1;
  } finally {
    await deps.pool.end();
  }
}
