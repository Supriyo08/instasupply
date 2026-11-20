import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Icon, Text } from '@/components/ui';
import { colors, fonts, radius, spacing } from '@/theme/tokens';

import { parseListLine, splitPastedList, type DraftLine } from '../list-lines';

const MAX_LINES = 60;

/**
 * The typed list: one row per item (text and quantity), "+ Add item". Pasting or typing several lines
 * into a row splits them into items, and a leading or trailing number becomes the quantity.
 */
export function MaterialLinesEditor({
  lines,
  onChange,
  newKey,
}: {
  lines: readonly DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  newKey: () => string;
}) {
  const update = (index: number, change: Partial<DraftLine>) =>
    onChange(lines.map((line, at) => (at === index ? { ...line, ...change } : line)));

  const changeText = (index: number, text: string) => {
    if (!text.includes('\n')) {
      update(index, { text });
      return;
    }
    // A paste (or Return): split into items in place of this row.
    const parsed = splitPastedList(text);
    const current = lines[index];
    const rows: DraftLine[] = parsed.map((item, at) => ({
      key: at === 0 && current ? current.key : newKey(),
      text: item.text,
      quantity: item.quantity || (at === 0 && current ? current.quantity : ''),
    }));
    if (text.endsWith('\n')) rows.push({ key: newKey(), text: '', quantity: '' });
    onChange([...lines.slice(0, index), ...rows, ...lines.slice(index + 1)].slice(0, MAX_LINES));
  };

  /** On leaving a row, a number typed at its start or end moves to the quantity. */
  const tidy = (index: number) => {
    const line = lines[index];
    if (!line || line.quantity.trim() || !line.text.trim()) return;
    const parsed = parseListLine(line.text);
    if (parsed.quantity) update(index, parsed);
  };

  return (
    <View style={styles.list}>
      {lines.map((line, index) => (
        <View key={line.key} style={styles.row}>
          <TextInput
            value={line.text}
            onChangeText={(text) => changeText(index, text)}
            onBlur={() => tidy(index)}
            placeholder={index === 0 ? 'e.g. 2x4x8 SPF studs' : 'Item'}
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={2000}
            accessibilityLabel={`Item ${index + 1}`}
            style={[styles.input, styles.text]}
          />
          <TextInput
            value={line.quantity}
            onChangeText={(quantity) =>
              update(index, { quantity: quantity.replace(/[^\d]/g, '').slice(0, 5) })
            }
            placeholder="Qty"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            accessibilityLabel={`Quantity of item ${index + 1}`}
            style={[styles.input, styles.quantity]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove item ${index + 1}`}
            hitSlop={8}
            disabled={lines.length === 1 && !line.text && !line.quantity}
            onPress={() =>
              onChange(
                lines.length === 1
                  ? [{ key: newKey(), text: '', quantity: '' }]
                  : lines.filter((_, at) => at !== index),
              )
            }
            style={styles.remove}
          >
            <Icon name="x" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      ))}
      {lines.length < MAX_LINES ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add item"
          onPress={() => onChange([...lines, { key: newKey(), text: '', quantity: '' }])}
          style={({ pressed }) => [styles.add, pressed ? styles.pressed : null]}
        >
          <Icon name="plus" size={16} color={colors.primaryDark} />
          <Text variant="captionMedium" color="primaryDark">
            Add item
          </Text>
        </Pressable>
      ) : (
        <Text variant="caption" color="muted">
          A list can have up to {MAX_LINES} items. Attach a file for a longer one.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  add: { alignItems: 'center', alignSelf: 'flex-start', flexDirection: 'row', gap: spacing.xs, padding: 6 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    color: colors.text,
    fontFamily: fonts.medium,
    fontSize: 14,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  list: { gap: spacing.sm },
  pressed: { opacity: 0.6 },
  quantity: { textAlign: 'center', width: 70 },
  remove: { alignItems: 'center', height: 46, justifyContent: 'center', width: 28 },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  text: { flex: 1, minWidth: 0 },
});
