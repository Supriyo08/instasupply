import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { Icon, Text, type IconName } from '@/components/ui';
import { colors, fonts, gradient, shadows, spacing } from '@/theme/tokens';

/** Gradient icon on a soft lime halo — the illustration for single-task screens. */
export function IconBadge({ icon, size = 104 }: { icon: IconName; size?: number }) {
  const core = Math.round(size * 0.66);
  return (
    <View style={[styles.halo, { width: size, height: size, borderRadius: size / 2 }]}>
      <View style={[styles.sparkle, { top: size * 0.06, right: size * 0.08 }]} />
      <View style={[styles.sparkle, styles.sparkleSmall, { bottom: size * 0.1, left: size * 0.06 }]} />
      <View style={[styles.coreShadow, { borderRadius: core / 2 }]}>
        <LinearGradient
          colors={gradient.colors}
          start={gradient.start}
          end={gradient.end}
          style={[styles.core, { width: core, height: core, borderRadius: core / 2 }]}
        >
          <Icon name={icon} size={Math.round(core * 0.42)} color={colors.white} />
        </LinearGradient>
      </View>
    </View>
  );
}

/** Centred badge, title and explanation at the top of verification and recovery screens. */
export function StepHeading({
  icon,
  title,
  subtitle,
}: {
  icon: IconName;
  title: string;
  subtitle?: ReactNode;
}) {
  const { height } = useWindowDimensions();
  return (
    <View style={styles.heading}>
      <IconBadge icon={icon} size={height < 700 ? 84 : 104} />
      <View style={styles.copy}>
        <Text variant="title" align="center" accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {subtitle ? (
          <Text color="muted" align="center">
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  copy: { gap: spacing.sm, maxWidth: 340 },
  core: { alignItems: 'center', justifyContent: 'center' },
  coreShadow: shadows.brand,
  halo: { alignItems: 'center', backgroundColor: colors.primarySoft, justifyContent: 'center' },
  heading: { alignItems: 'center', gap: spacing.xl, paddingBottom: spacing.sm, paddingTop: spacing.md },
  sparkle: {
    backgroundColor: colors.primaryLight,
    borderRadius: 5,
    height: 10,
    position: 'absolute',
    width: 10,
  },
  sparkleSmall: { borderRadius: 3, height: 6, width: 6 },
  title: { fontFamily: fonts.bold },
});
