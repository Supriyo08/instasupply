import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { Button, IconButton } from '@/components/ui/Button';
import { CloseIcon, MenuIcon, PlusIcon, SignOutIcon } from '@/components/ui/icons';
import { MenuItem, Popover } from '@/components/ui/Popover';
import { useSignedInUser, useAuth } from '@/features/auth/AuthProvider';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { useNotificationAlerts } from '@/features/notifications/useNotificationAlerts';
import { useNotifications } from '@/features/notifications/useNotifications';
import { cn } from '@/lib/cn';
import { useDrivers, useOpenDeliveries, useOpenOrders, useThreads } from '@/lib/data';

import { Sidebar } from './Sidebar';

export function AppLayout() {
  const { user, role, isAdmin, displayName } = useSignedInUser();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const notifications = useNotifications(user.uid);
  const alerts = useNotificationAlerts(notifications.data, notifications.loading);
  const drivers = useDrivers();
  const threads = useThreads();
  const open = useOpenDeliveries();
  const openOrders = useOpenOrders();

  const pendingDrivers = drivers.data.filter((driver) => driver.status === 'pending').length;
  const unreadMessages = threads.data.reduce((sum, thread) => sum + (thread.unreadByStaff ?? 0), 0);
  const unassigned = open.data.filter((delivery) => delivery.status === 'unassigned').length;
  const newOrders = openOrders.data.filter((order) => order.status === 'placed').length;

  const sidebar = (
    <Sidebar
      isAdmin={isAdmin}
      pendingDrivers={pendingDrivers}
      unreadMessages={unreadMessages}
      unassigned={unassigned}
      newOrders={newOrders}
      onNavigate={() => setDrawerOpen(false)}
    />
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-[1200] hidden w-64 lg:block">{sidebar}</aside>

      {/* Mobile drawer */}
      <div className={cn('fixed inset-0 z-[1300] lg:hidden', drawerOpen ? '' : 'pointer-events-none')}>
        <div
          className={cn(
            'absolute inset-0 bg-slate-900/40 transition-opacity',
            drawerOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
        <aside
          className={cn(
            'absolute inset-y-0 left-0 w-72 max-w-[85vw] transition-transform',
            drawerOpen ? 'translate-x-0' : '-translate-x-full',
          )}
          aria-hidden={!drawerOpen}
        >
          {sidebar}
          <IconButton
            icon={CloseIcon}
            label="Close menu"
            tone="inverse"
            className="absolute top-3.5 right-3"
            onClick={() => setDrawerOpen(false)}
          />
        </aside>
      </div>

      <header className="sticky top-0 z-[1100] flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
        <IconButton
          icon={MenuIcon}
          label="Open menu"
          className="lg:hidden"
          onClick={() => setDrawerOpen(true)}
        />
        <div className="flex-1" />
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
          notifications={notifications.data}
          unreadCount={notifications.unreadCount}
          onMarkRead={notifications.markRead}
          onMarkAllRead={notifications.markAllRead}
          desktopAlerts={alerts.permission}
          onEnableDesktopAlerts={() => void alerts.requestPermission()}
        />
        <Popover
          className="w-56 p-1.5"
          trigger={({ toggle, open: menuOpen }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={menuOpen}
              aria-label="Account menu"
              className="flex items-center gap-2 rounded-lg p-1 hover:bg-slate-100"
            >
              <Avatar name={displayName} size="sm" />
              <span className="hidden text-left md:block">
                <span className="block text-sm leading-tight font-medium text-slate-800">{displayName}</span>
                <span className="block text-[11px] leading-tight text-slate-500 capitalize">{role}</span>
              </span>
            </button>
          )}
        >
          {(close) => (
            <div>
              <div className="px-3 py-2">
                <p className="truncate text-sm font-medium text-slate-900">{displayName}</p>
                <p className="truncate text-xs text-slate-500">{user.email}</p>
              </div>
              <div className="my-1 h-px bg-slate-100" />
              <MenuItem
                icon={<SignOutIcon size={16} aria-hidden />}
                onClick={() => {
                  close();
                  void signOut();
                }}
              >
                Sign out
              </MenuItem>
            </div>
          )}
        </Popover>
      </header>

      <main className="px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
