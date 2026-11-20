/**
 * registerCustomer (docs/PLATFORM.md §6.3.2; port of legacy commerce/register-customer.ts): a role-less account
 * becomes an active customer. Safe to repeat: an existing customer only gets the new name. The next request
 * sees the role; there is no claim to set and no token to refresh.
 */
import type { RegisterCustomerRequest, RegisterCustomerResponse } from '@instasupply/shared';
import type { Deps } from '../../container';
import type { Actor } from '../../platform/auth/actor';
import { withTransaction } from '../../platform/db/tx';
import { failedPrecondition } from '../../platform/http/errors';
import { lockCustomer, makeCustomer, renameCustomer } from './orders.repository';

const OTHER_ACCOUNT =
  'This email belongs to a staff, supplier or driver account. Use another email to order.';

export async function registerCustomer(
  deps: Deps,
  actor: Actor,
  req: RegisterCustomerRequest,
): Promise<RegisterCustomerResponse> {
  if (actor.role !== null && actor.role !== 'customer') failedPrecondition(OTHER_ACCOUNT);
  return withTransaction(deps, async (tx) => {
    const user = await lockCustomer(tx, actor.uid);
    if (!user) failedPrecondition('That account no longer exists.');
    if (user.role !== null && user.role !== 'customer') failedPrecondition(OTHER_ACCOUNT);
    if (user.role === 'customer') {
      if (user.displayName !== req.displayName) await renameCustomer(tx, user.id, req.displayName);
      return {
        status: user.status === 'suspended' ? 'suspended' : user.status === 'pending' ? 'pending' : 'active',
      };
    }
    await makeCustomer(tx, user.id, req.displayName, {
      companyName: req.companyName ?? null,
      accountType: req.accountType ?? null,
      stats: { nonCancelledOrders: 0, completedOrders: 0, lastOrderAt: null },
      promoUses: {},
      preferences: { orderPush: true, chatPush: true, promoPush: req.marketingOptIn === true },
    });
    return { status: 'active' };
  });
}
