import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, statusTones, type StatusTone } from '@/theme/tokens';

import { Text } from './Text';

/** Rounded status label with a coloured dot (store-order, delivery, quote and issue statuses). */
export function StatusPill({
  label,
  tone,
  size = 'md',
  style,
}: {
  label: string;
  tone: StatusTone;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
}) {
  const { foreground, background } = statusTones[tone];
  return (
    <View style={[styles.pill, size === 'sm' ? styles.small : null, { backgroundColor: background }, style]}>
      <View style={[styles.dot, { backgroundColor: foreground }]} />
      <Text
        variant={size === 'sm' ? 'micro' : 'captionMedium'}
        numberOfLines={1}
        style={{ color: foreground }}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { borderRadius: 3, height: 6, width: 6 },
  pill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  small: { gap: 5, paddingHorizontal: 8, paddingVertical: 2 },
});
