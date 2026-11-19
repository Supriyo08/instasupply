import type { Product } from '@instasupply/shared';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Sheet } from '@/components/ui';
import { spacing } from '@/theme/tokens';

import { CheckRow, FilterSection, PriceRangeFields, SortOptions, StarRatingPicker } from './FilterControls';
import { activeFilters, applyFilters, DEFAULT_FILTERS, parsePrice, type ProductFilters } from './filters';

/**
 * "Filter & sort" bottom sheet: price range, minimum rating, discount/in-stock toggles and sort
 * order. Edits a draft; nothing changes on screen until the shopper taps "Show n products".
 */
export function FilterSheet({
  visible,
  value,
  products,
  onApply,
  onClose,
}: {
  visible: boolean;
  value: ProductFilters;
  /** The unfiltered list, used to preview how many products match. */
  products: readonly Product[];
  onApply: (filters: ProductFilters) => void;
  onClose: () => void;
}) {
  // Start a fresh draft from the applied filters every time the sheet opens.
  const [session, setSession] = useState(0);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setSession((current) => current + 1);
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Filter & sort">
      <FilterForm key={session} initial={value} products={products} onApply={onApply} />
    </Sheet>
  );
}

function FilterForm({
  initial,
  products,
  onApply,
}: {
  initial: ProductFilters;
  products: readonly Product[];
  onApply: (filters: ProductFilters) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [minText, setMinText] = useState(initial.minPrice != null ? String(initial.minPrice) : '');
  const [maxText, setMaxText] = useState(initial.maxPrice != null ? String(initial.maxPrice) : '');

  const minPrice = parsePrice(minText);
  const maxPrice = parsePrice(maxText);
  const rangeError =
    minPrice != null && maxPrice != null && minPrice > maxPrice
      ? 'The minimum price is higher than the maximum.'
      : null;
  const next: ProductFilters = { ...draft, minPrice, maxPrice };
  const matches = rangeError ? 0 : applyFilters(products, next).length;
  const pristine = activeFilters(next).length === 0;

  const patch = (changes: Partial<ProductFilters>) => setDraft((current) => ({ ...current, ...changes }));
  const reset = () => {
    setDraft(DEFAULT_FILTERS);
    setMinText('');
    setMaxText('');
  };

  return (
    <>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <FilterSection title="Price range">
          <PriceRangeFields
            min={minText}
            max={maxText}
            onChangeMin={setMinText}
            onChangeMax={setMaxText}
            error={rangeError}
          />
        </FilterSection>
        <FilterSection title="Star rating">
          <StarRatingPicker value={draft.minRating} onChange={(minRating) => patch({ minRating })} />
        </FilterSection>
        <FilterSection title="Others">
          <CheckRow
            icon="tag"
            label="Discount only"
            checked={draft.discountOnly}
            onToggle={(discountOnly) => patch({ discountOnly })}
          />
          <CheckRow
            icon="package"
            label="In stock only"
            checked={draft.inStockOnly}
            onToggle={(inStockOnly) => patch({ inStockOnly })}
          />
        </FilterSection>
        <FilterSection title="Sort by" last>
          <SortOptions value={draft.sort} onChange={(sort) => patch({ sort })} />
        </FilterSection>
      </ScrollView>
      <View style={styles.actions}>
        <Button label="Reset" variant="secondary" disabled={pristine} onPress={reset} style={styles.reset} />
        <Button
          label={matches === 1 ? 'Show 1 product' : `Show ${matches} products`}
          disabled={rangeError != null}
          onPress={() => onApply(next)}
          style={styles.apply}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: spacing.md },
  apply: { flex: 2 },
  body: { gap: spacing.lg },
  reset: { flex: 1 },
  // Lets the form scroll inside the sheet's max height on small screens.
  scroll: { flexGrow: 0, flexShrink: 1 },
});
