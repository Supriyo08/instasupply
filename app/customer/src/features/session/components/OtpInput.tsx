import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

import { USE_NATIVE_DRIVER, useReducedMotion } from './motion';

export const CODE_LENGTH = 6;

/**
 * Six digit boxes driven by one transparent TextInput laid over them, so taps, paste and SMS
 * one-time-code autofill (iOS/Android/web) all work natively.
 */
export function OtpInput({
  value,
  onChange,
  invalid = false,
  disabled = false,
}: {
  value: string;
  onChange: (code: string) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const shake = useShake(invalid);
  const current = Math.min(value.length, CODE_LENGTH - 1);

  return (
    <Animated.View style={[styles.row, { transform: [{ translateX: shake }] }]}>
      {Array.from({ length: CODE_LENGTH }, (_, index) => {
        const digit = value[index];
        const active = focused && !disabled && index === current;
        return (
          <View
            key={index}
            style={[
              styles.box,
              digit ? styles.boxFilled : null,
              active ? styles.boxActive : null,
              invalid ? styles.boxInvalid : null,
            ]}
          >
            {digit ? (
              <Text variant="title">{digit}</Text>
            ) : active ? (
              <Caret />
            ) : (
              <View style={styles.placeholder} />
            )}
          </View>
        );
      })}
      <TextInput
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, CODE_LENGTH))}
        maxLength={CODE_LENGTH}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        autoFocus
        caretHidden
        editable={!disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel="Verification code"
        accessibilityHint={`Enter the ${CODE_LENGTH}-digit code from the text message`}
        style={styles.input}
      />
    </Animated.View>
  );
}

function useShake(trigger: boolean) {
  const offset = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (!trigger || reduceMotion) return;
    const step = (toValue: number) =>
      Animated.timing(offset, { toValue, duration: 55, useNativeDriver: USE_NATIVE_DRIVER });
    Animated.sequence([step(-9), step(9), step(-6), step(6), step(0)]).start();
  }, [trigger, reduceMotion, offset]);
  return offset;
}

function Caret() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 450,
          delay: 300,
          useNativeDriver: USE_NATIVE_DRIVER,
        }),
        Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: USE_NATIVE_DRIVER }),
      ]),
    );
    blink.start();
    return () => blink.stop();
  }, [opacity]);
  return <Animated.View style={[styles.caret, { opacity }]} />;
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    aspectRatio: 1,
    backgroundColor: colors.surface,
    borderColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    flex: 1,
    justifyContent: 'center',
    maxWidth: 56,
  },
  boxActive: { borderColor: colors.primary },
  boxFilled: { borderColor: colors.primaryLight },
  boxInvalid: { borderColor: colors.danger },
  caret: { backgroundColor: colors.primary, borderRadius: 1, height: 22, width: 2 },
  // Covers the boxes so a tap anywhere focuses it; invisible but still focusable and autofillable.
  input: { ...StyleSheet.absoluteFill, color: 'transparent', opacity: 0 },
  placeholder: { backgroundColor: colors.textSubtle, borderRadius: 3, height: 6, width: 6 },
  row: { flexDirection: 'row', gap: spacing.sm + 2, justifyContent: 'center' },
});
