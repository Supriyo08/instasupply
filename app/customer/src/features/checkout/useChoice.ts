import { useCallback, useState } from 'react';

/**
 * Selection over a live list (addresses, saved cards): the shopper's explicit pick, else a
 * fallback such as the default entry. `beginAdd()` remembers the ids that exist before the shopper
 * leaves to add a new entry, so the entry they create is selected automatically when they return.
 */
export function useChoice<T extends { id: string }>(
  items: readonly T[],
  fallback: (items: readonly T[]) => T | null,
) {
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<ReadonlySet<string> | null>(null);

  const added = baseline ? (items.find((item) => !baseline.has(item.id)) ?? null) : null;
  const chosen = chosenId ? (items.find((item) => item.id === chosenId) ?? null) : null;
  const selected = added ?? chosen ?? fallback(items);
  const selectedId = selected?.id ?? null;

  const choose = useCallback((id: string) => {
    setChosenId(id);
    setBaseline(null);
  }, []);

  const beginAdd = useCallback(() => {
    // Keep the current pick in case the shopper comes back without adding anything.
    setChosenId(selectedId);
    setBaseline(new Set(items.map((item) => item.id)));
  }, [items, selectedId]);

  return { selected, choose, beginAdd };
}
