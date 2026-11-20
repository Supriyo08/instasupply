import { Outlet } from 'react-router';

import { RequireAdmin } from './guards/guards';

export default function AdminOutlet() {
  return (
    <RequireAdmin>
      <Outlet />
    </RequireAdmin>
  );
}
