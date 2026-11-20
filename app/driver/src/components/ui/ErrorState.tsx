import { describeError } from '@instasupply/api-client';

import { Button } from './Button';
import { EmptyState } from './EmptyState';

/**
 * A list or document that could not be loaded: the error in words and "Try again". Wire `onRetry` to
 * the query's `retry` (docs/CLIENTS.md §1.10).
 */
export function ErrorState({
  error,
  onRetry,
  title = "Couldn't load this",
}: {
  error: unknown;
  onRetry: () => void;
  title?: string;
}) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title={title}
      message={describeError(error)}
      action={
        <Button label="Try again" variant="secondary" icon="refresh" fullWidth={false} onPress={onRetry} />
      }
    />
  );
}
