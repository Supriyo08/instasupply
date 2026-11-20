import { CATEGORIES, CATEGORY_IDS } from '@instasupply/shared';
import { Platform } from 'react-native';

import { colors } from '@/theme/tokens';

/** Height of the shared <Header /> below the status bar (6 + 40px button + 10). */
export const HEADER_BAR_HEIGHT = 56;

/** Native-driven animations are not available on web. */
export const NATIVE_DRIVER = Platform.OS !== 'web';

/** The bulk chips next to the quantity stepper (MARKETPLACE §7.3 product row). */
export const BULK_STEPS = [10, 25, 50] as const;

const AVATAR_TINTS = CATEGORY_IDS.map((id) => CATEGORIES[id].tint);

/** A stable pastel for someone's initials avatar (review authors). */
export function avatarTint(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length] ?? colors.primarySoft;
}
