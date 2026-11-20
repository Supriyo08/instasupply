import { Tabs } from 'expo-router';

import { ShopTabBar } from '@/components/navigation/ShopTabBar';

/** Home · Stores · Orders · Account, plus the floating cart button (MARKETPLACE §7.2). */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <ShopTabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="stores" options={{ title: 'Stores' }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders' }} />
      <Tabs.Screen name="account" options={{ title: 'Account' }} />
    </Tabs>
  );
}
