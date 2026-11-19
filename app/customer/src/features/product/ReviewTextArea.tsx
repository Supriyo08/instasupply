import { StyleSheet } from 'react-native';

import { Input } from '@/components/ui';

/** The review field: the kit's text area with a pencil icon and a character count under it. */
export function ReviewTextArea({
  value,
  onChangeText,
  maxLength = 1000,
}: {
  value: string;
  onChangeText: (text: string) => void;
  maxLength?: number;
}) {
  return (
    <Input
      multiline
      icon="edit-3"
      value={value}
      onChangeText={onChangeText}
      maxLength={maxLength}
      placeholder="Tell us about your experience"
      accessibilityLabel="Your review"
      accessibilityHint="Optional. Tell other shoppers what you liked or didn't."
      hint={`${value.length}/${maxLength}`}
      style={styles.area}
    />
  );
}

const styles = StyleSheet.create({ area: { minHeight: 180 } });
