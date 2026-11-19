import { formatRelativeTime } from '@instasupply/shared';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { Banner, Card, Text } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';

import { usePresence } from './PresenceProvider';

export function OnlineCard() {
  const { colors } = useTheme();
  const { online, busy, error, lastFix, backgroundEnabled, permission, setOnline } = usePresence();

  const subtitle = online
    ? lastFix
      ? `Sharing live location · updated ${formatRelativeTime(lastFix.at)}`
      : 'Getting your location…'
    : 'Go online to share your location and receive live updates.';

  return (
    <Card accent={online ? colors.success : undefined}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: online ? colors.success : colors.textSubtle }]} />
        <View style={styles.text}>
          <Text variant="heading">{online ? "You're online" : "You're offline"}</Text>
          <Text variant="caption" color="muted">
            {subtitle}
          </Text>
        </View>
        <Switch
          accessibilityLabel={online ? 'Go offline' : 'Go online'}
          value={online}
          disabled={busy}
          onValueChange={(value) => void setOnline(value)}
          trackColor={{ true: colors.success, false: colors.border }}
          thumbColor={Platform.OS === 'android' ? colors.surface : undefined}
        />
      </View>
      {error && permission !== 'denied' ? (
        <View style={styles.banner}>
          <Banner tone="danger" message={error} />
        </View>
      ) : null}
      {permission === 'denied' ? (
        <View style={styles.banner}>
          <Banner tone="warning" message="Location access is off. Enable it in Settings to go online." />
        </View>
      ) : null}
      {online && !backgroundEnabled && Platform.OS !== 'web' ? (
        <Text variant="caption" color="subtle" style={styles.hint}>
          Keep the app open while driving — background tracking needs the installed app build.
        </Text>
      ) : null}
      {online && Platform.OS === 'web' ? (
        <Text variant="caption" color="subtle" style={styles.hint}>
          Keep this tab open while you drive so dispatch can see you.
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  banner: { marginTop: 12 },
  dot: { borderRadius: 6, height: 12, width: 12 },
  hint: { marginTop: 10 },
  row: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  text: { flex: 1, gap: 2 },
});
