import { memo, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { sceneSvg, type SceneArtProps } from './scene-art';

/** A decorative construction scene (web): the SVG as a `data:` image, hidden from screen readers. */
export const SceneArt = memo(function SceneArt({ scene, height }: SceneArtProps) {
  const uri = useMemo(() => {
    const svg = sceneSvg(scene);
    return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
  }, [scene]);
  if (!uri) return null;
  return (
    <View style={[styles.frame, { height }]} aria-hidden pointerEvents="none">
      <Image source={{ uri }} style={styles.image} resizeMode="contain" alt="" />
    </View>
  );
});

const styles = StyleSheet.create({
  frame: { alignSelf: 'stretch' },
  image: { height: '100%', width: '100%' },
});
