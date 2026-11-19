/** Frames of `/api/v1/live` (docs/PLATFORM.md §8.1). Text frames, one JSON object each, field `type`. */
import { z } from 'zod';

export const MAX_TOPICS_PER_FRAME = 100;
export const MAX_TOPICS_PER_SOCKET = 300;
export const MAX_FRAME_BYTES = 16 * 1024;
export const MAX_SOCKETS_PER_USER = 10;
export const MAX_ANONYMOUS_SOCKETS_PER_ADDRESS = 200;
export const MAX_FRAMES_PER_SECOND = 20;
export const IDLE_TIMEOUT_MS = 120_000;
export const PROTOCOL_PING_MS = 30_000;
/** A socket whose token expired this long ago without a new `auth` is closed with 4401. */
export const EXPIRY_GRACE_MS = 30_000;

export const CLOSE = {
  tokenInvalid: 4401,
  revoked: 4403,
  restarting: 1012,
  policy: 1008,
  tooLarge: 1009,
  internal: 1011,
} as const;

const topic = z.string().min(1).max(200);

export const clientFrameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string().min(1).max(4096) }).strict(),
  z
    .object({
      type: z.literal('subscribe'),
      id: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      topics: z.array(topic).min(1).max(MAX_TOPICS_PER_FRAME),
    })
    .strict(),
  z
    .object({ type: z.literal('unsubscribe'), topics: z.array(topic).min(1).max(MAX_TOPICS_PER_FRAME) })
    .strict(),
  z.object({ type: z.literal('ping') }).strict(),
]);
export type ClientFrame = z.infer<typeof clientFrameSchema>;

export type DenyReason = 'unauthenticated' | 'permission-denied' | 'not-found';
export type EventKind = 'created' | 'updated' | 'deleted' | 'message';

export type ServerFrame =
  | { type: 'ready'; uid: string }
  | { type: 'subscribed'; id: number; topics: string[]; denied: { topic: string; reason: DenyReason }[] }
  | { type: 'event'; topic: string; kind: EventKind; id: string; at: number; data?: unknown }
  | { type: 'pong' }
  | { type: 'error'; status: 'unauthenticated' | 'permission-denied' | 'invalid-argument'; reason: string };

/** What travels on the `is_live` channel: one change addressed to several topics. */
export interface LiveNotification {
  topics: string[];
  kind: EventKind;
  id: string;
  at: number;
  data: unknown;
}

/** Control messages on the same channel; they never reach clients (§8.3). */
export type ControlMessage = { ctl: 'drop_user'; uid: string } | { ctl: 'drop_session'; sid: string };
