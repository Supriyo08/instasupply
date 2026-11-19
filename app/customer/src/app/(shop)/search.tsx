import { searchKeyFor } from '@instasupply/shared';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Screen, webColumn } from '@/components/ui';
import { SEARCH_DEBOUNCE_MS } from '@/features/catalog/components/constants';
import { PopularCategories } from '@/features/catalog/components/PopularCategories';
import { RecentSearches } from '@/features/catalog/components/RecentSearches';
import { SearchResults } from '@/features/catalog/components/SearchResults';
import { SearchTopBar } from '@/features/catalog/components/SearchTopBar';
import { useDebouncedValue } from '@/features/catalog/components/useDebouncedValue';
import { useRecentSearches } from '@/features/catalog/components/useRecentSearches';
import { useCustomer } from '@/features/session/SessionProvider';

/** Product search: recent searches and popular categories until the shopper types, then live results. */
export default function SearchScreen() {
  const { user } = useCustomer();
  const { q } = useLocalSearchParams<{ q?: string | string[] }>();
  const [text, setText] = useState(() => (typeof q === 'string' ? q.slice(0, 60) : ''));
  const typed = text.trim();
  const term = useDebouncedValue(typed, SEARCH_DEBOUNCE_MS);
  const recents = useRecentSearches(user.uid);

  const searchAgain = (item: string) => {
    setText(item);
    recents.add(item);
  };

  return (
    <Screen
      header={
        // The bar is the colour of the page, so on the web the whole of it keeps to the content column.
        <View style={webColumn}>
          <SearchTopBar value={text} onChangeText={setText} onSubmit={() => recents.add(typed)} />
        </View>
      }
    >
      {searchKeyFor(typed) === null ? (
        <>
          <RecentSearches
            loaded={recents.loaded}
            items={recents.items}
            onSelect={searchAgain}
            onRemove={recents.remove}
            onClear={recents.clear}
          />
          <PopularCategories />
        </>
      ) : (
        <SearchResults
          key={searchKeyFor(term) ?? ''}
          term={term}
          pending={typed !== term}
          onRemember={() => recents.add(term)}
        />
      )}
    </Screen>
  );
}
