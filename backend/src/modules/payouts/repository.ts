/**
 * Every SQL statement of the payouts module (docs/PLATFORM.md §2.1): `ledger_entries` and `payouts`, plus the
 * few reads of other tables the ledger needs (the store orders of an order, an open issue, the payee's name
 * and payout account). Both tables have only typed columns (§3.1 rule 5); the serializers build
 * `WithId<LedgerEntry>` and `WithId<Payout>` (§3.3).
 */
import type { FaultParty, LedgerEntry, LedgerKind, Payout, StoreOrder, WithId } from '@instasupply/shared';
import type { Queryable, Tx } from '../../platform/db/tx';
import { publishChange } from '../../platform/live/publish';

type Db = Queryable | Tx;

/** Runs a query on a pool, a client or a transaction with one result shape. */
async function rowsOf<R>(db: Db, text: string, values: unknown[]): Promise<R[]> {
  const result = await (db as Tx).query<R>(text, values);
  return result.rows;
}

// ---------- ledger entries ----------

interface LedgerRow {
  id: string;
  payee_type: 'store' | 'driver';
  payee_id: string;
  kind: LedgerKind;
  amount_cents: number;
  order_id: string | null;
  store_order_id: string | null;
  delivery_id: string | null;
  issue_id: string | null;
  description: string;
  payout_id: string | null;
  held_for_issue_id: string | null;
  created_at: number;
}

const LEDGER_COLUMNS = `id, payee_type, payee_id, kind, amount_cents, order_id, store_order_id, delivery_id, issue_id,
  description, payout_id, held_for_issue_id, created_at`;

export const toLedgerEntry = (row: LedgerRow): WithId<LedgerEntry> => ({
  id: row.id,
  payeeType: row.payee_type,
  payeeId: row.payee_id,
  kind: row.kind,
  amountCents: row.amount_cents,
  orderId: row.order_id,
  storeOrderId: row.store_order_id,
  deliveryId: row.delivery_id,
  issueId: row.issue_id,
  description: row.description,
  payoutId: row.payout_id,
  heldForIssueId: row.held_for_issue_id,
  createdAt: row.created_at,
});

/** Statement (g) of §3.5: create once. Answers whether the row was new; publishes it on the payee's topic. */
export async function insertLedgerEntry(tx: Tx, entry: WithId<LedgerEntry>): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO ledger_entries (id, payee_type, payee_id, kind, amount_cents, order_id, store_order_id, delivery_id,
                                 issue_id, description, held_for_issue_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [
      entry.id,
      entry.payeeType,
      entry.payeeId,
      entry.kind,
      entry.amountCents,
      entry.orderId,
      entry.storeOrderId,
      entry.deliveryId,
      entry.issueId,
      entry.description,
      entry.heldForIssueId,
      new Date(entry.createdAt),
    ],
  );
  if (rows.length === 0) return false;
  await publishChange(tx, 'ledger_entries', 'created', {
    id: entry.id,
    payeeType: entry.payeeType,
    payeeId: entry.payeeId,
  });
  return true;
}

export interface LedgerFilter {
  payeeType: 'store' | 'driver' | null;
  payeeId: string | null;
  unpaid: boolean;
  held: boolean;
  payoutId: string | null;
}

/** GET /ledger-entries: newest first, keyset on (created_at, id) (index 31). */
export async function listLedgerEntries(
  db: Queryable,
  filter: LedgerFilter,
  after: [number, string] | null,
  limit: number,
): Promise<LedgerRow[]> {
  return rowsOf<LedgerRow>(
    db,
    `SELECT ${LEDGER_COLUMNS} FROM ledger_entries
      WHERE ($1::text IS NULL OR payee_type = $1)
        AND ($2::text IS NULL OR payee_id = $2)
        AND (NOT $3::boolean OR payout_id IS NULL)
        AND (NOT $4::boolean OR held_for_issue_id IS NOT NULL)
        AND ($5::text IS NULL OR payout_id = $5)
        AND ($6::timestamptz IS NULL OR (created_at, id) < ($6::timestamptz, $7::text))
      ORDER BY created_at DESC, id DESC
      LIMIT $8`,
    [
      filter.payeeType,
      filter.payeeId,
      filter.unpaid,
      filter.held,
      filter.payoutId,
      after ? new Date(after[0]) : null,
      after ? after[1] : null,
      limit + 1,
    ],
  );
}

export const ledgerCursorKey = (row: LedgerRow): [number, string] => [row.created_at, row.id];

export interface BalanceRow {
  unpaid_cents: number;
  unpaid_count: number;
  held_cents: number;
  held_count: number;
  last_paid_at: number | null;
}

/** GET /ledger/balance: unpaid entries that are not held, held entries, and the last paid payout. */
export async function ledgerBalance(
  db: Queryable,
  payeeType: 'store' | 'driver',
  payeeId: string,
): Promise<BalanceRow> {
  const rows = await rowsOf<BalanceRow>(
    db,
    `SELECT
       COALESCE(sum(amount_cents) FILTER (WHERE held_for_issue_id IS NULL), 0)::bigint AS unpaid_cents,
       (count(*) FILTER (WHERE held_for_issue_id IS NULL))::int AS unpaid_count,
       COALESCE(sum(amount_cents) FILTER (WHERE held_for_issue_id IS NOT NULL), 0)::bigint AS held_cents,
       (count(*) FILTER (WHERE held_for_issue_id IS NOT NULL))::int AS held_count,
       (SELECT max(paid_at) FROM payouts
         WHERE payee_type = $1 AND payee_id = $2 AND status = 'paid') AS last_paid_at
       FROM ledger_entries
      WHERE payee_type = $1 AND payee_id = $2 AND payout_id IS NULL`,
    [payeeType, payeeId],
  );
  return rows[0]!;
}

// ---------- what the ledger reads from other tables ----------

export interface SettledStoreOrderRow {
  id: string;
  doc: Omit<StoreOrder, 'id' | 'createdAt' | 'updatedAt'>;
  commission_bps: number | null;
  order_source: 'cart' | 'quote' | 'replacement';
  order_issue_id: string | null;
}

/** The delivered and picked-up store orders of an order, with the commission rate fixed at placement. */
export async function settledStoreOrdersOf(tx: Tx, orderId: string): Promise<SettledStoreOrderRow[]> {
  const { rows } = await tx.query<SettledStoreOrderRow>(
    `SELECT so.id, so.doc, (so.meta->>'commissionBps')::int AS commission_bps,
            o.source AS order_source, o.doc->>'issueId' AS order_issue_id
       FROM store_orders so JOIN orders o ON o.id = so.order_id
      WHERE so.order_id = $1 AND so.status IN ('delivered', 'picked_up')
      ORDER BY so.id`,
    [orderId],
  );
  return rows;
}

/** The open (not resolved) issue of a store order, whose id holds its new entries (MARKETPLACE §3.9). */
export async function openIssueOf(tx: Tx, storeOrderId: string): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM issues WHERE store_order_id = $1 AND status <> 'resolved' ORDER BY id LIMIT 1`,
    [storeOrderId],
  );
  return rows[0]?.id ?? null;
}

/** The fault party an issue was resolved with (a replacement order's origin), or null. */
export async function faultPartyOf(tx: Tx, issueId: string): Promise<FaultParty | null> {
  const { rows } = await tx.query<{ fault: FaultParty | null }>(
    `SELECT doc #>> '{resolution,faultParty}' AS fault FROM issues WHERE id = $1`,
    [issueId],
  );
  return rows[0]?.fault ?? null;
}

export interface IssueRefs {
  order_id: string;
  store_order_id: string;
  delivery_id: string | null;
}

export async function issueRefsOf(tx: Tx, issueId: string): Promise<IssueRefs | null> {
  const { rows } = await tx.query<IssueRefs>(
    `SELECT order_id, store_order_id, doc->>'deliveryId' AS delivery_id FROM issues WHERE id = $1`,
    [issueId],
  );
  return rows[0] ?? null;
}

export interface PayeeInfo {
  name: string;
  /** The payout account set by ops (store settings or the driver profile), or null. */
  accountRef: string | null;
}

/** The payee's display name and payout account (MARKETPLACE §3.9). */
export async function payeeInfo(db: Db, payeeType: 'store' | 'driver', payeeId: string): Promise<PayeeInfo> {
  const rows =
    payeeType === 'store'
      ? await rowsOf<{ name: string; account_ref: string | null }>(
          db,
          `SELECT doc->>'name' AS name, settings #>> '{payoutAccount,accountRef}' AS account_ref
             FROM stores WHERE id = $1`,
          [payeeId],
        )
      : await rowsOf<{ name: string; account_ref: string | null }>(
          db,
          `SELECT display_name AS name, doc #>> '{payoutAccount,accountRef}' AS account_ref
             FROM users WHERE id = $1`,
          [payeeId],
        );
  const row = rows[0];
  return { name: row?.name || payeeId, accountRef: row?.account_ref ?? null };
}

// ---------- payouts ----------

interface PayoutRow {
  id: string;
  payee_type: 'store' | 'driver';
  payee_id: string;
  payee_name: string;
  run_key: string;
  period_date: string;
  entry_ids: string[];
  entry_count: number;
  credits_cents: number;
  debits_cents: number;
  net_cents: number;
  status: Payout['status'];
  provider: Payout['provider'];
  reference: string | null;
  created_at: number;
  paid_at: number | null;
}

const PAYOUT_COLUMNS = `id, payee_type, payee_id, payee_name, run_key, period_date, entry_ids, entry_count, credits_cents,
  debits_cents, net_cents, status, provider, reference, created_at, paid_at`;

export const toPayout = (row: PayoutRow): WithId<Payout> => ({
  id: row.id,
  payeeType: row.payee_type,
  payeeId: row.payee_id,
  payeeName: row.payee_name,
  runKey: row.run_key,
  periodDate: row.period_date,
  entryIds: row.entry_ids,
  entryCount: row.entry_count,
  creditsCents: row.credits_cents,
  debitsCents: row.debits_cents,
  netCents: row.net_cents,
  status: row.status,
  provider: row.provider,
  reference: row.reference,
  createdAt: row.created_at,
  paidAt: row.paid_at,
});

const payoutLiveRow = (payout: Pick<Payout, 'payeeType' | 'payeeId'> & { id: string }) => ({
  id: payout.id,
  payeeType: payout.payeeType,
  payeeId: payout.payeeId,
});

export async function findPayout(db: Queryable, id: string): Promise<WithId<Payout> | null> {
  const rows = await rowsOf<PayoutRow>(db, `SELECT ${PAYOUT_COLUMNS} FROM payouts WHERE id = $1`, [id]);
  return rows[0] ? toPayout(rows[0]) : null;
}

/** Rank 13 of §3.6. */
export async function lockPayout(tx: Tx, id: string): Promise<WithId<Payout> | null> {
  const { rows } = await tx.query<PayoutRow>(
    `SELECT ${PAYOUT_COLUMNS} FROM payouts WHERE id = $1 FOR NO KEY UPDATE`,
    [id],
  );
  return rows[0] ? toPayout(rows[0]) : null;
}

/** `ON CONFLICT (id) DO NOTHING`: a rerun with the same `now` creates nothing. Answers whether it was new. */
export async function insertPayout(tx: Tx, payout: WithId<Payout>): Promise<boolean> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO payouts (${PAYOUT_COLUMNS})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [
      payout.id,
      payout.payeeType,
      payout.payeeId,
      payout.payeeName,
      payout.runKey,
      payout.periodDate,
      payout.entryIds,
      payout.entryCount,
      payout.creditsCents,
      payout.debitsCents,
      payout.netCents,
      payout.status,
      payout.provider,
      payout.reference,
      new Date(payout.createdAt),
      payout.paidAt === null ? null : new Date(payout.paidAt),
    ],
  );
  if (rows.length === 0) return false;
  await publishChange(tx, 'payouts', 'created', payoutLiveRow(payout));
  return true;
}

/** The entries must be locked by the caller (rank 14). */
export async function stampEntries(tx: Tx, payoutId: string, entryIds: readonly string[]): Promise<number> {
  const { rowCount } = await tx.query(
    `UPDATE ledger_entries SET payout_id = $1 WHERE id = ANY($2::text[]) AND payout_id IS NULL`,
    [payoutId, entryIds],
  );
  return rowCount;
}

/** The payout row must be locked by the caller. */
export async function markPayoutPaid(tx: Tx, payout: WithId<Payout>, reference: string): Promise<void> {
  await tx.query(
    `UPDATE payouts SET status = 'paid', reference = $2, paid_at = $3 WHERE id = $1 AND status = 'pending'`,
    [payout.id, reference, new Date(tx.now)],
  );
  await publishChange(tx, 'payouts', 'updated', payoutLiveRow(payout));
}

/** A definite refusal: the payout fails and its entries go back to the next run. */
export async function markPayoutFailed(tx: Tx, payout: WithId<Payout>): Promise<void> {
  await tx.query(`UPDATE payouts SET status = 'failed' WHERE id = $1 AND status = 'pending'`, [payout.id]);
  await tx.query(
    `WITH locked AS (SELECT id FROM ledger_entries WHERE payout_id = $1 ORDER BY id COLLATE "C" FOR NO KEY UPDATE)
     UPDATE ledger_entries e SET payout_id = NULL FROM locked WHERE e.id = locked.id`,
    [payout.id],
  );
  await publishChange(tx, 'payouts', 'updated', payoutLiveRow(payout));
}

export interface PayoutFilter {
  payeeType: 'store' | 'driver' | null;
  payeeId: string | null;
  status: Payout['status'] | null;
  runKey: string | null;
}

/** GET /payouts: newest first (index 33). */
export async function listPayouts(
  db: Queryable,
  filter: PayoutFilter,
  after: [number, string] | null,
  limit: number,
): Promise<PayoutRow[]> {
  return rowsOf<PayoutRow>(
    db,
    `SELECT ${PAYOUT_COLUMNS} FROM payouts
      WHERE ($1::text IS NULL OR payee_type = $1)
        AND ($2::text IS NULL OR payee_id = $2)
        AND ($3::text IS NULL OR status = $3)
        AND ($4::text IS NULL OR run_key = $4)
        AND ($5::timestamptz IS NULL OR (created_at, id) < ($5::timestamptz, $6::text))
      ORDER BY created_at DESC, id DESC
      LIMIT $7`,
    [
      filter.payeeType,
      filter.payeeId,
      filter.status,
      filter.runKey,
      after ? new Date(after[0]) : null,
      after ? after[1] : null,
      limit + 1,
    ],
  );
}

export const payoutCursorKey = (row: PayoutRow): [number, string] => [row.created_at, row.id];

// ---------- the daily run (§9.5) ----------

/** Payouts still waiting for their transfer: the resume step. */
export async function pendingPayoutIds(db: Queryable): Promise<string[]> {
  const rows = await rowsOf<{ id: string }>(
    db,
    `SELECT id FROM payouts WHERE status = 'pending' ORDER BY created_at, id`,
    [],
  );
  return rows.map((row) => row.id);
}

/** Step 2: every payee with unpaid, not held entries created up to `now`. */
export async function unpaidPayees(
  db: Queryable,
  now: number,
): Promise<{ payee_type: 'store' | 'driver'; payee_id: string }[]> {
  return rowsOf(
    db,
    `SELECT DISTINCT payee_type, payee_id FROM ledger_entries
      WHERE payout_id IS NULL AND held_for_issue_id IS NULL AND created_at <= $1
      ORDER BY payee_type, payee_id`,
    [new Date(now)],
  );
}

/** Step 3: lock one payee's unpaid, not held entries up to `now`, in id order (rank 14). */
export async function lockUnpaidEntries(
  tx: Tx,
  payeeType: 'store' | 'driver',
  payeeId: string,
  now: number,
): Promise<{ id: string; amount_cents: number }[]> {
  const { rows } = await tx.query<{ id: string; amount_cents: number }>(
    `SELECT id, amount_cents FROM ledger_entries
      WHERE payee_type = $1 AND payee_id = $2 AND payout_id IS NULL AND held_for_issue_id IS NULL
        AND created_at <= $3
      ORDER BY id COLLATE "C" FOR NO KEY UPDATE`,
    [payeeType, payeeId, new Date(now)],
  );
  return rows;
}
