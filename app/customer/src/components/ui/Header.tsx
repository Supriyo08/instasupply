import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, typography } from '@/theme/tokens';

import { IconButton } from './IconButton';
import { webColumn } from './layout';
import { Text } from './Text';

/** Room for one icon button on either side of the title. */
const SIDE = 56;
const EDGE = 8;

/**
 * White top bar with a back arrow, centred title and an optional action (Big Cart pattern).
 * The right slot grows with its content (an icon button, or a text action such as "Mark all
 * read"). The title stays centred in the bar and gives up the same room on both sides.
 */
export function Header({
  title,
  right,
  onBack,
  back = true,
  transparent = false,
}: {
  title?: string;
  right?: ReactNode;
  onBack?: () => void;
  back?: boolean;
  transparent?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [rightWidth, setRightWidth] = useState(SIDE);
  return (
    <View
      style={[
        styles.header,
        { paddingTop: insets.top + 6, backgroundColor: transparent ? 'transparent' : colors.surface },
      ]}
    >
      {/* The background runs edge to edge; on the web the row keeps to the content column. */}
      <View style={[styles.row, webColumn]}>
        <View style={styles.side}>
          {back ? (
            <IconButton
              icon="arrow-left"
              label="Back"
              onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
            />
          ) : null}
        </View>
        {/* Laid over the row, not between the slots, so a wide right slot can't push it off centre. */}
        <View style={[styles.titleLayer, { paddingHorizontal: EDGE + Math.max(SIDE, rightWidth) }]}>
          <Text variant="heading" numberOfLines={1} style={styles.title}>
            {title}
          </Text>
        </View>
        <View
          style={[styles.side, styles.right]}
          onLayout={(event) => setRightWidth(Math.round(event.nativeEvent.layout.width))}
        >
          {right}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingBottom: 10 },
  right: { alignItems: 'flex-end' },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    // A bar without buttons is still as tall as its title.
    minHeight: typography.heading.lineHeight,
    paddingHorizontal: EDGE,
  },
  side: { minWidth: SIDE },
  title: { flex: 1, textAlign: 'center' },
  titleLayer: {
    alignItems: 'center',
    bottom: 0,
    flexDirection: 'row',
    left: 0,
    pointerEvents: 'none',
    position: 'absolute',
    right: 0,
    top: 0,
  },
});
