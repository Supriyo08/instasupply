import { Outlet } from 'react-router';

import { RequireStoreOwner } from '@/app/guards/guards';

export default function OwnerOutlet() {
  return (
    <RequireStoreOwner>
      <Outlet />
    </RequireStoreOwner>
  );
}
