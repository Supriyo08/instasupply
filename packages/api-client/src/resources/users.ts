import type { UserProfile } from '@instasupply/shared';

import type { PayoutAccountPatch, UserStatusPatch } from '../contract';

import { seg, writeThen, type ResourceContext } from './context';

export const userPaths = {
  users: '/users',
  user: (uid: string) => `/users/${seg(uid)}`,
  sessions: (uid: string) => `/users/${seg(uid)}/sessions`,
  revokeSessions: (uid: string) => `/users/${seg(uid)}/sessions/revoke-all`,
  payoutAccount: (uid: string) => `/users/${seg(uid)}/payout-account`,
  status: (uid: string) => `/users/${seg(uid)}/status`,
  ownSessions: '/auth/sessions',
  ownSession: (sessionId: string) => `/auth/sessions/${seg(sessionId)}`,
} as const;

export function createUsers(ctx: ResourceContext) {
  return {
    /** Admin: a driver's payout account, or null to remove it. */
    setPayoutAccount: (uid: string, payoutAccount: PayoutAccountPatch['payoutAccount']) =>
      writeThen(ctx, [['user', uid], ['users']], () =>
        ctx.rest.patch<UserProfile>(userPaths.payoutAccount(uid), { payoutAccount }),
      ),
    /** Admin: admins, dispatchers and customers (drivers and supplier users have their own commands). */
    setStatus: (uid: string, patch: UserStatusPatch) =>
      writeThen(ctx, [['user', uid], ['users']], () => ctx.rest.patch<UserProfile>(userPaths.status(uid), patch)),
    /** Admin: signs that account out everywhere; the account stays usable. */
    revokeSessions: (uid: string) =>
      writeThen(ctx, [['user-sessions', uid]], () => ctx.rest.post(userPaths.revokeSessions(uid))),
  };
}
