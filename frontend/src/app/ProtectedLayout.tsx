import { RequireStaff } from './guards/RequireStaff';
import { AppLayout } from './layouts/AppLayout';

export default function ProtectedLayout() {
  return (
    <RequireStaff>
      <AppLayout />
    </RequireStaff>
  );
}
