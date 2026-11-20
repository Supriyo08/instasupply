import { getArt, type ArtKey } from '@instasupply/art';

/**
 * The construction scenes of `@instasupply/art` the driver app shows (MARKETPLACE §12.7). Grocery-era
 * keys (`hero-*`, fruit, the empty cart) are left out on purpose, so they cannot come back by accident.
 */
export type SceneKey = Exclude<Extract<ArtKey, `scene-${string}` | `store-${string}`>, 'scene-empty-cart'>;

export interface SceneArtProps {
  scene: SceneKey;
  /** Height in points; the drawing keeps its proportions inside it. */
  height: number;
}

/** The SVG markup of a scene, or null when the art package does not have it. */
export function sceneSvg(scene: SceneKey): string | null {
  return getArt(scene);
}
