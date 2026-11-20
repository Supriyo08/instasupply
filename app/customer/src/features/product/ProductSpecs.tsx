import { summarizeLoad, type Product } from '@instasupply/shared';
import { StyleSheet, View } from 'react-native';

import { Card, StatusPill, Text } from '@/components/ui';
import { spacing } from '@/theme/tokens';

/** A piece of 240 cm or more loads as a long load (MARKETPLACE §3.3). */
const LONG_LOAD_CM = 240;

const trim = (value: number) => String(Number(value.toFixed(1)));

/** "Long load" and "Sheet goods" for one sell unit, as the load rules read its size. */
export function productFlags(product: Product): string[] {
  const flags: string[] = [];
  let sheets: boolean;
  try {
    sheets = summarizeLoad([{ ...product, quantity: 1 }]).hasSheets;
  } catch {
    // A size the load rules can't read flags nothing.
    sheets = false;
  }
  if (product.dimsCm.l >= LONG_LOAD_CM) flags.push('Long load');
  if (sheets) flags.push('Sheet goods');
  return flags;
}

/** Weight and size per sell unit, and the load flags that pick the vehicle. */
export function ProductSpecs({ product }: { product: Product }) {
  const { l, w, h } = product.dimsCm;
  const flags = productFlags(product);
  const estimated = product.shipEstimated ? ' (estimated)' : '';
  return (
    <Card style={styles.card}>
      <Text variant="heading">Details</Text>
      <Row label="Weight" value={`${trim(product.weightKg)} kg per ${product.unit}${estimated}`} />
      <Row label="Size" value={`${trim(l)} × ${trim(w)} × ${trim(h)} cm${estimated}`} />
      {product.maxPerOrder ? <Row label="Limit" value={`${product.maxPerOrder} per order`} /> : null}
      {flags.length ? (
        <View style={styles.flags}>
          {flags.map((flag) => (
            <StatusPill key={flag} label={flag} tone="info" />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text color="muted">{label}</Text>
      <Text variant="bodyMedium" style={styles.value}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  flags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
  value: { flexShrink: 1, textAlign: 'right' },
});
