import { Stack } from 'expo-router';

import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { homeHref } from '@/features/auth/home-href';
import { useSession } from '@/features/auth/SessionProvider';

/**
 * Each onboarding step is only reachable while the session is in that state. profile → vehicle →
 * attest all belong to `needs_profile`: nothing is sent until attest calls registerDriver (MARKETPLACE §10).
 */
export default function OnboardingLayout() {
  const { status } = useSession();
  const home = homeHref(status);
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === 'needs_profile'} redirectTo={home}>
        <Stack.Screen name="profile" />
        <Stack.Screen name="vehicle" />
        <Stack.Screen name="attest" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'needs_phone'} redirectTo={home}>
        <Stack.Screen name="verify-phone" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'pending_approval'} redirectTo={home}>
        <Stack.Screen name="pending" />
      </Stack.Protected>
      <Stack.Protected
        guard={
          status === 'suspended' ||
          status === 'staff_account' ||
          status === 'shopper_account' ||
          status === 'supplier_account'
        }
        redirectTo={home}
      >
        <Stack.Screen name="account" />
      </Stack.Protected>
    </Stack>
  );
}

export { RouteErrorBoundary as ErrorBoundary };
