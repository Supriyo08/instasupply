/**
 * The database layer of the rate limits (docs/PLATFORM.md §4.6): exact, shared by every instance, fixed
 * windows. Subjects are uids or HMACs, never a raw address, phone number or email.
 */
import type { RateLimitPluginOptions } from '@fastify/rate-limit';
import type pg from 'pg';
import type { Config } from '../../config/env';
import { clientAddress } from './client-address';
import { failCode } from './errors';

export interface RateLimitUse {
  bucket: string;
  subject: string;
  max: number;
  windowSeconds: number;
}

const HOUR = 3600;
const DAY = 86_400;

/** Limit and window per bucket; callers name the bucket and supply the subject. */
export const BUCKETS = {
  signup_ip: { max: 10, windowSeconds: HOUR },
  login_ip: { max: 30, windowSeconds: 15 * 60 },
  login_email: { max: 10, windowSeconds: 15 * 60 },
  refresh_ip: { max: 120, windowSeconds: 15 * 60 },
  reset_ip: { max: 10, windowSeconds: HOUR },
  reset_email: { max: 3, windowSeconds: HOUR },
  reset_fail_user: { max: 10, windowSeconds: DAY },
  otp_ip: { max: 20, windowSeconds: HOUR },
  otp_phone: { max: 5, windowSeconds: HOUR },
  otp_phone_day: { max: 10, windowSeconds: DAY },
  otp_global: { max: 200, windowSeconds: HOUR },
  otp_global_day: { max: 1000, windowSeconds: DAY },
  geocode: { max: 30, windowSeconds: HOUR },
  suggest: { max: 5, windowSeconds: HOUR },
  material_list: { max: 10, windowSeconds: DAY },
  issue_report: { max: 10, windowSeconds: DAY },
  support_message: { max: 60, windowSeconds: 10 * 60 },
  chat_message: { max: 120, windowSeconds: 10 * 60 },
  file_ticket: { max: 60, windowSeconds: HOUR },
  invite: { max: 30, windowSeconds: HOUR },
  provider_nominatim: { max: 1, windowSeconds: 1 },
  provider_osrm: { max: 1, windowSeconds: 1 },
} as const satisfies Record<string, { max: number; windowSeconds: number }>;

export type BucketName = keyof typeof BUCKETS;

/** A use of a named bucket with its standard limit. */
export const use = (bucket: BucketName, subject: string): RateLimitUse => ({
  bucket,
  subject,
  ...BUCKETS[bucket],
});

interface LimitDeps {
  pool: pg.Pool;
  clock: { now(): number };
  config: Pick<Config, 'RATE_LIMITS_DISABLED'>;
}

export interface RateLimitResult {
  count: number;
  allowed: boolean;
  retryAfterMs: number;
  windowStart: number;
}

/** Statement (d) of §3.5, autocommit, never inside a business transaction. Does not throw. */
export async function hitRateLimit(
  deps: LimitDeps,
  bucket: string,
  subject: string,
  max: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = deps.clock.now();
  const { rows } = await deps.pool.query<{ count: number; window_start: number; expires_at: number }>(
    `INSERT INTO rate_limits AS r (bucket, subject, count, window_start, expires_at)
     VALUES ($1, $2, 1, $3, $4)
     ON CONFLICT (bucket, subject) DO UPDATE SET
       count        = CASE WHEN r.expires_at <= EXCLUDED.window_start THEN 1 ELSE r.count + 1 END,
       window_start = CASE WHEN r.expires_at <= EXCLUDED.window_start THEN EXCLUDED.window_start ELSE r.window_start END,
       expires_at   = CASE WHEN r.expires_at <= EXCLUDED.window_start THEN EXCLUDED.expires_at ELSE r.expires_at END
     RETURNING count, window_start, expires_at`,
    [bucket, subject, new Date(now), new Date(now + windowSeconds * 1000)],
  );
  const row = rows[0]!;
  return {
    count: row.count,
    allowed: row.count <= max,
    retryAfterMs: Math.max(0, row.expires_at - now),
    windowStart: row.window_start,
  };
}

/** Throws RATE_LIMITED with details.retryAfterMs when the subject is over the limit. */
export async function consumeRateLimit(
  deps: LimitDeps,
  bucket: string,
  subject: string,
  max: number,
  windowSeconds: number,
): Promise<void> {
  if (deps.config.RATE_LIMITS_DISABLED) return;
  const result = await hitRateLimit(deps, bucket, subject, max, windowSeconds);
  if (!result.allowed) {
    const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    failCode('RATE_LIMITED', `Too many attempts. Please try again in ${formatWait(seconds)}.`, {
      retryAfterMs: result.retryAfterMs,
    });
  }
}

export async function consumeAll(deps: LimitDeps, uses: readonly RateLimitUse[]): Promise<void> {
  for (const limit of uses)
    await consumeRateLimit(deps, limit.bucket, limit.subject, limit.max, limit.windowSeconds);
}

function formatWait(seconds: number): string {
  if (seconds < 90) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `${minutes} minutes`;
  return `${Math.ceil(minutes / 60)} hours`;
}

/** The in-memory flood guard of §4.6, per instance and per client address. */
export function memoryLimiterOptions(config: Config): RateLimitPluginOptions {
  return {
    global: true,
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: 60_000,
    keyGenerator: (req) => clientAddress(req.raw, config),
    allowList: (req) => config.RATE_LIMITS_DISABLED || req.url.startsWith('/api/v1/health'),
    // The error handler turns this into the RATE_LIMITED envelope.
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      rateLimited: true,
      retryAfterMs: context.ttl,
      message: 'Too many requests. Please slow down.',
    }),
  };
}
