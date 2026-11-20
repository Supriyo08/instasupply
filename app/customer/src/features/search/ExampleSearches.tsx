import { StyleSheet, View } from 'react-native';

import { Chip, Text } from '@/components/ui';
import { spacing } from '@/theme/tokens';

/** The example searches instasupply.ca shows (MARKETPLACE §7.3 search row). */
export const EXAMPLE_SEARCHES: readonly string[] = [
  '2×4×8 SPF studs',
  'Drywall 1/2 in',
  '3/4" Type L copper',
  'Rebar 10M 20 ft',
  'Subfloor screws',
  'Spray foam low expansion',
];

export function ExampleSearches({ onSelect }: { onSelect: (term: string) => void }) {
  return (
    <View style={styles.section}>
      <Text variant="heading">Try searching for</Text>
      <View style={styles.chips}>
        {EXAMPLE_SEARCHES.map((term) => (
          <Chip
            key={term}
            icon="search"
            label={term}
            accessibilityLabel={`Search for ${term}`}
            onPress={() => onSelect(term)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  section: { gap: spacing.md },
});
