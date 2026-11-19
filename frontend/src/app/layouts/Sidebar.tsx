import { NavLink } from 'react-router';

import {
  CatalogIcon,
  DashboardIcon,
  InboxIcon,
  MapIcon,
  MessagesIcon,
  OrdersIcon,
  PackageIcon,
  TruckIcon,
  UsersIcon,
  type IconComponent,
} from '@/components/ui/icons';
import { BrandMark } from '@/features/auth/BrandMark';
import { cn } from '@/lib/cn';
import { env } from '@/lib/env';

interface NavItem {
  to: string;
  label: string;
  icon: IconComponent;
  badge?: number;
  end?: boolean;
}

export function Sidebar({
  isAdmin,
  pendingDrivers,
  unreadMessages,
  unassigned,
  newOrders,
  onNavigate,
}: {
  isAdmin: boolean;
  pendingDrivers: number;
  unreadMessages: number;
  unassigned: number;
  newOrders: number;
  onNavigate?: () => void;
}) {
  const operations: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: DashboardIcon, end: true },
    { to: '/live', label: 'Live map', icon: MapIcon },
    { to: '/deliveries', label: 'Deliveries', icon: PackageIcon, badge: unassigned },
    { to: '/drivers', label: 'Drivers', icon: TruckIcon, badge: pendingDrivers },
    { to: '/messages', label: 'Messages', icon: MessagesIcon, badge: unreadMessages },
  ];
  const store: NavItem[] = [
    { to: '/orders', label: 'Orders', icon: OrdersIcon, badge: newOrders },
    { to: '/catalog', label: 'Catalog', icon: CatalogIcon },
  ];
  const admin: NavItem[] = [
    ...(isAdmin ? [{ to: '/team', label: 'Team', icon: UsersIcon }] : []),
    ...(env.useEmulators ? [{ to: '/outbox', label: 'Dev SMS outbox', icon: InboxIcon }] : []),
  ];

  return (
    <nav className="flex h-full flex-col bg-brand-950 text-slate-300" aria-label="Main">
      <div className="flex h-16 items-center gap-3 px-5">
        <BrandMark className="size-8" />
        <div className="leading-tight">
          <p className="text-sm font-semibold text-white">InstaSupply</p>
          <p className="text-[11px] text-brand-300">Dispatch console</p>
        </div>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        <NavSection title="Operations" items={operations} onNavigate={onNavigate} />
        <NavSection title="Store" items={store} onNavigate={onNavigate} />
        {admin.length ? <NavSection title="Workspace" items={admin} onNavigate={onNavigate} /> : null}
      </div>

      {env.useEmulators ? (
        <div className="m-3 rounded-xl bg-white/5 p-3 text-[11px] text-brand-200 ring-1 ring-white/10">
          Connected to the <span className="font-semibold text-white">local emulators</span>. Data is not
          real.
        </div>
      ) : null}
    </nav>
  );
}

function NavSection({
  title,
  items,
  onNavigate,
}: {
  title: string;
  items: NavItem[];
  onNavigate?: () => void;
}) {
  return (
    <div>
      <p className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-brand-300/70 uppercase">
        {title}
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white',
                )
              }
            >
              <item.icon size={18} aria-hidden />
              <span className="flex-1">{item.label}</span>
              {item.badge ? (
                <span className="rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-white">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              ) : null}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
