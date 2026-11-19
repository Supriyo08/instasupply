import { Outlet } from 'react-router';

import { RequireAdmin } from './guards/RequireStaff';

export default function AdminOutlet() {
  return (
    <RequireAdmin>
      <Outlet />
    </RequireAdmin>
  );
}
