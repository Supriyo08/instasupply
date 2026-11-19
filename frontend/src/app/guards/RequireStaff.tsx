import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { EmptyState, PageSpinner } from '@/components/ui/Feedback';
import { ShieldIcon } from '@/components/ui/icons';
import { useAuth } from '@/features/auth/AuthProvider';

export function RequireStaff({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <PageSpinner label="Checking your session" />;
  if (status === 'signed_out') {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }
  return <>{children}</>;
}

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
