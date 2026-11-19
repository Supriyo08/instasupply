import { describeError } from '@instasupply/expo-firebase';

import { Notice } from '@/components/ui';

/**
 * For a checkout step whose cart couldn't be loaded (`useCartDetails().error`). The rest of the
 * step stays usable, so this is a banner with "Try again" (the hook's `retry`), not an `ErrorState`.
 */
export function CartErrorNotice({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Notice
      tone="danger"
      title="Couldn't load your cart"
      message={describeError(error, 'Check your connection and try again.')}
      actionLabel="Try again"
      onAction={onRetry}
    />
  );
}
