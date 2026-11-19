import { COLLECTIONS, type PublicTracking } from '@instasupply/shared';
import { doc } from 'firebase/firestore';
import { useMemo } from 'react';

import { db } from '@/lib/firebase/app';
import { useDocument } from '@/lib/firebase/hooks';

/** Live public tracking document. Readable by anyone holding the (unguessable) token. */
export function useTracking(token: string | undefined) {
  const ref = useMemo(
    () => (token && /^[A-Za-z0-9]{12,64}$/.test(token) ? doc(db, COLLECTIONS.tracking, token) : null),
    [token],
  );
  const state = useDocument<PublicTracking>(ref);
  return { ...state, invalidToken: !ref };
}
