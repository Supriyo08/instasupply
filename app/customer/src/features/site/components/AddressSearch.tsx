import type { LatLng } from '@instasupply/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Icon, Input, Notice, Text } from '@/components/ui';
import { call } from '@/lib/callables';
import { describeError } from '@/lib/api';
import { colors, radius, spacing } from '@/theme/tokens';

import type { GeocodeResult } from '../place';

/**
 * Address search: `geocodeAddress` runs on submit, never per keystroke (CLIENTS §4.3 site row), and
 * the matches are listed to pick from.
 */
export function AddressSearch({
  near,
  onPick,
}: {
  near: LatLng | null;
  onPick: (result: GeocodeResult) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const text = query.trim();
    if (busy || text.length < 3) {
      if (text.length < 3) setError('Type at least 3 characters of the address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await call('geocodeAddress', { query: text, near });
      setResults(response.results);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.section}>
      <Text variant="heading">Search an address</Text>
      <Input
        icon="search"
        placeholder="Street address, postal code or intersection"
        value={query}
        onChangeText={(value) => {
          setQuery(value);
          setError(null);
        }}
        onSubmitEditing={() => void search()}
        returnKeyType="search"
        autoCorrect={false}
        maxLength={160}
      />
      <Button label="Search" variant="secondary" icon="search" loading={busy} onPress={() => void search()} />
      {error ? <Notice tone="danger" message={error} /> : null}
      {results && results.length === 0 ? (
        <Text variant="caption" color="muted">
          No match in the Greater Toronto Area. Try a postal code, or drop a pin instead.
        </Text>
      ) : null}
      {results && results.length > 0 ? (
        <View style={styles.card}>
          {results.map((result, index) => (
            <Pressable
              key={`${result.location.lat},${result.location.lng},${index}`}
              accessibilityRole="button"
              accessibilityLabel={`Deliver to ${result.label}`}
              onPress={() => onPick(result)}
              style={({ pressed }) => [
                styles.row,
                index > 0 ? styles.divider : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <Icon name="map-pin" size={18} color={colors.primaryDark} />
              <View style={styles.info}>
                <Text variant="bodyMedium" numberOfLines={2}>
                  {result.label}
                </Text>
                <Text variant="caption" color="muted">
                  {result.areaLabel}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: spacing.md },
  divider: { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  info: { flex: 1 },
  pressed: { opacity: 0.7 },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md },
  section: { gap: spacing.md },
});
