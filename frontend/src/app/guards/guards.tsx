/**
 * Route guards of the console (docs/CLIENTS.md §2.7). Staff pages sit under `RequireStaff`, portal
 * pages under `RequireSupplier`; the two redirect each other's role so a bookmark always lands on
 * the right side.
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { Button } from '@/components/ui/Button';
import { EmptyState, PageSpinner } from '@/components/ui/Feedback';
import { RefreshIcon, ShieldIcon, WarningIcon } from '@/components/ui/icons';
import { useAuth } from '@/features/auth/AuthProvider';
import { describeError } from '@/lib/api';

/** Splash while the stored session is restored; "Can't reach the server" when that cannot finish (§2.1). */
export function SessionSplash() {
  const { problem, retry, signOut } = useAuth();
  if (!problem) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <PageSpinner label="Checking your session" />
      </div>
    );
  }
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <EmptyState
        icon={WarningIcon}
        title="Can't reach the server"
        description={describeError(problem)}
        action={
          <div className="flex flex-col items-center gap-3">
            <Button icon={RefreshIcon} onClick={retry}>
              Try again
            </Button>
            <button
              type="button"
              className="text-sm font-medium text-slate-500 hover:text-slate-700"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        }
      />
    </div>
  );
}

function useLoginRedirect() {
  const location = useLocation();
  return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
}

/** Admins and dispatchers. Suppliers are sent to `/portal`. */
export function RequireStaff({ children }: { children: ReactNode }) {
  const { status, isSupplier } = useAuth();
  const toLogin = useLoginRedirect();
  if (status === 'loading') return <SessionSplash />;
  if (status === 'signed_out') return toLogin;
  if (isSupplier) return <Navigate to="/portal" replace />;
  return <>{children}</>;
}

/** Suppliers with a store. Staff are sent to `/`. */
export function RequireSupplier({ children }: { children: ReactNode }) {
  const { status, isStaff } = useAuth();
  const toLogin = useLoginRedirect();
  if (status === 'loading') return <SessionSplash />;
  if (status === 'signed_out') return toLogin;
  if (isStaff) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Inside `RequireStaff`: administrators only (Team, payout runs). */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) {
    return (
      <EmptyState
        icon={ShieldIcon}
        title="Administrators only"
        description="Ask an administrator if you need access to this page."
      />
    );
  }
  return <>{children}</>;
}

/** Inside `RequireSupplier`: store owners only (Payouts, Insights, Team). */
export function RequireStoreOwner({ children }: { children: ReactNode }) {
  const { isStoreOwner } = useAuth();
  if (!isStoreOwner) {
    return (
      <EmptyState
        icon={ShieldIcon}
        title="Store owners only"
        description="Ask the owner of your store if you need this page."
      />
    );
  }
  return <>{children}</>;
}
