import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Keyboard } from 'react-native';

import { Button, EmptyState, Screen } from '@/components/ui';
import { ProductListing } from '@/features/catalog/components/ProductListing';
import { ExampleSearches } from '@/features/search/ExampleSearches';
import { RecentSearches } from '@/features/search/RecentSearches';
import { SearchTopBar } from '@/features/search/SearchTopBar';
import { useDebouncedValue } from '@/features/search/useDebouncedValue';
import { useRecentSearches } from '@/features/search/useRecentSearches';
import { useUid } from '@/features/session/SessionProvider';

const MIN_QUERY = 2;

/**
 * One search across nearby stores (MARKETPLACE §7.3): example chips and recent searches while the
 * field is empty; results grouped by family with the shared filters and sorts. `?q=` deep links work.
 */
export default function SearchScreen() {
  const params = useLocalSearchParams<{ q?: string }>();
  const uid = useUid();
  const recent = useRecentSearches(uid ?? 'guest');
  const [text, setText] = useState(() => (typeof params.q === 'string' ? params.q : ''));
  const debounced = useDebouncedValue(text.trim(), 300);
  const query = debounced.length >= MIN_QUERY ? debounced : '';

  const choose = (term: string) => {
    setText(term);
    recent.add(term);
    Keyboard.dismiss();
  };

  return (
    <Screen
      header={
        <SearchTopBar
          value={text}
          onChangeText={setText}
          onSubmit={() => {
            if (text.trim().length >= MIN_QUERY) recent.add(text);
          }}
        />
      }
    >
      {query ? (
        <ProductListing
          q={query}
          empty={
            <EmptyState
              art="scene-material-list"
              title={`No results for “${query}”`}
              message="Can't find it? Send us your list and we'll source it from local suppliers."
              action={<Button label="Send us your list" onPress={() => router.push('/quotes/new')} />}
            />
          }
        />
      ) : (
        <>
          <ExampleSearches onSelect={choose} />
          <RecentSearches
            loaded={recent.loaded}
            items={recent.items}
            onSelect={choose}
            onRemove={recent.remove}
            onClear={recent.clear}
          />
        </>
      )}
    </Screen>
  );
}
