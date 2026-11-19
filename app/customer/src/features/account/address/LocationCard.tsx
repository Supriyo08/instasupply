import type { LatLng } from '@instasupply/shared';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Icon, IconButton, Text } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

/** "Use my current location" card; once pinned it shows the coordinates and a clear button. */
export function LocationCard({
  location,
  locating,
  error,
  onLocate,
  onClear,
}: {
  location: LatLng | null;
  locating: boolean;
  error?: string;
  onLocate: () => void;
  onClear: () => void;
}) {
  const pinned = !!location;
  return (
    <View style={[styles.card, error ? styles.cardError : null]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={pinned ? 'Update my current location' : 'Use my current location'}
        accessibilityState={{ busy: locating, disabled: locating }}
        disabled={locating}
        onPress={onLocate}
        style={({ pressed }) => [styles.main, pressed ? styles.pressed : null]}
      >
        <View style={[styles.icon, pinned ? styles.iconPinned : null]}>
          <Icon
            name={pinned ? 'map-pin' : 'crosshair'}
            size={20}
            color={pinned ? colors.white : colors.primary}
          />
        </View>
        <View style={styles.text}>
          <Text variant="bodyMedium" color="primary">
            {locating ? 'Finding you…' : pinned ? 'Location pinned' : 'Use my current location'}
          </Text>
          <Text variant="caption" color={error ? 'danger' : 'muted'} numberOfLines={2}>
            {error ??
              (pinned
                ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)} · tap to update`
                : 'Pin your doorstep so the driver finds you faster.')}
          </Text>
        </View>
        {locating ? <ActivityIndicator color={colors.primary} /> : null}
      </Pressable>
      {pinned && !locating ? (
        <IconButton
          icon="x"
          label="Remove pinned location"
          color={colors.textMuted}
          size={36}
          onPress={onClear}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    flexDirection: 'row',
    paddingRight: 8,
  },
  cardError: { borderColor: colors.danger },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  iconPinned: { backgroundColor: colors.primary },
  main: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 14, padding: 14 },
  pressed: { opacity: 0.7 },
  text: { flex: 1, gap: 1 },
});
