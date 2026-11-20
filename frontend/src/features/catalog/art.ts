/**
 * Illustrations from @instasupply/art for the catalogue screens. The art set is generated from SVG
 * files and changes over time, so the key lists are derived at runtime. The package bundles every
 * illustration: only catalogue and order screens import it (they are lazy-loaded routes).
 */
import { ART_KEYS, artDataUri, isArtKey } from '@instasupply/art';
import { CATEGORY_IDS } from '@instasupply/shared';

const ALL_KEYS: readonly string[] = ART_KEYS;

/**
 * Illustrations left over from the grocery app (MARKETPLACE §12.7 retires them). They are hidden from
 * the pickers so a construction listing never gets a banana; a product that still uses one keeps it.
 */
const GROCERY_ART = new Set([
  'apple',
  'avocado',
  'baby-lotion',
  'banana',
  'bell-pepper',
  'bread',
  'broccoli',
  'carrot',
  'cheese',
  'coconut-water',
  'cold-coffee',
  'cucumber',
  'detergent',
  'diapers',
  'dish-soap',
  'eggs',
  'grapes',
  'green-tea',
  'lemon',
  'mango',
  'milk',
  'olive-oil',
  'onion',
  'orange-juice',
  'orange',
  'peach',
  'pineapple',
  'pomegranate',
  'potato',
  'rice',
  'spinach',
  'strawberry',
  'sunflower-oil',
  'tissue-roll',
  'tomato',
  'watermelon',
]);

/** Product illustrations: not scenes, stores, category icons, brand marks or grocery leftovers. */
export const PRODUCT_ART_KEYS: readonly string[] = ALL_KEYS.filter(
  (key) => !/^(?:hero|scene|store|cat|brand)-/.test(key) && key !== 'mark' && !GROCERY_ART.has(key),
);

/** Category icons: `cat-<id>` for the marketplace categories of shared that have artwork. */
export const CATEGORY_ART_KEYS: readonly string[] = CATEGORY_IDS.map((id) => `cat-${id}`).filter((key) =>
  isArtKey(key),
);

const uris = new Map<string, string | null>();

/** `data:` URI for an illustration (cached), or null when the key is not in the current art set. */
export function artSrc(key: string | null | undefined): string | null {
  if (!key) return null;
  let uri = uris.get(key);
  if (uri === undefined) {
    uri = artDataUri(key);
    uris.set(key, uri);
  }
  return uri;
}

/** "paint-roller-kit" → "Paint roller kit", "cat-wood" → "Wood". */
export function artLabel(key: string): string {
  const words = key.replace(/^cat-/, '').replace(/-+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
