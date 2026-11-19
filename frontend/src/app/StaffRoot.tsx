import { Outlet } from 'react-router';

import { AuthProvider } from '@/features/auth/AuthProvider';

/** Root of the signed-in console. Lazy-loaded so the public tracking page never ships auth code. */
export default function StaffRoot() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}
