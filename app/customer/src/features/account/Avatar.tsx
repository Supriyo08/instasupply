import { initials } from '@instasupply/shared';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, fonts, gradient, shadows } from '@/theme/tokens';

/** Initials on the brand gradient inside a white ring, with an optional edit badge. */
export function Avatar({ name, size = 96, onEdit }: { name: string; size?: number; onEdit?: () => void }) {
  const ring = Math.max(3, Math.round(size / 26));
  const badge = Math.round(size * 0.3);
  return (
    <View
      style={[
        styles.ring,
        shadows.soft,
        { width: size, height: size, borderRadius: size / 2, padding: ring },
      ]}
    >
      <LinearGradient
        colors={gradient.colors}
        start={gradient.start}
        end={gradient.end}
        style={[styles.fill, { borderRadius: size / 2 }]}
      >
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[
            styles.initials,
            { fontSize: Math.round(size * 0.34), lineHeight: Math.round(size * 0.44) },
          ]}
        >
          {initials(name)}
        </Text>
      </LinearGradient>
      {onEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
          hitSlop={8}
          onPress={onEdit}
          style={({ pressed }) => [
            styles.badge,
            { width: badge, height: badge, borderRadius: badge / 2, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Icon name="edit-2" size={Math.round(badge * 0.45)} color={colors.white} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.surface,
    borderWidth: 2,
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
  },
  fill: { alignItems: 'center', flex: 1, justifyContent: 'center' },
  initials: {
    color: colors.white,
    fontFamily: fonts.semibold,
    letterSpacing: 1,
    textShadowColor: colors.primaryDark,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  ring: { backgroundColor: colors.surface },
});
