import { Stack } from 'expo-router';

// `anchor` replaces the deprecated `initialRouteName`: deep links into login/sign-up keep the
// welcome screen underneath, so "back" has somewhere to go.
export const unstable_settings = { anchor: 'welcome' };

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="forgot-password" />
    </Stack>
  );
}
