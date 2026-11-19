/**
 * WAVE-2 PLACEHOLDER written by the platform workstream (docs/PLATFORM.md §15 rule 1). The owner is `commerce`
 * (§15.2), who replaces the bodies; the exported names and signatures are the frozen ones of §9.1, so other
 * modules compile against them today. Every body throws ApiError('internal', 'not implemented').
 */
import type { Deps } from '../../container';
import { notImplemented } from '../../platform/http/errors';

/** The owner defines the fields (MARKETPLACE §5.5.1 step 3). */
export interface CheckoutContextInput {
  [field: string]: unknown;
}
/** The owner defines the fields: profile, jobsite, stores, products, pricing inputs. */
export interface CheckoutContext {
  [field: string]: unknown;
}

/** Reads, outside the transaction. */
export async function loadCheckoutContext(
  _deps: Deps,
  _input: CheckoutContextInput,
): Promise<CheckoutContext> {
  return notImplemented('loadCheckoutContext');
}
