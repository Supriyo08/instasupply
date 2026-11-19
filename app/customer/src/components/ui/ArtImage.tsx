import { getArt } from '@instasupply/art';
import { Image } from 'expo-image';
import { memo, useId, useMemo } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { colors } from '@/theme/tokens';

import { Icon } from './Icon';

/**
 * On the web every inline SVG shares the page's id namespace: a second copy of an illustration
 * (the same product twice, or a hidden stack screen behind the visible one) would resolve
 * `url(#gradient)` to the first copy and lose its fills when that copy is hidden. Suffixing the ids
 * per instance keeps each copy self-contained.
 */
function scopeSvgIds(xml: string, instanceId: string): string {
  const suffix = instanceId.replace(/[^A-Za-z0-9_-]/g, '');
  return xml
    .replace(/(\s)id="([^"]+)"/g, `$1id="$2-${suffix}"`)
    .replace(/url\(#([^)]+)\)/g, `url(#$1-${suffix})`)
    .replace(/href="#([^"]+)"/g, `href="#$1-${suffix}"`);
}

/**
 * Renders a product/category/scene illustration from @instasupply/art by key, or an uploaded
 * photo when `uri` is set. Falls back to a neutral placeholder.
 */
export const ArtImage = memo(function ArtImage({
  artKey,
  uri,
  size,
  width,
  height,
  style,
}: {
  artKey?: string | null;
  uri?: string | null;
  size?: number;
  width?: number;
  height?: number;
  style?: ViewStyle;
}) {
  const instanceId = useId();
  const xml = useMemo(() => {
    const art = getArt(artKey);
    return art && Platform.OS === 'web' ? scopeSvgIds(art, instanceId) : art;
  }, [artKey, instanceId]);
  const w = width ?? size ?? 120;
  const h = height ?? size ?? 120;
  if (uri) {
    return (
      <View style={[{ width: w, height: h }, style]}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={150} />
      </View>
    );
  }
  if (xml) {
    return (
      <View
        style={[{ width: w, height: h }, style]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        <SvgXml xml={xml} width="100%" height="100%" />
      </View>
    );
  }
  return (
    <View style={[styles.placeholder, { width: w, height: h }, style]}>
      <Icon name="shopping-bag" size={Math.min(w, h) * 0.35} color={colors.textSubtle} />
    </View>
  );
});

const styles = StyleSheet.create({ placeholder: { alignItems: 'center', justifyContent: 'center' } });
