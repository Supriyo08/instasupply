import { STORE_SPECIALTY_ART, type Store } from '@instasupply/shared';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { ArtImage } from '@/components/ui';
import { colors, radius } from '@/theme/tokens';

/** The storefront drawing of a store: its own `imageKey`, else the one for its specialty (§12.7). */
export function storeArtKey(store: Pick<Store, 'imageKey' | 'specialty'>): string {
  return store.imageKey ?? STORE_SPECIALTY_ART[store.specialty];
}

/** Store photo, or its `store-*` drawing on a soft green panel. */
export function StoreArt({
  store,
  width,
  height,
  style,
}: {
  store: Pick<Store, 'imageKey' | 'specialty' | 'photoUrl'>;
  width: number;
  height: number;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.panel, { width, height }, style]}>
      <ArtImage
        artKey={storeArtKey(store)}
        uri={store.photoUrl}
        width={width * 0.86}
        height={height * 0.86}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    alignItems: 'center',
    backgroundColor: colors.primaryTint,
    borderRadius: radius.md,
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
