import { useConfig } from '@instasupply/api-client/react';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ArtImage, Card, Header, Icon, Screen, Text, type IconName } from '@/components/ui';
import { MenuGroup } from '@/features/account/MenuGroup';
import { appVersion, env } from '@/lib/env';
import { colors, radius, spacing } from '@/theme/tokens';

const POINTS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'search',
    title: 'One search, local suppliers',
    body: 'Live stock and prices from lumber yards, plumbing and electrical supply houses across the GTA.',
  },
  {
    icon: 'truck',
    title: 'Delivered to your jobsite',
    body: 'Drop a pin for a new build, pick ASAP or a 2-hour window, and track every truck live.',
  },
  {
    icon: 'shopping-bag',
    title: 'Or ready for pickup',
    body: 'Skip the line: the store packs your order and you show a PIN at the counter.',
  },
  {
    icon: 'clipboard',
    title: 'Send us your material list',
    body: 'Paste it or snap a photo; we price it with our suppliers, usually within 30 minutes.',
  },
];

/** About (MARKETPLACE §7.3): what InstaSupply is, the version and the server it talks to. */
export default function AboutScreen() {
  const config = useConfig();
  const environment = config?.environment === 'development' ? ' · development server' : '';
  return (
    <Screen header={<Header title="About" />}>
      <View style={styles.hero}>
        <View style={styles.circle}>
          <ArtImage artKey="scene-local-suppliers" width={190} height={150} />
        </View>
        <Text variant="display" align="center">
          InstaSupply
        </Text>
        <Text color="muted" align="center">
          Construction supplies from local Greater Toronto Area stores, delivered to your jobsite or ready for
          pickup.
        </Text>
      </View>
      <Card style={styles.points}>
        {POINTS.map((point) => (
          <View key={point.title} style={styles.point} accessible>
            <View style={styles.icon}>
              <Icon name={point.icon} size={18} color={colors.primaryDark} />
            </View>
            <View style={styles.flex}>
              <Text variant="bodyMedium">{point.title}</Text>
              <Text variant="caption" color="muted">
                {point.body}
              </Text>
            </View>
          </View>
        ))}
      </Card>
      <MenuGroup
        items={[
          { key: 'help', icon: 'help-circle', label: 'Help & FAQ', onPress: () => router.push('/help') },
          {
            key: 'suggest',
            icon: 'plus-square',
            label: 'Suggest a store',
            onPress: () => router.push('/suggest-store'),
          },
        ]}
      />
      <Text variant="micro" color="subtle" align="center">
        Version {appVersion}
        {env.variant !== 'production' ? ` (${env.variant})` : ''}
        {environment}
        {config?.hstNumber ? ` · HST no. ${config.hstNumber}` : ''}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    backgroundColor: colors.primaryTint,
    borderRadius: radius.pill,
    height: 200,
    justifyContent: 'center',
    width: 200,
  },
  flex: { flex: 1, gap: 1 },
  hero: { alignItems: 'center', gap: spacing.sm },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  point: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md },
  points: { gap: spacing.lg },
});
