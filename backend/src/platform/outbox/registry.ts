/** Outbox handlers by event name (docs/PLATFORM.md §9.3). Modules register theirs in `register(app, deps)`. */
import type { Deps } from '../../container';

export type OutboxEventName =
  | 'push.send'
  | 'sms.send'
  | 'mail.send'
  | 'payment.finalize'
  | 'payment.refund'
  | 'payment.void'
  | 'payout.transfer'
  | 'route.plan'
  | 'tracking.eta';

export interface OutboxHandlerContext {
  eventId: number;
  attempt: number;
  deps: Deps;
  now: number;
}

/** A handler may run more than once for the same event; it must make the second run change nothing. */
export type OutboxHandler<P = Record<string, unknown>> = (
  payload: P,
  ctx: OutboxHandlerContext,
) => Promise<void>;

const handlers = new Map<string, OutboxHandler>();

/**
 * Process-wide: every app built in this process runs the same code, so a later registration of the same
 * event (another app instance in a test file) simply replaces the earlier one.
 */
export function registerHandler<P extends object>(event: OutboxEventName, handler: OutboxHandler<P>): void {
  handlers.set(event, handler as unknown as OutboxHandler);
}

export const handlerFor = (event: string): OutboxHandler | undefined => handlers.get(event);
export const registeredEvents = (): string[] => [...handlers.keys()].sort();
