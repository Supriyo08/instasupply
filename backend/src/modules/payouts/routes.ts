/**
 * Ledger and payouts (docs/PLATFORM.md §5.3.8): `GET /ledger-entries`, `GET /ledger/balance`, `GET /payouts`,
 * `GET /payouts/{payoutId}`. Staff read every payee; the owner of a store reads the store's; a driver reads
 * their own (§7.3 `canReadPayee`). Store staff (not owners) are denied.
 */
import type { LedgerBalance, LedgerEntry, Page, Payout, WithId } from '@instasupply/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../../platform/auth/policies';
import { invalidArgument, notFound, permissionDenied } from '../../platform/http/errors';
import { decodeCursor, pageQuerySchema, readPage } from '../../platform/http/pagination';
import { defineRoute, idParam } from '../../platform/http/route';
import { canReadPayee, resolvePayeeScope } from './access';
import {
  findPayout,
  ledgerBalance,
  ledgerCursorKey,
  listLedgerEntries,
  listPayouts,
  payoutCursorKey,
  toLedgerEntry,
  toPayout,
} from './repository';

const payeeType = z.enum(['store', 'driver']);
const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

const LedgerQuerySchema = pageQuerySchema
  .extend({
    payeeType: payeeType.optional(),
    payeeId: idParam.optional(),
    unpaid: flag.optional(),
    held: flag.optional(),
    payoutId: idParam.optional(),
    sort: z.enum(['createdAt:desc']).optional(),
  })
  .strict();

const BalanceQuerySchema = z
  .object({ payeeType: payeeType.optional(), payeeId: idParam.optional() })
  .strict();

const PayoutQuerySchema = pageQuerySchema
  .extend({
    payeeType: payeeType.optional(),
    payeeId: idParam.optional(),
    status: z.enum(['pending', 'paid', 'failed']).optional(),
    runKey: z
      .string()
      .regex(/^[0-9]{8}-[0-9]{4}$/)
      .optional(),
    sort: z.enum(['createdAt:desc']).optional(),
  })
  .strict();

/** A keyset cursor whose sort value is an instant. */
function timeCursor(cursor: string | undefined): [number, string] | null {
  if (cursor === undefined) return null;
  const [value, id] = decodeCursor(cursor);
  if (typeof value !== 'number') invalidArgument('That page cursor is not valid. Reload the list.');
  return [value, id];
}

export function registerPayoutRoutes(app: FastifyInstance): void {
  defineRoute(app, {
    method: 'GET',
    url: '/ledger-entries',
    policy: requireAuth,
    query: LedgerQuerySchema,
    handler: async (ctx, { query }, actor): Promise<Page<WithId<LedgerEntry>>> => {
      const scope = resolvePayeeScope(actor!, query);
      const rows = await listLedgerEntries(
        ctx.deps.pool,
        {
          payeeType: scope.payeeType,
          payeeId: scope.payeeId,
          unpaid: query.unpaid === true,
          held: query.held === true,
          payoutId: query.payoutId ?? null,
        },
        timeCursor(query.cursor),
        query.limit,
      );
      return readPage(rows, query.limit, toLedgerEntry, ledgerCursorKey);
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/ledger/balance',
    policy: requireAuth,
    query: BalanceQuerySchema,
    handler: async (ctx, { query }, actor): Promise<LedgerBalance> => {
      const { payeeType, payeeId } = resolvePayeeScope(actor!, query);
      if (payeeType === null || payeeId === null) {
        invalidArgument('Name the payee: payeeType and payeeId.', {
          fields: { payeeType: 'required', payeeId: 'required' },
        });
      }
      const row = await ledgerBalance(ctx.deps.pool, payeeType, payeeId);
      return {
        payeeType,
        payeeId,
        unpaidCents: row.unpaid_cents,
        unpaidCount: row.unpaid_count,
        heldCents: row.held_cents,
        heldCount: row.held_count,
        lastPaidAt: row.last_paid_at,
      };
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/payouts',
    policy: requireAuth,
    query: PayoutQuerySchema,
    handler: async (ctx, { query }, actor): Promise<Page<WithId<Payout>>> => {
      const scope = resolvePayeeScope(actor!, query);
      const rows = await listPayouts(
        ctx.deps.pool,
        {
          payeeType: scope.payeeType,
          payeeId: scope.payeeId,
          status: query.status ?? null,
          runKey: query.runKey ?? null,
        },
        timeCursor(query.cursor),
        query.limit,
      );
      return readPage(rows, query.limit, toPayout, payoutCursorKey);
    },
  });

  defineRoute(app, {
    method: 'GET',
    url: '/payouts/:payoutId',
    policy: requireAuth,
    params: z.object({ payoutId: idParam }),
    handler: async (ctx, { params }, actor): Promise<WithId<Payout>> => {
      const payout = await findPayout(ctx.deps.pool, params.payoutId);
      if (!payout) notFound('That payout does not exist.');
      if (!canReadPayee(actor!, payout.payeeType, payout.payeeId)) permissionDenied();
      return payout;
    },
  });
}
