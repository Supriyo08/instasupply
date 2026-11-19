import type { Product } from '@instasupply/shared';
import { Platform } from 'react-native';

import { colors, productBackdrops } from '@/theme/tokens';

/** Height of the shared <Header /> below the status bar (6 + 40px button + 10). */
export const HEADER_BAR_HEIGHT = 56;

/** Native-driven animations are not available on web. */
export const NATIVE_DRIVER = Platform.OS !== 'web';

/** At or below this stock a product shows an "only n left" hint. */
export const LOW_STOCK = 10;

/** Pastel colour placed behind a product's art (same palette as ProductCard). */
export function backdropFor(categoryId: string | null | undefined): string {
  return (categoryId ? productBackdrops[categoryId] : undefined) ?? colors.primaryTint;
}

/** Orderable right now (listed and in stock). */
export function isAvailable(product: Pick<Product, 'active' | 'stock'>): boolean {
  return product.active && product.stock > 0;
}

const AVATAR_TINTS = Object.values(productBackdrops);

/** A stable pastel for someone's initials avatar. */
export function avatarTint(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length] ?? colors.primarySoft;
}
