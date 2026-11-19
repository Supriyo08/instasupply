import { useState } from 'react';

import { Header, IconButton, Screen } from '@/components/ui';
import { CategoriesContent } from '@/features/catalog/components/CategoryGrid';
import { CategorySortSheet, type CategorySort } from '@/features/catalog/components/CategorySortSheet';

/** All categories as a three-column grid of pastel tiles. */
export default function CategoriesScreen() {
  const [sort, setSort] = useState<CategorySort>('recommended');
  const [sortOpen, setSortOpen] = useState(false);

  return (
    <>
      <Screen
        header={
          <Header
            title="Categories"
            right={<IconButton icon="sliders" label="Sort categories" onPress={() => setSortOpen(true)} />}
          />
        }
      >
        <CategoriesContent sort={sort} />
      </Screen>
      <CategorySortSheet
        visible={sortOpen}
        value={sort}
        onChange={(next) => {
          setSort(next);
          setSortOpen(false);
        }}
        onClose={() => setSortOpen(false)}
      />
    </>
  );
}
