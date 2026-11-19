/** Reconnect delays of the live socket (CLIENTS §1.9). */

export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 30_000;
/** After a 1008 close the client waits this long, polling meanwhile, and does not count an attempt. */
export const POLICY_WAIT_MS = 5 * 60_000;
/** `attempt` goes back to 0 once a connection stayed open this long. */
export const STABLE_AFTER_MS = 10_000;

/**
 * `min(30 000, 500 × 2^attempt) × (0.5 + random() / 2)`: about 0.5, 1, 2, 4, 8, 16, 30 s with jitter,
 * so a server restart is not met by every client at the same instant.
 */
export function reconnectDelay(attempt: number, random: () => number): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  return ceiling * (0.5 + random() / 2);
}
