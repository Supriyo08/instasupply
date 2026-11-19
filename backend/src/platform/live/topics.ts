/**
 * Live topics (docs/PLATFORM.md §8.2): who may subscribe (`authorizeTopic`) and which topics a written row
 * addresses (`topicsFor`). Commands never choose topics by hand; repositories call publishChange, which asks
 * this table.
 */
import type pg from 'pg';
import type { Actor } from '../auth/actor';
import type { DenyReason, EventKind } from './protocol';

type Query = Pick<pg.Pool, 'query'>;

const OPS_AREAS = new Set([
  'orders',
  'store-orders',
  'deliveries',
  'job-offers',
  'quotes',
  'issues',
  'support-threads',
  'threads',
  'drivers',
  'payouts',
  'suggestions',
  'outbox',
]);

/** Topics anyone may subscribe to, also without `auth`. */
export function isPublicTopic(topic: string): boolean {
  return (
    topic === 'categories' ||
    topic === 'stores' ||
    /^store:[^:]+$/.test(topic) ||
    /^store:[^:]+:products$/.test(topic) ||
    /^product:[^:]+$/.test(topic) ||
    /^tracking:[^:]+$/.test(topic)
  );
}

const isActiveSupplierOf = (actor: Actor, storeId: string): boolean =>
  actor.role === 'supplier' && actor.isActive && actor.storeId === storeId;

async function one<R extends Record<string, unknown>>(db: Query, sql: string, id: string): Promise<R | null> {
  const { rows } = await db.query<R>(sql, [id]);
  return rows[0] ?? null;
}

/**
 * null when the subscription is allowed, else the reason. Per-object topics load their row and apply the
 * predicates of §7.3 to it; a topic whose object does not exist is not-found.
 */
export async function authorizeTopic(
  db: Query,
  actor: Actor | null,
  topic: string,
): Promise<DenyReason | null> {
  if (isPublicTopic(topic)) {
    const token = /^tracking:(.+)$/.exec(topic)?.[1];
    if (token !== undefined) {
      const row = await one(db, 'SELECT 1 AS ok FROM tracking WHERE token = $1', token);
      return row ? null : 'not-found';
    }
    return null;
  }
  const parts = topic.split(':');
  const [head, a, b] = parts;
  const known = isKnownPattern(parts);
  if (!known) return 'not-found';
  if (!actor) return 'unauthenticated';
  if (actor.status === 'suspended') return 'permission-denied';
  const staff = actor.isStaff;

  switch (head) {
    case 'user':
      return a === actor.uid ? null : 'permission-denied';
    case 'ops':
      return staff ? null : 'permission-denied';
    case 'driver-locations':
      return staff ? null : 'permission-denied';
    case 'driver':
      return staff || (a === actor.uid && actor.role === 'driver') ? null : 'permission-denied';
    case 'thread':
      return staff || (a === actor.uid && actor.role === 'driver') ? null : 'permission-denied';
    case 'job-offers': {
      if (staff) return null;
      const own =
        actor.role === 'driver' && actor.isActive && `${a}:${b}` === `${actor.cityId}:${actor.capacityClass}`;
      return own ? null : 'permission-denied';
    }
    case 'store': {
      // store:{id}:orders | :issues (members) and :payouts (owner); store:{id} itself is public.
      if (staff) return null;
      if (!isActiveSupplierOf(actor, a!)) return 'permission-denied';
      return b === 'payouts' && actor.storeRole !== 'owner' ? 'permission-denied' : null;
    }
    case 'support-thread': {
      if (staff) return null;
      const owns =
        (actor.role === 'customer' && actor.isActive && a === actor.uid) ||
        (actor.role === 'supplier' && actor.isActive && a === `store_${actor.storeId}`);
      return owns ? null : 'permission-denied';
    }
    case 'order': {
      const row = await one<{ customer_id: string }>(db, 'SELECT customer_id FROM orders WHERE id = $1', a!);
      if (!row) return 'not-found';
      return staff || row.customer_id === actor.uid ? null : 'permission-denied';
    }
    case 'store-order': {
      const row = await one<{ customer_id: string; store_id: string }>(
        db,
        'SELECT customer_id, store_id FROM store_orders WHERE id = $1',
        a!,
      );
      if (!row) return 'not-found';
      return staff || row.customer_id === actor.uid || isActiveSupplierOf(actor, row.store_id)
        ? null
        : 'permission-denied';
    }
    case 'quote': {
      const row = await one<{ customer_id: string }>(db, 'SELECT customer_id FROM quotes WHERE id = $1', a!);
      if (!row) return 'not-found';
      return staff || row.customer_id === actor.uid ? null : 'permission-denied';
    }
    case 'issue': {
      const row = await one<{ customer_id: string; store_id: string }>(
        db,
        'SELECT customer_id, store_id FROM issues WHERE id = $1',
        a!,
      );
      if (!row) return 'not-found';
      return staff || row.customer_id === actor.uid || isActiveSupplierOf(actor, row.store_id)
        ? null
        : 'permission-denied';
    }
    case 'delivery': {
      const row = await one<{ driver_id: string | null }>(
        db,
        'SELECT driver_id FROM deliveries WHERE id = $1',
        a!,
      );
      if (!row) return 'not-found';
      return staff || (actor.role === 'driver' && row.driver_id === actor.uid) ? null : 'permission-denied';
    }
    default:
      return 'not-found';
  }
}

function isKnownPattern(parts: string[]): boolean {
  const [head, a, b] = parts;
  const n = parts.length;
  const id = (value: string | undefined): boolean => value !== undefined && value.length > 0;
  switch (head) {
    case 'user':
      return (
        (n === 2 && id(a)) ||
        (n === 3 && id(a) && ['notifications', 'orders', 'quotes', 'issues'].includes(b!))
      );
    case 'order':
    case 'store-order':
    case 'quote':
    case 'issue':
    case 'delivery':
    case 'thread':
    case 'support-thread':
      return n === 2 && id(a);
    case 'store':
      return n === 3 && id(a) && ['orders', 'issues', 'payouts'].includes(b!);
    case 'driver':
      return n === 3 && id(a) && ['deliveries', 'route', 'earnings'].includes(b!);
    case 'job-offers':
      return n === 3 && id(a) && id(b);
    case 'driver-locations':
      return n === 1;
    case 'ops':
      return n === 2 && OPS_AREAS.has(a!);
    default:
      return false;
  }
}

// ---------- which change publishes what ----------

export type LiveTable =
  | 'categories'
  | 'stores'
  | 'store_settings'
  | 'products'
  | 'tracking'
  | 'users'
  | 'notifications'
  | 'orders'
  | 'store_orders'
  | 'quotes'
  | 'issues'
  | 'support_threads'
  | 'support_messages'
  | 'chat_threads'
  | 'chat_messages'
  | 'deliveries'
  | 'delivery_events'
  | 'routes'
  | 'job_offers'
  | 'ledger_entries'
  | 'payouts'
  | 'driver_locations'
  | 'store_suggestions'
  | 'dev_outbox';

/** One frame to send: the topics it addresses, its kind, the event id and an optional payload. */
export interface LiveFrame {
  topics: string[];
  kind: EventKind;
  id: string;
  data: unknown;
}

type Fields = Record<string, unknown>;
const str = (row: Fields, key: string): string | null => {
  const value = row[key];
  return typeof value === 'string' && value !== '' ? value : null;
};
const req = (row: Fields, key: string, table: LiveTable): string => {
  const value = str(row, key);
  if (value === null) throw new Error(`publishChange(${table}): the row has no ${key}`);
  return value;
};
const compact = (topics: (string | null | false)[]): string[] => [
  ...new Set(topics.filter((t): t is string => typeof t === 'string')),
];

/**
 * The topics of §8.2 for one written row. `row` is the API shape of the row (camelCase, as the serializer
 * of §3.3 builds it) plus, where a table needs it, the extra keys named below:
 * - stores, store_settings: `id`; products: `id`, `storeId`; users: `uid` (or `id`), `role`
 * - tracking: `token` and the PublicTracking document (sent as payload without `token`)
 * - deliveries: `id`, `driverId`, and `previousDriverId` when the driver changed
 * - job_offers: `deliveryId`, `audience`, `status`, and `previousStatus` on an update or delete
 * - ledger_entries, payouts: `id`, `payeeType`, `payeeId`
 */
export function topicsFor(table: LiveTable, kind: EventKind, row: Fields): LiveFrame[] {
  const id = (key = 'id') => req(row, key, table);
  switch (table) {
    case 'categories':
      return [{ topics: ['categories'], kind, id: id(), data: null }];
    case 'stores':
      return [{ topics: ['stores', `store:${id()}`], kind, id: id(), data: null }];
    case 'store_settings':
      return [{ topics: [`store:${id()}`], kind, id: id(), data: null }];
    case 'products':
      return [{ topics: [`store:${id('storeId')}:products`, `product:${id()}`], kind, id: id(), data: null }];
    case 'tracking': {
      const { token, ...doc } = row;
      return [{ topics: [`tracking:${String(token)}`], kind, id: req(row, 'token', table), data: doc }];
    }
    case 'users': {
      const uid = str(row, 'uid') ?? id();
      return [
        {
          topics: compact([`user:${uid}`, row.role === 'driver' && 'ops:drivers']),
          kind,
          id: uid,
          data: null,
        },
      ];
    }
    case 'notifications': {
      const userId = id('userId');
      return [
        { topics: [`user:${userId}:notifications`], kind, id: id(), data: kind === 'created' ? row : null },
      ];
    }
    case 'orders':
      return [
        {
          topics: [`order:${id()}`, `user:${id('customerId')}:orders`, 'ops:orders'],
          kind,
          id: id(),
          data: null,
        },
      ];
    case 'store_orders':
      return [
        {
          topics: [
            `store-order:${id()}`,
            `order:${id('orderId')}`,
            `user:${id('customerId')}:orders`,
            `store:${id('storeId')}:orders`,
            'ops:store-orders',
          ],
          kind,
          id: id(),
          data: null,
        },
      ];
    case 'quotes':
      return [
        {
          topics: [`quote:${id()}`, `user:${id('customerId')}:quotes`, 'ops:quotes'],
          kind,
          id: id(),
          data: null,
        },
      ];
    case 'issues':
      return [
        {
          topics: [
            `issue:${id()}`,
            `user:${id('customerId')}:issues`,
            `store:${id('storeId')}:issues`,
            'ops:issues',
          ],
          kind,
          id: id(),
          data: null,
        },
      ];
    case 'support_threads':
      return [{ topics: [`support-thread:${id()}`, 'ops:support-threads'], kind, id: id(), data: null }];
    case 'support_messages':
      return [
        { topics: [`support-thread:${id('threadId')}`], kind: 'message', id: id(), data: row },
        { topics: ['ops:support-threads'], kind: 'updated', id: id(), data: null },
      ];
    case 'chat_threads': {
      const driverId = str(row, 'driverId') ?? id();
      return [{ topics: [`thread:${driverId}`, 'ops:threads'], kind, id: driverId, data: null }];
    }
    case 'chat_messages':
      return [
        { topics: [`thread:${id('threadId')}`], kind: 'message', id: id(), data: row },
        { topics: ['ops:threads'], kind: 'updated', id: id(), data: null },
      ];
    case 'deliveries': {
      const driverId = str(row, 'driverId');
      const previous = str(row, 'previousDriverId');
      return [
        {
          topics: compact([
            `delivery:${id()}`,
            driverId && `driver:${driverId}:deliveries`,
            previous && previous !== driverId && `driver:${previous}:deliveries`,
            'ops:deliveries',
          ]),
          kind,
          id: id(),
          data: null,
        },
      ];
    }
    case 'delivery_events':
      return [
        {
          topics: [`delivery:${id('deliveryId')}`, 'ops:deliveries'],
          kind,
          id: id('deliveryId'),
          data: null,
        },
      ];
    case 'routes':
      return [{ topics: [`driver:${id('driverId')}:route`], kind, id: id('driverId'), data: null }];
    case 'job_offers': {
      const open = row.status === 'open' || row.previousStatus === 'open';
      const audience = Array.isArray(row.audience) ? row.audience.filter((k) => typeof k === 'string') : [];
      return [
        {
          topics: compact([
            ...(open ? audience.map((key) => `job-offers:${String(key)}`) : []),
            'ops:job-offers',
          ]),
          kind,
          id: id('deliveryId'),
          data: null,
        },
      ];
    }
    case 'ledger_entries':
    case 'payouts': {
      const payee = id('payeeId');
      const topic = row.payeeType === 'store' ? `store:${payee}:payouts` : `driver:${payee}:earnings`;
      return [{ topics: [topic, 'ops:payouts'], kind, id: id(), data: null }];
    }
    case 'driver_locations': {
      const driverId = str(row, 'driverId') ?? id();
      return [{ topics: ['driver-locations'], kind, id: driverId, data: { ...row, id: driverId } }];
    }
    case 'store_suggestions':
      return [{ topics: ['ops:suggestions'], kind, id: id(), data: null }];
    case 'dev_outbox':
      return [{ topics: ['ops:outbox'], kind, id: id(), data: null }];
  }
}
