import { RequireStaff } from './guards/guards';
import { AppLayout } from './layouts/AppLayout';

export default function ProtectedLayout() {
  return (
    <RequireStaff>
      <AppLayout />
    </RequireStaff>
  );
}
