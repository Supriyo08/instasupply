import { useState, type ReactNode, type Ref } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputInstance,
  type TextInputProps,
} from 'react-native';

import { colors, fonts, radius, typography } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface InputProps extends TextInputProps {
  icon?: IconName;
  label?: string;
  error?: string | null;
  hint?: string;
  /** Element rendered at the right edge (e.g. a country picker or button). */
  trailing?: ReactNode;
  /** `muted` fills the field grey so it stays visible on white surfaces (sheets, cards). */
  tone?: 'default' | 'muted';
  /** Reaches the TextInput, e.g. to move focus to the next field of a form. */
  ref?: Ref<TextInputInstance>;
}

// Browsers draw their focus ring with `outline-style: auto`, which ignores the width, so a
// zero-width solid outline removes it. The field's own border already shows focus.
const webInput = Platform.OS === 'web' ? ({ outlineStyle: 'solid', outlineWidth: 0 } as const) : null;

/**
 * Big Cart text field: white, borderless, with a leading line icon. With `multiline` it is a text
 * area: the icon and the text start at the top, and `style={{ minHeight }}` sets how tall it is.
 */
export function Input({
  icon,
  label,
  error,
  hint,
  secureTextEntry,
  trailing,
  tone = 'default',
  ref,
  style,
  multiline,
  ...props
}: InputProps) {
  const [hidden, setHidden] = useState(secureTextEntry ?? false);
  const [focused, setFocused] = useState(false);
  const fill = tone === 'muted' ? colors.background : colors.surface;
  return (
    <View style={styles.wrapper}>
      {label ? (
        <Text variant="captionMedium" color="muted">
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          multiline ? styles.fieldMultiline : null,
          {
            backgroundColor: fill,
            borderColor: error ? colors.danger : focused ? colors.primaryLight : fill,
          },
        ]}
      >
        {icon ? (
          <Icon
            name={icon}
            size={20}
            color={colors.textMuted}
            style={multiline ? styles.iconMultiline : undefined}
          />
        ) : null}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textMuted}
          {...props}
          multiline={multiline}
          secureTextEntry={hidden}
          accessibilityLabel={props.accessibilityLabel ?? label ?? props.placeholder}
          onFocus={(event) => {
            setFocused(true);
            props.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            props.onBlur?.(event);
          }}
          style={[styles.input, multiline ? styles.inputMultiline : null, webInput, style]}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            hitSlop={8}
            onPress={() => setHidden((value) => !value)}
          >
            <Icon name={hidden ? 'eye' : 'eye-off'} size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
        {trailing}
      </View>
      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption" color="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    alignItems: 'center',
    borderRadius: radius.sm,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 14,
    minHeight: 56,
    paddingHorizontal: 18,
  },
  fieldMultiline: { alignItems: 'flex-start' },
  // Level with the first line of text (the input's own top padding).
  iconMultiline: { marginTop: 14 },
  // minWidth 0 lets the field shrink inside a row on the web, where an <input> keeps its own width.
  input: {
    color: colors.text,
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    minWidth: 0,
    paddingVertical: 14,
  },
  inputMultiline: {
    lineHeight: typography.bodyMedium.lineHeight,
    minHeight: 96,
    textAlignVertical: 'top',
  },
  wrapper: { gap: 6 },
});
