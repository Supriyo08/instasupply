/**
 * Illustrations from @instasupply/art for the catalogue screens. The art set is generated from SVG
 * files and changes over time, so the key lists are derived at runtime and never hard-coded.
 * The package bundles every illustration: only catalogue screens (and order details) import it.
 */
import { ART_KEYS, artDataUri } from '@instasupply/art';

const ALL_KEYS: readonly string[] = ART_KEYS;

/** Product illustrations: everything except scenes (hero-), category icons (cat-) and brand marks. */
export const PRODUCT_ART_KEYS: readonly string[] = ALL_KEYS.filter(
  (key) => !/^(?:hero|cat|brand)-/.test(key),
);

/** Category icons. */
export const CATEGORY_ART_KEYS: readonly string[] = ALL_KEYS.filter((key) => key.startsWith('cat-'));

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

/** "orange-juice" → "Orange juice", "cat-edible-oil" → "Edible oil". */
export function artLabel(key: string): string {
  const words = key.replace(/^cat-/, '').replace(/-+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
