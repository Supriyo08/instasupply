import { useConfig } from '@instasupply/api-client/react';
import { useNavigate } from 'react-router';

import { Button, IconButton } from '@/components/ui/Button';
import {
  CatalogIcon,
  DashboardIcon,
  InboxIcon,
  IssueIcon,
  JobsIcon,
  MapIcon,
  MessagesIcon,
  OrdersIcon,
  PackageIcon,
  PayoutIcon,
  PlusIcon,
  QuoteIcon,
  StoreIcon,
  SuggestionIcon,
  SupportIcon,
  TruckIcon,
  UsersIcon,
} from '@/components/ui/icons';
import { useAuth, useSignedInUser } from '@/features/auth/AuthProvider';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { useNotificationAlerts } from '@/features/notifications/useNotificationAlerts';
import { useNotifications } from '@/features/notifications/useNotifications';
import { useOpsDashboard } from '@/lib/data';

import { Shell, SideNav, type NavSectionSpec } from './Shell';

/** The ops back office frame (MARKETPLACE §9 sidebar). Badges come from one `GET /ops/dashboard`. */
export function AppLayout() {
  const { user, role, isAdmin, displayName } = useSignedInUser();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const config = useConfig();

  const notifications = useNotifications(user.uid);
  const alerts = useNotificationAlerts(
    notifications.data,
    notifications.loading,
    'staff',
    notifications.error,
  );
  const dashboard = useOpsDashboard().data;

  const sections: NavSectionSpec[] = [
    {
      title: 'Operations',
      items: [
        { to: '/', label: 'Dashboard', icon: DashboardIcon, end: true },
        { to: '/live', label: 'Live map', icon: MapIcon },
        { to: '/jobs', label: 'Jobs', icon: JobsIcon, badge: dashboard?.jobOffers.unclaimedOver15Min },
        { to: '/deliveries', label: 'Deliveries', icon: PackageIcon },
        { to: '/drivers', label: 'Drivers', icon: TruckIcon, badge: dashboard?.pendingDrivers },
        { to: '/messages', label: 'Messages', icon: MessagesIcon, badge: dashboard?.unreadDriverChat },
      ],
    },
    {
      title: 'Marketplace',
      items: [
        { to: '/orders', label: 'Orders', icon: OrdersIcon, badge: dashboard?.acceptOverdue },
        { to: '/stores', label: 'Stores', icon: StoreIcon },
        { to: '/catalog', label: 'Catalog', icon: CatalogIcon },
        { to: '/quotes', label: 'Quotes', icon: QuoteIcon, badge: dashboard?.quotes.waiting },
        { to: '/issues', label: 'Issues', icon: IssueIcon, badge: dashboard?.issues.open },
        { to: '/support', label: 'Support', icon: SupportIcon, badge: dashboard?.unreadSupport },
        { to: '/suggestions', label: 'Suggestions', icon: SuggestionIcon },
      ],
    },
    { title: 'Finance', items: [{ to: '/payouts', label: 'Payouts', icon: PayoutIcon }] },
    {
      title: 'Workspace',
      items: [
        ...(isAdmin ? [{ to: '/team', label: 'Team', icon: UsersIcon }] : []),
        // The outbox holds the SMS and email the server did not send (development, or no provider yet).
        ...(config?.smsDriver === 'outbox' || config?.emailDriver === 'outbox'
          ? [{ to: '/outbox', label: 'Dev SMS outbox', icon: InboxIcon }]
          : []),
      ],
    },
  ];

  const footer =
    config?.environment === 'development' ? (
      <div className="m-3 rounded-xl bg-white/5 p-3 text-[11px] text-brand-200 ring-1 ring-white/10">
        Connected to a <span className="font-semibold text-white">development server</span>. Data is not real.
      </div>
    ) : null;

  return (
    <Shell
      renderSidebar={(close) => (
        <SideNav subtitle="Operations console" sections={sections} footer={footer} onNavigate={close} />
      )}
      headerActions={
        <>
          <span className="hidden sm:inline-flex">
            <Button icon={PlusIcon} onClick={() => navigate('/deliveries?create=1')}>
              New delivery
            </Button>
          </span>
          <IconButton
            icon={PlusIcon}
            label="New delivery"
            className="sm:hidden"
            onClick={() => navigate('/deliveries?create=1')}
          />
          <NotificationBell
            audience="staff"
            notifications={notifications.data}
            unreadCount={notifications.unreadCount}
            onMarkRead={notifications.markRead}
            onMarkAllRead={notifications.markAllRead}
            desktopAlerts={alerts.permission}
            onEnableDesktopAlerts={() => void alerts.requestPermission()}
          />
        </>
      }
      account={{ name: displayName, email: user.email, caption: role }}
      onSignOut={() => {
        void signOut().then(() => navigate('/login', { replace: true }));
      }}
    />
  );
}
