/**
 * The one writer of a store order's status (MARKETPLACE §2.1, docs/PLATFORM.md §9.1, §9.2.2). It checks the
 * shared transition table, applies shortages (§2.1.1: lines, `current`, stock release of the shorted units),
 * bumps `version`, appends the history entry, stamps `statusAt` and saves the locked row. The caller does
 * the rest of its row of §9.2: the delivery, the remaining stock, `applyStoreOrderEffects` and
 * `projectOrderAggregate`.
 */
import {
  canStoreOrderTransition,
  settleStoreOrder,
  shortStoreName,
  storeValueCents,
  voidAmounts,
  type ActorRole,
  type LineAdjustment,
  type MachineActor,
  type ShortReason,
  type StoreOrder,
  type StoreOrderHistoryEntry,
  type StoreOrderLine,
  type StoreOrderStatus,
} from '@instasupply/shared';
import type { LockedGraph } from '../../platform/db/locks';
import type { Tx } from '../../platform/db/tx';
import { ApiError, failedPrecondition, invalidArgument } from '../../platform/http/errors';
import { stageStockRelease, type StockLine } from './stock';
import { saveStoreOrder } from './store-orders.repository';

/**
 * Who changed a store order (MARKETPLACE §2.1). `kind` is the actor of the machine; `uid`, `name` and `role`
 * go into the history entry. Built with `orderActorFrom(actor)` or `SYSTEM_ORDER_ACTOR` (access.ts). Other
 * modules may pass only `role` (a `users.role` or `'system'`): the kind is then derived from it.
 */
export interface OrderActor {
  kind?: MachineActor;
  uid?: string | null;
  name?: string | null;
  role?: ActorRole | null;
  [field: string]: unknown;
}

/**
 * The store's price of each line of a replacement store order, by `lineId`, kept in `store_orders.meta` by the
 * order writer: the lines themselves cost the customer 0, and a shortage must still lower `storeValueCents`
 * to Σ store price × fulfilledQty (MARKETPLACE §3.6).
 */
export interface StoreUnitPriceMeta {
  storeUnitPriceCents?: Record<string, number>;
}

/** §3.6 for a replacement: Σ store price × fulfilledQty, or the kept value for a row without the prices. */
function replacementStoreValue(graph: LockedGraph, so: StoreOrder, lines: readonly StoreOrderLine[]): number {
  const prices = (graph.storeOrders.get(so.id)?.meta as StoreUnitPriceMeta | undefined)?.storeUnitPriceCents;
  const priced = lines.map((line) => ({ line, price: prices?.[line.lineId] }));
  if (priced.some(({ price }) => typeof price !== 'number')) return so.storeValueCents;
  return storeValueCents(
    priced.map(({ line, price }) => ({ unitPriceCents: price!, fulfilledQty: line.fulfilledQty })),
  );
}

export interface ResolvedActor {
  kind: MachineActor;
  uid: string | null;
  name: string | null;
  role: ActorRole;
}

const MACHINE_ACTORS: readonly MachineActor[] = ['customer', 'supplier', 'driver', 'staff', 'system'];
const ROLE_KIND: Record<ActorRole, MachineActor> = {
  admin: 'staff',
  dispatcher: 'staff',
  supplier: 'supplier',
  customer: 'customer',
  driver: 'driver',
  system: 'system',
};
const KIND_ROLE: Record<MachineActor, ActorRole> = {
  staff: 'dispatcher',
  supplier: 'supplier',
  customer: 'customer',
  driver: 'driver',
  system: 'system',
};

const isMachineActor = (value: unknown): value is MachineActor =>
  typeof value === 'string' && (MACHINE_ACTORS as readonly string[]).includes(value);
const isActorRole = (value: unknown): value is ActorRole =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(ROLE_KIND, value);

export function resolveActor(actor: OrderActor): ResolvedActor {
  const role = isActorRole(actor.role) ? actor.role : null;
  const kind = isMachineActor(actor.kind) ? actor.kind : role ? ROLE_KIND[role] : null;
  if (!kind) throw new ApiError('internal', 'A store-order change needs an actor kind or role.');
  return {
    kind,
    uid: typeof actor.uid === 'string' ? actor.uid : null,
    name: typeof actor.name === 'string' && actor.name !== '' ? actor.name : null,
    role: role ?? KIND_ROLE[kind],
  };
}

// ---------- shortages (§2.1.1) ----------

export interface AppliedAdjustments {
  lines: StoreOrderLine[];
  /** Units no longer reserved, per reason. */
  released: { line: StoreOrderLine; delta: number; reason: ShortReason }[];
  /** "Boltbin: 20 of 24 joist hangers — out of stock". */
  summary: string | null;
}

const SHORT_REASON_TEXT: Record<ShortReason, string> = {
  out_of_stock: 'out of stock',
  damaged: 'damaged',
  discontinued: 'discontinued',
  other: 'not available',
};

/**
 * Validates adjustments against the store order's lines: known and distinct line ids, whole quantities
 * from 0 to the line's current `fulfilledQty` (quantities only go down). Throws invalid-argument.
 */
export function validateAdjustments(
  so: StoreOrder,
  adjustments: readonly LineAdjustment[] | undefined,
): void {
  if (!adjustments) return;
  const seen = new Set<string>();
  for (const [index, adjustment] of adjustments.entries()) {
    const line = so.lines.find((l) => l.lineId === adjustment.lineId);
    if (!line) {
      invalidArgument(`There is no line ${adjustment.lineId} on ${so.number}.`, {
        fields: { [`adjustments.${index}.lineId`]: 'unknown line' },
      });
    }
    if (seen.has(adjustment.lineId)) {
      invalidArgument(`Line ${adjustment.lineId} is adjusted twice.`, {
        fields: { [`adjustments.${index}.lineId`]: 'duplicate line' },
      });
    }
    seen.add(adjustment.lineId);
    if (
      !Number.isSafeInteger(adjustment.fulfilledQty) ||
      adjustment.fulfilledQty < 0 ||
      adjustment.fulfilledQty > line.fulfilledQty
    ) {
      invalidArgument(`${line.name}: the quantity can only go down, to between 0 and ${line.fulfilledQty}.`, {
        fields: { [`adjustments.${index}.fulfilledQty`]: `0 to ${line.fulfilledQty}` },
      });
    }
  }
}

/** True when the adjustments leave nothing to supply: every line at 0 (a reject or a store cancel). */
export function adjustmentsEmptyOrder(
  so: StoreOrder,
  adjustments: readonly LineAdjustment[] | undefined,
): boolean {
  if (!adjustments || adjustments.length === 0) return false;
  return so.lines.every((line) => {
    const adjustment = adjustments.find((a) => a.lineId === line.lineId);
    return (adjustment ? adjustment.fulfilledQty : line.fulfilledQty) === 0;
  });
}

export function applyAdjustments(
  so: StoreOrder,
  adjustments: readonly LineAdjustment[] | undefined,
): AppliedAdjustments {
  validateAdjustments(so, adjustments);
  const released: AppliedAdjustments['released'] = [];
  const texts: string[] = [];
  const lines = so.lines.map((line) => {
    const adjustment = adjustments?.find((a) => a.lineId === line.lineId);
    if (!adjustment || adjustment.fulfilledQty === line.fulfilledQty) return line;
    const delta = line.fulfilledQty - adjustment.fulfilledQty;
    const next: StoreOrderLine = {
      ...line,
      fulfilledQty: adjustment.fulfilledQty,
      shortReason: adjustment.reason,
    };
    released.push({ line: next, delta, reason: adjustment.reason });
    texts.push(
      `${adjustment.fulfilledQty} of ${line.quantity} ${line.name} — ${SHORT_REASON_TEXT[adjustment.reason]}`,
    );
    return next;
  });
  const summary = texts.length > 0 ? `${shortStoreName(so.storeName)}: ${texts.join('; ')}` : null;
  return { lines, released, summary };
}

/** Releases the units a shortage freed; `out_of_stock` also clamps on hand to what stays reserved. */
async function releaseShorted(tx: Tx, released: AppliedAdjustments['released']): Promise<void> {
  const byClamp = new Map<boolean, StockLine[]>();
  for (const { line, delta, reason } of released) {
    if (line.kind !== 'catalog' || !line.productId) continue;
    const clamp = reason === 'out_of_stock';
    byClamp.set(clamp, [...(byClamp.get(clamp) ?? []), { productId: line.productId, quantity: delta }]);
  }
  // Plain releases first, then the clamped ones: a product shorted twice ends clamped.
  for (const clamp of [false, true]) {
    const lines = byClamp.get(clamp);
    if (lines) await stageStockRelease(tx, lines, { outOfStock: clamp });
  }
}

// ---------- the transition ----------

const HISTORY_MAX = 40;
const VOID_STATUSES: readonly StoreOrderStatus[] = ['rejected', 'cancelled'];
const COMPLETED_STATUSES: readonly StoreOrderStatus[] = ['delivered', 'picked_up'];

export async function stageStoreOrderTransition(
  tx: Tx,
  graph: LockedGraph,
  so: StoreOrder,
  to: StoreOrderStatus,
  actor: OrderActor,
  opts: { adjustments?: LineAdjustment[]; reason?: string; note?: string; extra?: Partial<StoreOrder> } = {},
): Promise<StoreOrder> {
  const who = resolveActor(actor);
  if (!canStoreOrderTransition(so.status, to, who.kind, { fulfilment: so.fulfilment })) {
    failedPrecondition(`${so.number} can't move from ${so.status} to ${to}.`, { status: so.status });
  }
  const applied = applyAdjustments(so, opts.adjustments);
  await releaseShorted(tx, applied.released);

  const now = tx.now;
  const voided = VOID_STATUSES.includes(to);
  const current = voided ? voidAmounts() : settleStoreOrder(applied.lines, so.placed);
  // A replacement's lines cost the customer 0 and its store value is priced from the catalogue (§3.6): the
  // store's per-line prices kept at placement, times what was fulfilled.
  const value = voided
    ? 0
    : so.source === 'replacement'
      ? replacementStoreValue(graph, so, applied.lines)
      : storeValueCents(applied.lines);
  const note =
    [opts.note, opts.reason && opts.reason !== opts.note ? opts.reason : null, applied.summary]
      .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
      .join(' · ') || null;
  const entry: StoreOrderHistoryEntry = {
    status: to,
    at: now,
    actorId: who.uid,
    actorName: who.name,
    actorRole: who.role,
    note,
  };
  const cancelledBy =
    to === 'cancelled'
      ? who.kind === 'customer'
        ? 'customer'
        : who.kind === 'supplier'
          ? 'store'
          : who.kind === 'staff'
            ? 'staff'
            : 'system'
      : so.cancelledBy;

  const next: StoreOrder = {
    ...so,
    lines: applied.lines,
    current,
    storeValueCents: value,
    status: to,
    statusAt: { ...so.statusAt, [to]: now },
    version: so.version + 1,
    history: [...so.history, entry].slice(-HISTORY_MAX),
    completedAt: COMPLETED_STATUSES.includes(to) ? (so.completedAt ?? now) : so.completedAt,
    cancelledBy,
    cancelReason: voided ? (so.cancelReason ?? opts.reason ?? null) : so.cancelReason,
    ...opts.extra,
    // The keys and the machine fields are this function's, whatever `extra` says.
    id: so.id,
    orderId: so.orderId,
    storeId: so.storeId,
    customerId: so.customerId,
    createdAt: so.createdAt,
  };

  const saved = await saveStoreOrder(tx, next);
  refreshGraph(graph, saved);
  return saved;
}

/** Keeps the locked snapshot in step with what this transaction wrote, for later helpers that read it. */
export function refreshGraph(graph: LockedGraph, so: StoreOrder): void {
  const row = graph.storeOrders.get(so.id);
  if (!row) return;
  const { id: _id, createdAt: _c, updatedAt, ...doc } = so;
  row.doc = doc as unknown as Record<string, unknown>;
  row.status = so.status;
  row.version = so.version;
  row.updated_at = updatedAt;
}
