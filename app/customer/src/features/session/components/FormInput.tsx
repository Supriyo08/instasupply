import type { Ref } from 'react';
import { StyleSheet, type TextInputInstance } from 'react-native';

import { Input } from '@/components/ui';
import type { InputProps } from '@/components/ui/Input';

export type FormInputProps = InputProps & { ref?: Ref<TextInputInstance> };

/**
 * The UI kit `Input` with two form conveniences:
 * - `ref` reaches the TextInput (React 19 passes it as a prop and `Input` spreads its props), so
 *   forms can move focus to the next field;
 * - no browser focus ring on web — the field's border already shows focus.
 */
export function FormInput({ style, ...props }: FormInputProps) {
  return <Input {...props} style={[styles.field, style]} />;
}

// Browsers draw the focus ring with `outline-style: auto`, which ignores the width; a zero-width
// solid outline replaces it. No effect on native.
const styles = StyleSheet.create({ field: { outlineStyle: 'solid', outlineWidth: 0 } });
