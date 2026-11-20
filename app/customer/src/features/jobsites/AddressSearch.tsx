import type { LatLng } from '@instasupply/shared';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Input, Notice, Text } from '@/components/ui';
import { OptionRow } from '@/features/checkout/OptionRow';
import { describeError } from '@/lib/api';
import { call } from '@/lib/callables';
import { spacing } from '@/theme/tokens';

import type { GeocodeResult } from './jobsite-form';

/**
 * Address search for the jobsite editor: `geocodeAddress` runs on submit only, never per keystroke
 * (docs/CLIENTS.md §4.3). Choosing a result fills line 1, city, postal code, city and area.
 */
export function AddressSearch({
  near,
  onChoose,
}: {
  near: LatLng | null;
  onChoose: (result: GeocodeResult) => void;
}) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    const text = query.trim();
    if (text.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await call('geocodeAddress', { query: text, near });
      setResults(response.results);
    } catch (e) {
      setError(describeError(e, "Couldn't search for that address. Try again, or drop a pin."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.field}>
          <Input
            tone="muted"
            icon="search"
            placeholder="Search an address or intersection"
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            onSubmitEditing={() => void search()}
            autoCorrect={false}
            accessibilityLabel="Search an address"
          />
        </View>
        <Button
          label="Search"
          variant="secondary"
          loading={busy}
          disabled={query.trim().length < 3}
          onPress={() => void search()}
          style={styles.button}
        />
      </View>
      {error ? (
        <Notice tone="danger" message={error} actionLabel="Try again" onAction={() => void search()} />
      ) : null}
      {results && results.length === 0 ? (
        <Text variant="caption" color="muted">
          No match in the Greater Toronto Area. Try a street and city, or drop a pin on the map.
        </Text>
      ) : null}
      {results && results.length > 0 ? (
        <View accessibilityRole="radiogroup" style={styles.results}>
          {results.map((result, index) => (
            <OptionRow
              key={`${result.label}-${index}`}
              title={result.label}
              subtitle={result.areaLabel}
              icon="map-pin"
              selected={false}
              onPress={() => {
                onChoose(result);
                setResults(null);
                setQuery('');
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { alignSelf: 'auto', minWidth: 96 },
  field: { flex: 1 },
  results: { gap: spacing.sm },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  wrap: { gap: spacing.sm },
});
