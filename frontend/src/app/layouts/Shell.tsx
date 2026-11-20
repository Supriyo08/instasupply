/**
 * The frame shared by the ops console and the supplier portal: fixed sidebar on large screens, a
 * drawer on small ones, a sticky header with page actions, the bell and the account menu.
 */
import { useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router';

import { Avatar } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/Button';
import { CloseIcon, MenuIcon, SignOutIcon, type IconComponent } from '@/components/ui/icons';
import { LiveStatusBar } from '@/components/ui/LiveStatus';
import { MenuItem, Popover } from '@/components/ui/Popover';
import { BrandMark } from '@/features/auth/BrandMark';
import { cn } from '@/lib/cn';

export interface NavItem {
  to: string;
  label: string;
  icon: IconComponent;
  badge?: number;
  /** Match the path exactly (the index route). */
  end?: boolean;
}

export interface NavSectionSpec {
  title: string;
  items: NavItem[];
}

export function SideNav({
  subtitle,
  sections,
  footer,
  onNavigate,
}: {
  subtitle: string;
  sections: NavSectionSpec[];
  footer?: ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex h-full flex-col bg-brand-950 text-slate-300" aria-label="Main">
      <div className="flex h-16 items-center gap-3 px-5">
        <BrandMark className="size-8" />
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold text-white">InstaSupply</p>
          <p className="truncate text-[11px] text-brand-300">{subtitle}</p>
        </div>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {sections
          .filter((section) => section.items.length > 0)
          .map((section) => (
            <div key={section.title}>
              <p className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-brand-300/70 uppercase">
                {section.title}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
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
          ))}
      </div>
      {footer}
    </nav>
  );
}

export function Shell({
  renderSidebar,
  headerStart,
  headerActions,
  account,
  onSignOut,
}: {
  /** Called twice (desktop column and mobile drawer); `close` closes the drawer after a navigation. */
  renderSidebar: (close: () => void) => ReactNode;
  headerStart?: ReactNode;
  headerActions?: ReactNode;
  account: { name: string; email: string; caption: string };
  onSignOut: () => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const close = () => setDrawerOpen(false);

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-[1200] hidden w-64 lg:block">
        {renderSidebar(() => undefined)}
      </aside>

      {/* Mobile drawer */}
      <div className={cn('fixed inset-0 z-[1300] lg:hidden', drawerOpen ? '' : 'pointer-events-none')}>
        <div
          className={cn(
            'absolute inset-0 bg-slate-900/40 transition-opacity',
            drawerOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={close}
          aria-hidden
        />
        <aside
          className={cn(
            'absolute inset-y-0 left-0 w-72 max-w-[85vw] transition-transform',
            drawerOpen ? 'translate-x-0' : '-translate-x-full',
          )}
          aria-hidden={!drawerOpen}
          inert={!drawerOpen}
        >
          {renderSidebar(close)}
          <IconButton
            icon={CloseIcon}
            label="Close menu"
            tone="inverse"
            className="absolute top-3.5 right-3"
            onClick={close}
          />
        </aside>
      </div>

      <header className="sticky top-0 z-[1100] border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
          <IconButton
            icon={MenuIcon}
            label="Open menu"
            className="lg:hidden"
            onClick={() => setDrawerOpen(true)}
          />
          <div className="flex min-w-0 flex-1 items-center gap-3">{headerStart}</div>
          {headerActions}
          <Popover
            className="w-56 p-1.5"
            trigger={({ toggle, open }) => (
              <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-label="Account menu"
                className="flex items-center gap-2 rounded-lg p-1 hover:bg-slate-100"
              >
                <Avatar name={account.name} size="sm" />
                <span className="hidden text-left md:block">
                  <span className="block text-sm leading-tight font-medium text-slate-800">
                    {account.name}
                  </span>
                  <span className="block text-[11px] leading-tight text-slate-500 capitalize">
                    {account.caption}
                  </span>
                </span>
              </button>
            )}
          >
            {(closeMenu) => (
              <div>
                <div className="px-3 py-2">
                  <p className="truncate text-sm font-medium text-slate-900">{account.name}</p>
                  <p className="truncate text-xs text-slate-500">{account.email}</p>
                </div>
                <div className="my-1 h-px bg-slate-100" />
                <MenuItem
                  icon={<SignOutIcon size={16} aria-hidden />}
                  onClick={() => {
                    closeMenu();
                    onSignOut();
                  }}
                >
                  Sign out
                </MenuItem>
              </div>
            )}
          </Popover>
        </div>
        <LiveStatusBar />
      </header>

      <main className="px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
