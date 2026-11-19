import { LinearGradient } from 'expo-linear-gradient';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ArtImage } from '@/components/ui/ArtImage';
import { colors, gradient } from '@/theme/tokens';

import { Wordmark } from './Wordmark';

/** Brand splash shown while fonts and the session load. */
export function Splash() {
  return (
    <LinearGradient colors={gradient.colors} start={gradient.start} end={gradient.end} style={styles.fill}>
      <View style={styles.center}>
        <View style={styles.badge}>
          <ArtImage artKey="mark" size={92} />
        </View>
        <Wordmark light />
        <ActivityIndicator color={colors.white} style={styles.spinner} />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: 34,
    height: 120,
    justifyContent: 'center',
    width: 120,
  },
  center: { alignItems: 'center', gap: 18 },
  fill: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  spinner: { marginTop: 12 },
});
