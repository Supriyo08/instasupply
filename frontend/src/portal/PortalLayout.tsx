import { useApiMutation, useLiveQuery } from '@instasupply/api-client/react';
import type { Store } from '@instasupply/shared';
import { useNavigate } from 'react-router';

import { Toggle } from '@/components/ui/Form';
import {
  BoardIcon,
  CatalogIcon,
  InsightsIcon,
  PayoutIcon,
  StoreIcon,
  SupportIcon,
  UsersIcon,
} from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import { RequireSupplier } from '@/app/guards/guards';
import { Shell, SideNav, type NavSectionSpec } from '@/app/layouts/Shell';
import { useAuth, useSupplier } from '@/features/auth/AuthProvider';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { useNotificationAlerts } from '@/features/notifications/useNotificationAlerts';
import { useNotifications } from '@/features/notifications/useNotifications';
import { describeError, queries } from '@/lib/api';

/** "Pause new orders": optimistic on the store row, rolled back with a toast if the server refuses (CLIENTS §1.12). */
function PauseToggle({ storeId }: { storeId: string }) {
  const toast = useToast();
  const query = queries.store(storeId);
  const store = useLiveQuery(query).data;
  const toggle = useApiMutation(
    (api, acceptingOrders: boolean) =>
      api.call('updateStoreProfile', { storeId, patch: { acceptingOrders } }),
    {
      optimistic: (cache, acceptingOrders) =>
        cache.patch<Store | null>(query.key, (current) =>
          current ? { ...current, acceptingOrders } : current,
        ),
      onError: (error) => toast.error("Couldn't change new orders", describeError(error)),
    },
  );
  if (!store) return null;
  return (
    <Toggle
      checked={!store.acceptingOrders}
      disabled={toggle.busy}
      onChange={(paused) => void toggle.run(!paused).catch(() => undefined)}
      label="Pause new orders"
    />
  );
}

function PortalFrame() {
  const { user, storeId, isOwner, displayName, store: storeFromMe } = useSupplier();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const store = useLiveQuery(queries.store(storeId)).data ?? storeFromMe;

  const notifications = useNotifications(user.uid);
  const alerts = useNotificationAlerts(
    notifications.data,
    notifications.loading,
    'supplier',
    notifications.error,
  );

  const sections: NavSectionSpec[] = [
    {
      title: 'Store',
      items: [
        { to: '/portal', label: 'Orders', icon: BoardIcon, end: true },
        { to: '/portal/catalog', label: 'Catalog', icon: CatalogIcon },
        { to: '/portal/store', label: 'Store', icon: StoreIcon },
        { to: '/portal/support', label: 'Support', icon: SupportIcon },
      ],
    },
    {
      title: 'Owner',
      items: isOwner
        ? [
            { to: '/portal/payouts', label: 'Payouts', icon: PayoutIcon },
            { to: '/portal/insights', label: 'Insights', icon: InsightsIcon },
            { to: '/portal/team', label: 'Team', icon: UsersIcon },
          ]
        : [],
    },
  ];

  return (
    <Shell
      renderSidebar={(close) => (
        <SideNav subtitle={store?.name ?? 'Supplier portal'} sections={sections} onNavigate={close} />
      )}
      headerStart={
        <p className="hidden truncate text-sm font-semibold text-slate-900 sm:block">{store?.name ?? ''}</p>
      }
      headerActions={
        <>
          <PauseToggle storeId={storeId} />
          <NotificationBell
            audience="supplier"
            notifications={notifications.data}
            unreadCount={notifications.unreadCount}
            onMarkRead={notifications.markRead}
            onMarkAllRead={notifications.markAllRead}
            desktopAlerts={alerts.permission}
            onEnableDesktopAlerts={() => void alerts.requestPermission()}
          />
        </>
      }
      account={{ name: displayName, email: user.email, caption: isOwner ? 'Store owner' : 'Store staff' }}
      onSignOut={() => {
        void signOut().then(() => navigate('/login', { replace: true }));
      }}
    />
  );
}

/** The supplier portal at `/portal` (MARKETPLACE §8): its own frame, never the ops `AppLayout`. */
export default function PortalLayout() {
  return (
    <RequireSupplier>
      <PortalFrame />
    </RequireSupplier>
  );
}
