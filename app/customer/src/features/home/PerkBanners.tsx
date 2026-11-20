import {
  FIRST_ORDER_DISCOUNT_CENTS,
  FIRST_ORDER_DISCOUNT_MIN_ITEMS_CENTS,
  FREE_DELIVERY_MIN_ITEMS_CENTS,
} from '@instasupply/shared';
import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ArtImage, Text } from '@/components/ui';
import { useIsFirstOrder } from '@/features/orders/hooks';
import { colors, radius, spacing } from '@/theme/tokens';

/** Whole dollars for banner copy: 25000 → "$250". */
function dollars(cents: number): string {
  return '$' + String(Math.round(cents / 100));
}

interface Perk {
  key: string;
  title: string;
  body: string;
  art: string;
  href: Href;
  tint: string;
  firstOrderOnly: boolean;
}

const PERKS: readonly Perk[] = [
  {
    key: 'first-delivery',
    title: '$0 delivery fee on your first order',
    body: 'From any nearby store, to your jobsite.',
    art: 'scene-jobsite-delivery',
    href: '/categories',
    tint: colors.primarySoft,
    firstOrderOnly: true,
  },
  {
    key: 'first-discount',
    title: `First order ${dollars(FIRST_ORDER_DISCOUNT_MIN_ITEMS_CENTS)}+? ${dollars(FIRST_ORDER_DISCOUNT_CENTS)} off`,
    body: 'Taken off at checkout, no code needed.',
    art: 'scene-order-confirmed',
    href: '/categories',
    tint: colors.warningSoft,
    firstOrderOnly: true,
  },
  {
    key: 'free-delivery',
    title: `Free delivery on orders over ${dollars(FREE_DELIVERY_MIN_ITEMS_CENTS)}`,
    body: 'Counted across every store in the order.',
    art: 'scene-local-suppliers',
    href: '/stores',
    tint: colors.infoSoft,
    firstOrderOnly: false,
  },
  {
    key: 'material-list',
    title: 'Send us your material list',
    body: 'Type it, paste it or snap a photo. We quote it.',
    art: 'scene-material-list',
    href: '/quotes/new',
    tint: colors.primaryTint,
    firstOrderOnly: false,
  },
];

/** The perk banners of Home; the first-order ones only until the first order. */
export function PerkBanners() {
  const firstOrder = useIsFirstOrder();
  const perks = PERKS.filter((perk) => firstOrder || !perk.firstOrderOnly);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bleed}
      contentContainerStyle={styles.row}
    >
      {perks.map((perk) => (
        <Pressable
          key={perk.key}
          accessibilityRole="button"
          accessibilityLabel={`${perk.title}. ${perk.body}`}
          onPress={() => router.push(perk.href)}
          style={({ pressed }) => [
            styles.banner,
            { backgroundColor: perk.tint },
            pressed ? styles.pressed : null,
          ]}
        >
          <View style={styles.copy}>
            <Text variant="heading" numberOfLines={3}>
              {perk.title}
            </Text>
            <Text variant="caption" color="muted" numberOfLines={2}>
              {perk.body}
            </Text>
          </View>
          <ArtImage artKey={perk.art} width={104} height={92} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'center',
    borderRadius: radius.lg,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 124,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    width: 300,
  },
  bleed: { marginHorizontal: -spacing.gutter },
  copy: { flex: 1, gap: spacing.xs },
  pressed: { opacity: 0.85 },
  row: { gap: spacing.md, paddingHorizontal: spacing.gutter },
});
