/** Wire frames of `/api/v1/live` (PLATFORM §8.1). JSON text frames, one object each, field `type`. */

export type ClientFrame =
  | { type: 'auth'; token: string }
  | { type: 'subscribe'; id: number; topics: string[] }
  | { type: 'unsubscribe'; topics: string[] }
  | { type: 'ping' };

export interface DeniedTopic {
  topic: string;
  reason: 'unauthenticated' | 'permission-denied' | 'not-found' | string;
}

export type ServerFrame =
  | { type: 'ready'; uid: string | null }
  | { type: 'subscribed'; id: number; topics: string[]; denied: DeniedTopic[] }
  | { type: 'event'; topic: string; kind: string; id: string | null; at: number; data?: unknown }
  | { type: 'pong' }
  | { type: 'error'; status: string; reason?: string; message?: string };

/** At most this many topics per `subscribe` frame. */
export const MAX_TOPICS_PER_FRAME = 100;

/** Close codes the client understands (CLIENTS §1.9, PLATFORM §8.1). */
export const CLOSE = {
  /** Token expired or invalid: refresh, then reconnect at once. */
  tokenExpired: 4401,
  /** Session revoked or account suspended: check the session through GET /me. */
  revoked: 4403,
  /** Server restarting, or events may have been missed: reconnect with backoff and refetch. */
  restart: 1012,
  tryAgainLater: 1013,
  /** A socket limit (too many sockets or frames): wait 5 minutes, poll meanwhile. */
  policy: 1008,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses one text frame; anything that is not a known frame is ignored by returning null. */
export function parseServerFrame(data: unknown): ServerFrame | null {
  if (typeof data !== 'string') return null;
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  switch (value.type) {
    case 'ready':
      return { type: 'ready', uid: typeof value.uid === 'string' ? value.uid : null };
    case 'subscribed':
      return {
        type: 'subscribed',
        id: typeof value.id === 'number' ? value.id : 0,
        topics: Array.isArray(value.topics) ? value.topics.filter((t): t is string => typeof t === 'string') : [],
        denied: Array.isArray(value.denied)
          ? value.denied.filter(
              (d): d is DeniedTopic => isRecord(d) && typeof d.topic === 'string' && typeof d.reason === 'string',
            )
          : [],
      };
    case 'event':
      if (typeof value.topic !== 'string') return null;
      return {
        type: 'event',
        topic: value.topic,
        kind: typeof value.kind === 'string' ? value.kind : 'updated',
        id: typeof value.id === 'string' ? value.id : null,
        at: typeof value.at === 'number' ? value.at : 0,
        ...(value.data === undefined || value.data === null ? {} : { data: value.data }),
      };
    case 'pong':
      return { type: 'pong' };
    case 'error':
      return {
        type: 'error',
        status: typeof value.status === 'string' ? value.status : 'internal',
        ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
        ...(typeof value.message === 'string' ? { message: value.message } : {}),
      };
    default:
      return null;
  }
}
