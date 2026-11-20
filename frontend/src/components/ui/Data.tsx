import type { ReactNode } from 'react';

import { Button } from './Button';
import { EmptyState, ErrorState, PageSpinner } from './Feedback';
import type { IconComponent } from './icons';

interface QueryLike<T> {
  data: T;
  loading: boolean;
  error: unknown;
  retry: () => void;
}

/**
 * Renders the three states every query has, the same way on every screen: a spinner on the first
 * load, the error with "Try again" when there is nothing usable, the empty state, then `children`.
 * Data already on screen stays while a refetch runs or fails (the cache keeps it).
 */
export function QueryView<T>({
  query,
  isEmpty,
  empty,
  loadingLabel,
  children,
}: {
  query: QueryLike<T>;
  /** Default: an empty array or null. */
  isEmpty?: (data: T) => boolean;
  empty?: { icon: IconComponent; title: string; description?: ReactNode; action?: ReactNode };
  loadingLabel?: string;
  children: (data: NonNullable<T>) => ReactNode;
}) {
  const blank = isEmpty
    ? isEmpty(query.data)
    : query.data == null || (Array.isArray(query.data) && query.data.length === 0);
  if (query.loading && blank) return <PageSpinner label={loadingLabel} />;
  if (query.error && blank) return <ErrorState error={query.error} onRetry={query.retry} />;
  if (blank) {
    return empty ? <EmptyState {...empty} /> : null;
  }
  return <>{children(query.data as NonNullable<T>)}</>;
}

/** "Load more" under a paged list (`usePagedQuery`). Hidden when there is nothing more. */
export function LoadMore({
  hasMore,
  loadingMore,
  onLoadMore,
  label = 'Load more',
}: {
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  label?: string;
}) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center py-4">
      <Button variant="secondary" loading={loadingMore} onClick={onLoadMore}>
        {label}
      </Button>
    </div>
  );
}
