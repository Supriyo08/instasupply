import { Stack } from 'expo-router';
import { useRef } from 'react';

import { homeHref, useSession, type SessionStatus } from '@/features/session/SessionProvider';

/** Each setup step is only reachable in its session state. */
export default function SetupLayout() {
  const { status } = useSession();
  // Like the root layout, guard on the last settled state: a brief 'loading' (e.g. while the role
  // claim refreshes) must not bounce between '/' and this group. The root shows the splash meanwhile.
  const settled = useRef<SessionStatus>(status);
  if (status !== 'loading') settled.current = status;
  const current = settled.current;
  const home = homeHref(current);
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={current === 'needs_profile'} redirectTo={home}>
        <Stack.Screen name="complete-profile" />
      </Stack.Protected>
      <Stack.Protected guard={current === 'needs_phone'} redirectTo={home}>
        <Stack.Screen name="verify-phone" />
        <Stack.Screen name="verify-code" />
      </Stack.Protected>
      <Stack.Protected guard={current === 'wrong_account'} redirectTo={home}>
        <Stack.Screen name="wrong-account" />
      </Stack.Protected>
    </Stack>
  );
}
