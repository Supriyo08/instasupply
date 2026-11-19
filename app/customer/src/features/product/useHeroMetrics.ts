import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HEADER_BAR_HEIGHT } from './constants';

/**
 * Sizes of the product hero: the art is large (240px) but never wider than ~62% of a narrow
 * phone nor taller than 30% of a short one, so the hero stays near 45% of the screen.
 * `solidAt` is the scroll offset at which the hero has slid under the floating header.
 */
export function useHeroMetrics() {
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight } = useWindowDimensions();
  const artSize = Math.round(Math.max(160, Math.min(240, width * 0.62, windowHeight * 0.3)));
  const height = insets.top + HEADER_BAR_HEIGHT + artSize + 34;
  return { artSize, height, solidAt: height - insets.top - HEADER_BAR_HEIGHT };
}
