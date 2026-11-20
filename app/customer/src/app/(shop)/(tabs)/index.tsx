import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ErrorState, Screen, SectionHeader } from '@/components/ui';
import { CategoryGrid, CategoryGridSkeleton } from '@/features/catalog/components/CategoryGrid';
import { ProductRail } from '@/features/catalog/components/ProductRail';
import { useBuyAgain, useCategories, useFeaturedProducts } from '@/features/catalog/hooks';
import { ActiveOrders } from '@/features/home/ActiveOrders';
import { FooterCards } from '@/features/home/FooterCards';
import { HomeHeader } from '@/features/home/HomeHeader';
import { PerkBanners } from '@/features/home/PerkBanners';
import { StoresCarousel } from '@/features/home/StoresCarousel';
import { useUid } from '@/features/session/SessionProvider';
import { spacing } from '@/theme/tokens';

const HOME_CATEGORIES = 8;

/**
 * Home (MARKETPLACE §7.3): jobsite switcher and search, active orders (one mini map), categories,
 * stores near you, perks, buy again, popular near you and the footer cards. Guests see everything
 * except their orders and "Buy again".
 */
export default function HomeTab() {
  const uid = useUid();
  const categories = useCategories();
  const featured = useFeaturedProducts(12);
  const buyAgain = useBuyAgain(uid);

  const refresh = () => {
    categories.retry();
    featured.retry();
    buyAgain.retry();
  };

  return (
    <Screen
      header={<HomeHeader />}
      contentStyle={styles.content}
      refreshing={categories.refreshing || featured.refreshing}
      onRefresh={refresh}
    >
      {uid ? <ActiveOrders uid={uid} /> : null}

      <View style={styles.section}>
        <SectionHeader title="Categories" onSeeAll={() => router.push('/categories')} />
        {categories.loading && categories.data.length === 0 ? (
          <CategoryGridSkeleton />
        ) : categories.error && categories.data.length === 0 ? (
          <ErrorState title="Couldn't load categories" error={categories.error} onRetry={categories.retry} />
        ) : (
          <CategoryGrid categories={categories.data.slice(0, HOME_CATEGORIES)} seeAll />
        )}
      </View>

      <StoresCarousel />
      <PerkBanners />

      {uid ? (
        <ProductRail
          title="Buy again"
          products={buyAgain.data}
          loading={buyAgain.loading}
          error={buyAgain.error}
          onRetry={buyAgain.retry}
        />
      ) : null}
      <ProductRail
        title="Popular near you"
        products={featured.data}
        loading={featured.loading}
        error={featured.error}
        onRetry={featured.retry}
        onSeeAll={() => router.push('/search')}
      />

      <FooterCards />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Room under the last card for the floating cart button of the tab bar.
  content: { gap: spacing.xxl, paddingBottom: 96 },
  section: { gap: spacing.md },
});
