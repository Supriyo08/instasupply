import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Screen, SectionHeader } from '@/components/ui';
import { CategoryRow } from '@/features/catalog/components/CategoryRow';
import { FEATURED_LISTING_ID } from '@/features/catalog/components/constants';
import { FeaturedProducts } from '@/features/catalog/components/FeaturedProducts';
import { HomeTopBar } from '@/features/catalog/components/HomeTopBar';
import { PromoCarousel } from '@/features/catalog/components/PromoCarousel';
import { SearchBarButton } from '@/features/catalog/components/SearchBarButton';
import { usePromoBanners } from '@/features/catalog/components/usePromoBanners';
import { useCustomer } from '@/features/session/SessionProvider';
import { spacing } from '@/theme/tokens';

/** Home tab (Big Cart): search, promo carousel, category circles and featured products. */
export default function HomeScreen() {
  const { user, profile } = useCustomer();
  const banners = usePromoBanners(user.uid);

  return (
    <Screen safeTop contentStyle={styles.content}>
      <HomeTopBar uid={user.uid} name={profile.displayName} />
      <SearchBarButton />
      <PromoCarousel banners={banners} />

      <View style={styles.section}>
        <SectionHeader title="Categories" onSeeAll={() => router.push('/categories')} />
        <CategoryRow />
      </View>

      <View style={styles.section}>
        <SectionHeader
          title="Featured products"
          onSeeAll={() => router.push(`/category/${FEATURED_LISTING_ID}`)}
        />
        <FeaturedProducts />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Clears the tab bar's floating cart button, which overlaps the bottom of the content.
  content: { gap: spacing.xl, paddingBottom: 72 },
  section: { gap: spacing.md },
});
