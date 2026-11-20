import { Outlet } from 'react-router';

import { AuthProvider } from '@/features/auth/AuthProvider';

/** Root of everything that has a session: sign-in pages, the ops console and the supplier portal. */
export default function StaffRoot() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}
