import { Stack } from 'expo-router';

import { homeHref } from '@/features/auth/home-href';
import { useSession } from '@/features/auth/SessionProvider';

/** Each onboarding step is only reachable while the session is in that state. */
export default function OnboardingLayout() {
  const { status } = useSession();
  const home = homeHref(status);
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={status === 'needs_profile'} redirectTo={home}>
        <Stack.Screen name="profile" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'needs_phone'} redirectTo={home}>
        <Stack.Screen name="verify-phone" />
      </Stack.Protected>
      <Stack.Protected guard={status === 'pending_approval'} redirectTo={home}>
        <Stack.Screen name="pending" />
      </Stack.Protected>
      <Stack.Protected
        guard={status === 'suspended' || status === 'staff_account' || status === 'shopper_account'}
        redirectTo={home}
      >
        <Stack.Screen name="account" />
      </Stack.Protected>
    </Stack>
  );
}
