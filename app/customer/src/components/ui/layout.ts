import { Platform, type ViewStyle } from 'react-native';

/** Widest the app's content gets in a desktop browser; everything keeps to this centred column. */
export const CONTENT_MAX_WIDTH = 560;

/**
 * The centred column on the web; nothing on native. `Screen` applies it to the body and footer.
 * A bar (header, tab bar, toast) keeps its background on an outer full-width view and gives this
 * to the inner row, so its buttons line up with the content instead of the window edges.
 */
export const webColumn: ViewStyle | null =
  Platform.OS === 'web' ? { alignSelf: 'center', maxWidth: CONTENT_MAX_WIDTH, width: '100%' } : null;
