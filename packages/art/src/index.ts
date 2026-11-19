import { ART, ART_KEYS, type ArtKey } from './generated';

export { ART, ART_KEYS, type ArtKey };

export function isArtKey(key: string | null | undefined): key is ArtKey {
  return !!key && (ART_KEYS as readonly string[]).includes(key);
}

/** SVG markup for an illustration, or null when the key is unknown. */
export function getArt(key: string | null | undefined): string | null {
  return isArtKey(key) ? ART[key] : null;
}

/** `data:` URI for <img src> on the web (back office). */
export function artDataUri(key: string | null | undefined): string | null {
  const svg = getArt(key);
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
}
