import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';

import { Icon, type IconName } from '@/components/ui';
import { useDriver } from '@/features/auth/SessionProvider';
import { useThread } from '@/features/chat/hooks';
import { useTheme } from '@/theme/ThemeProvider';

const icon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue | null; size: number }) => (
    // Tint colours are always plain strings here.
    <Icon name={name} size={size} color={typeof color === 'string' ? color : undefined} />
  );

export default function TabsLayout() {
  const { user } = useDriver();
  const { colors } = useTheme();
  const thread = useThread(user.uid);
  const unreadChat = thread.data?.unreadByDriver ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSubtle,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('today-outline') }} />
      <Tabs.Screen name="route" options={{ title: 'Route', tabBarIcon: icon('map-outline') }} />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Dispatch',
          tabBarIcon: icon('chatbubbles-outline'),
          tabBarBadge: unreadChat > 0 ? unreadChat : undefined,
        }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}
