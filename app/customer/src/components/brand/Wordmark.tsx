import { Text, View } from 'react-native';

import { colors, fonts } from '@/theme/tokens';

/** "insta SUPPLY" wordmark echoing the Big Cart logo treatment (light + bold). */
export function Wordmark({ light = false, size = 30 }: { light?: boolean; size?: number }) {
  const strong = light ? colors.white : colors.primary;
  const soft = light ? 'rgba(255,255,255,0.85)' : colors.primaryDark;
  return (
    <View
      accessibilityRole="header"
      accessibilityLabel="InstaSupply"
      style={{ flexDirection: 'row', alignItems: 'baseline' }}
    >
      <Text style={{ fontFamily: fonts.regular, fontSize: size, color: soft, letterSpacing: 0.5 }}>
        insta
      </Text>
      <Text style={{ fontFamily: fonts.bold, fontSize: size, color: strong, letterSpacing: 1 }}>SUPPLY</Text>
    </View>
  );
}
