import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { sceneSvg, type SceneArtProps } from './scene-art';

/**
 * A decorative construction scene (Android and iOS). The app has no SVG renderer of its own, so the
 * markup is drawn by a static, script-free WebView that never navigates. It is hidden from screen
 * readers: every screen says in words what the picture shows.
 */
export const SceneArt = memo(function SceneArt({ scene, height }: SceneArtProps) {
  const html = useMemo(() => {
    const svg = sceneSvg(scene);
    return svg
      ? `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">` +
          `<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:transparent}` +
          `svg{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`
      : null;
  }, [scene]);
  if (!html) return null;
  return (
    <View
      style={[styles.frame, { height }]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <WebView
        source={{ html }}
        style={styles.web}
        originWhitelist={['about:blank']}
        onShouldStartLoadWithRequest={(request) => request.url === 'about:blank'}
        javaScriptEnabled={false}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        setSupportMultipleWindows={false}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  frame: { alignSelf: 'stretch', overflow: 'hidden' },
  web: { backgroundColor: 'transparent', flex: 1 },
});
