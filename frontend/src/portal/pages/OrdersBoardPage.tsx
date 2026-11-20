import { useLiveQuery, usePagedQuery } from '@instasupply/api-client/react';
import { STORE_ORDER_META, formatDateTimeET, localDateOf, type StoreOrder } from '@instasupply/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useServerNow } from '@/components/ui/Countdown';
import { LoadMore } from '@/components/ui/Data';
import { ErrorState, PageSpinner } from '@/components/ui/Feedback';
import { SoundOffIcon, SoundOnIcon } from '@/components/ui/icons';
import { PageHeader, Tabs } from '@/components/ui/Layout';
import { Money } from '@/components/ui/Money';
import { useSupplier } from '@/features/auth/AuthProvider';
import { queries } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useStartOfToday } from '@/lib/data';

import { BOARD_LANES, customerLabel, laneOf, type BoardLane } from '../components/order-format';
import { SceneEmpty } from '../components/SceneArt';
import { StoreOrderCard } from '../components/StoreOrderCard';
import { useNewOrderAlerts } from '../components/useNewOrderAlerts';

type View = 'board' | 'history';

/** The board query reads at most this many open orders (CLIENTS §4.1 `storeBoard`). */
const BOARD_LIMIT = 200;

function byRespondBy(a: StoreOrder, b: StoreOrder) {
  return a.timing.respondBy - b.timing.respondBy;
}

function Lane({
  id,
  title,
  empty,
  orders,
  now,
}: {
  id: BoardLane;
  title: string;
  empty: string;
  orders: readonly StoreOrder[];
  now: number;
}) {
  const headingId = `lane-${id}`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-2xl bg-slate-100/80 p-2 lg:w-auto lg:min-w-0',
        id === 'new' && orders.length > 0 && 'bg-amber-50 ring-1 ring-amber-200',
      )}
    >
      <h2
        id={headingId}
        className="flex items-center justify-between px-1.5 py-1 text-sm font-semibold text-slate-800"
      >
        {title}
        <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 tabular-nums ring-1 ring-slate-200">
          {orders.length}
        </span>
      </h2>
      <ul className="mt-1 flex flex-1 flex-col gap-2">
        {orders.length === 0 ? (
          <li className="rounded-xl border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-500">
            {empty}
          </li>
        ) : (
          orders.map((order) => (
            <li key={order.id}>
              <StoreOrderCard order={order} now={now} />
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function SoundControl({
  soundReady,
  muted,
  onUnlock,
  onToggleMute,
}: {
  soundReady: boolean;
  muted: boolean;
  onUnlock: () => void;
  onToggleMute: () => void;
}) {
  if (!soundReady) {
    return (
      <Button variant="subtle" icon={SoundOnIcon} onClick={onUnlock}>
        Turn on order sound
      </Button>
    );
  }
  return (
    <Button
      variant="secondary"
      icon={muted ? SoundOffIcon : SoundOnIcon}
      onClick={onToggleMute}
      aria-pressed={!muted}
    >
      {muted ? 'Order sound off' : 'Order sound on'}
    </Button>
  );
}

function HistoryList({ storeId }: { storeId: string }) {
  const history = usePagedQuery(queries.storeHistory(storeId));
  const now = useServerNow(60_000);
  if (history.loading && history.items.length === 0) return <PageSpinner label="Loading order history" />;
  if (history.error && history.items.length === 0) {
    return <ErrorState error={history.error} onRetry={history.retry} />;
  }
  if (history.items.length === 0) {
    return (
      <Card>
        <SceneEmpty
          artKey="scene-order-confirmed"
          title="No orders yet"
          description="Orders from contractors show up here once your store is live."
        />
      </Card>
    );
  }
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Every order your store received, newest first</caption>
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Order
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Placed
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Customer
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Items
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                Your sale
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {history.items.map((order) => {
              const meta = STORE_ORDER_META[order.status];
              return (
                <tr key={order.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <Link
                      to={`/portal/orders/${encodeURIComponent(order.id)}`}
                      className="font-mono text-xs font-semibold text-brand-700 hover:underline"
                    >
                      {order.number}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">
                    {formatDateTimeET(order.createdAt, now)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{customerLabel(order)}</td>
                  <td className="max-w-xs truncate px-4 py-2.5 text-slate-700">{order.itemsSummary}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={meta.tone} dot>
                      {meta.label}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Money cents={order.storeValueCents} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <LoadMore hasMore={history.hasMore} loadingMore={history.loadingMore} onLoadMore={history.loadMore} />
    </Card>
  );
}

/**
 * `/portal` (MARKETPLACE §8, CLIENTS §4.4): every store order that still needs the store, in lanes,
 * plus "Done today" and "Upcoming". The board is one complete live list (`storeBoard`); "Done today"
 * is a second query from Toronto midnight. New orders chime, toast and show in the tab title.
 */
export default function OrdersBoardPage() {
  const { storeId } = useSupplier();
  const [view, setView] = useState<View>('board');
  const board = useLiveQuery(queries.storeBoard(storeId));
  const startOfToday = useStartOfToday();
  const done = useLiveQuery(queries.storeCompleted(storeId, startOfToday));
  const now = useServerNow(30_000);
  const today = localDateOf(now);

  const lanes = useMemo(() => {
    const grouped: Record<BoardLane, StoreOrder[]> = {
      new: [],
      accepted: [],
      preparing: [],
      ready: [],
      out_for_delivery: [],
      done: [...done.data],
      upcoming: [],
    };
    for (const order of board.data) {
      const lane = laneOf(order, today);
      // Final orders reach "Done today" from their own query; the board lists open ones only.
      if (lane !== 'done') grouped[lane].push(order);
    }
    grouped.new.sort(byRespondBy);
    return grouped;
  }, [board.data, done.data, today]);

  const alerts = useNewOrderAlerts(lanes.new, board.loading, board.error);

  let body;
  if (view === 'history') {
    body = <HistoryList storeId={storeId} />;
  } else if (board.loading && board.data.length === 0) {
    body = <PageSpinner label="Loading orders" />;
  } else if (board.error && board.data.length === 0) {
    body = <ErrorState error={board.error} onRetry={board.retry} />;
  } else {
    const nothing = board.data.length === 0 && done.data.length === 0;
    body = (
      <>
        {board.error ? (
          <ErrorState
            className="mb-4"
            title="The board may be out of date"
            error={board.error}
            onRetry={board.retry}
          />
        ) : null}
        {done.error ? (
          <ErrorState
            className="mb-4"
            title="Couldn't load Done today"
            error={done.error}
            onRetry={done.retry}
          />
        ) : null}
        {board.data.length >= BOARD_LIMIT ? (
          <p className="mb-3 text-xs text-amber-700">
            Showing the first {BOARD_LIMIT} open orders, soonest first. Finish a few to see the rest.
          </p>
        ) : null}
        {nothing ? (
          <Card className="mb-4">
            <SceneEmpty
              artKey="scene-pickup-ready"
              title="No open orders right now"
              description="New orders appear here within seconds, with a chime. Keep this tab open during store hours; we also text your order-alert mobile."
            />
          </Card>
        ) : null}
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:overflow-visible lg:px-0">
          <div className="flex gap-3 lg:grid lg:grid-cols-4 2xl:grid-cols-7">
            {BOARD_LANES.map((lane) => (
              <Lane key={lane.id} {...lane} orders={lanes[lane.id]} now={now} />
            ))}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={lanes.new.length > 0 ? `Orders · ${lanes.new.length} new` : 'Orders'}
        description="Accept new orders quickly: crews are waiting on site."
        actions={
          <SoundControl
            soundReady={alerts.soundReady}
            muted={alerts.muted}
            onUnlock={alerts.unlock}
            onToggleMute={() => alerts.setMuted((value) => !value)}
          />
        }
      />
      <div className="mb-4">
        <Tabs<View>
          ariaLabel="Orders view"
          value={view}
          onChange={setView}
          items={[
            {
              value: 'board',
              label: 'Board',
              count: board.loading && board.data.length === 0 ? undefined : board.data.length,
            },
            { value: 'history', label: 'History' },
          ]}
        />
      </div>
      {body}
    </>
  );
}
