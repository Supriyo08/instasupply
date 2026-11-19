/**
 * Phone verification (docs/PLATFORM.md §6.3.9), ported from legacy/…/auth/phone-otp.ts with the same
 * numbers: 6 digits, 5 minutes, 5 attempts, 30 s between sends, 5 sends per hour.
 */
import * as shared from '@instasupply/shared';
import type { RequestPhoneOtpResponse, VerifyPhoneOtpResponse } from '@instasupply/shared';
import { normalizePhone } from '@instasupply/shared';
import type { Actor } from '../../platform/auth/actor';
import { requireAuth } from '../../platform/auth/policies';
import { hmacHex, randomDigits, safeEqualHex } from '../../platform/crypto';
import { pgCode, withTransaction } from '../../platform/db/tx';
import { defineCommand } from '../../platform/http/command';
import type { RequestContext } from '../../platform/http/context';
import { ApiError, failCode, failedPrecondition, invalidArgument } from '../../platform/http/errors';
import { BUCKETS, consumeAll, hitRateLimit, use } from '../../platform/http/rate-limit';
import { enqueue } from '../../platform/outbox/outbox';
import { notifyStaff } from '../notifications/notify';
import { RequestPhoneOtpRequestSchema, VerifyPhoneOtpRequestSchema } from './schemas';
import { ipSubject } from './account.service';
import { publishUser } from './users.repository';

const CODE_TTL_MS = 5 * 60_000;
const RESEND_MS = 30_000;
const SENDS_PER_HOUR = 5;
const ATTEMPTS = 5;
const HOUR_MS = 3_600_000;

/**
 * PLATFORM §16 edit 10 adds CANADIAN_AREA_CODES and isCanadianNumber to packages/shared. Until the shared
 * team lands it, this copy of the list is used; it is deleted as soon as shared exports the function.
 */
const CANADIAN_AREA_CODES = new Set([
  204, 226, 236, 249, 250, 257, 263, 289, 306, 343, 354, 365, 367, 368, 382, 387, 403, 416, 418, 428, 431,
  437, 438, 450, 460, 468, 474, 506, 514, 519, 548, 579, 581, 584, 587, 604, 613, 639, 647, 672, 683, 705,
  709, 742, 753, 778, 780, 782, 807, 819, 825, 867, 873, 879, 902, 905, 942,
]);
const sharedIsCanadian = (shared as { isCanadianNumber?: (e164: string) => boolean }).isCanadianNumber;
export const isCanadianNumber = (e164: string): boolean =>
  sharedIsCanadian ? sharedIsCanadian(e164) : CANADIAN_AREA_CODES.has(Number(e164.slice(2, 5)));

const codeHash = (uid: string, phone: string, code: string): string =>
  hmacHex('otp', `${uid}:${phone}:${code}`);

function requireRoleSet(ctx: RequestContext): Actor {
  const actor = requireAuth(ctx);
  if (actor.role === null) failedPrecondition('Finish creating your profile first.');
  return actor;
}

const seconds = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));

/** The global SMS caps: over them, admins get one `system` notification per window. */
async function consumeGlobal(ctx: RequestContext): Promise<void> {
  const { deps } = ctx;
  if (deps.config.RATE_LIMITS_DISABLED) return;
  for (const bucket of ['otp_global', 'otp_global_day'] as const) {
    const { max, windowSeconds } = BUCKETS[bucket];
    const hit = await hitRateLimit(deps, bucket, 'global', max, windowSeconds);
    if (hit.allowed) continue;
    await withTransaction(deps, (tx) =>
      notifyStaff(
        tx,
        {
          type: 'system',
          title: 'Phone codes paused',
          body: 'The hourly or daily cap on verification SMS was reached. New codes are refused until it resets.',
          key: `otp-global-${hit.windowStart}`,
        },
        { adminsOnly: true },
      ),
    ).catch((error: unknown) => ctx.log.error({ err: error }, 'could not alert admins about the OTP cap'));
    failCode('RATE_LIMITED', 'Too many verification codes were requested. Please try again later.', {
      retryAfterMs: hit.retryAfterMs,
    });
  }
}

interface ChallengeRow {
  phone_number: string;
  code_hash: string;
  attempts: number;
  expires_at: number;
  last_sent_at: number;
  window_started_at: number;
  send_count: number;
}

export async function requestPhoneOtp(
  ctx: RequestContext,
  actor: Actor,
  phoneInput: string,
): Promise<RequestPhoneOtpResponse> {
  const { deps } = ctx;
  const { config } = deps;
  const phone = normalizePhone(phoneInput);
  if (!phone) invalidArgument('Enter a valid mobile number.', { fields: { phoneNumber: 'invalid' } });
  if (!isCanadianNumber(phone))
    invalidArgument('Use a Canadian mobile number.', { fields: { phoneNumber: 'not Canadian' } });
  if (config.PHONE_VERIFICATION === 'off') failedPrecondition('Phone verification is switched off.');
  const testCode = config.OTP_TEST_NUMBERS.get(phone);
  if (config.SMS_DRIVER === 'outbox' && !config.EXPOSE_DEV_CODES && testCode === undefined) {
    failedPrecondition("Phone verification by SMS isn't available yet.");
  }
  const phoneSubject = hmacHex('phone', phone);
  await consumeAll(deps, [
    use('otp_ip', ipSubject(ctx)),
    use('otp_phone', phoneSubject),
    use('otp_phone_day', phoneSubject),
  ]);
  await consumeGlobal(ctx);

  const code = testCode ?? randomDigits(6);
  await withTransaction(deps, async (tx) => {
    const now = tx.now;
    const { rows } = await tx.query<ChallengeRow>(
      `SELECT phone_number, code_hash, attempts, expires_at, last_sent_at, window_started_at, send_count
         FROM otp_challenges WHERE user_id = $1 FOR NO KEY UPDATE`,
      [actor.uid],
    );
    const current = rows[0];
    let windowStart = now;
    let sends = 1;
    if (current) {
      const wait = current.last_sent_at + RESEND_MS - now;
      if (wait > 0) {
        failCode('RATE_LIMITED', `Please wait ${seconds(wait)} seconds before asking for a new code.`, {
          retryAfterMs: wait,
        });
      }
      if (now - current.window_started_at < HOUR_MS) {
        windowStart = current.window_started_at;
        sends = current.send_count + 1;
        if (sends > SENDS_PER_HOUR) {
          const retryAfterMs = current.window_started_at + HOUR_MS - now;
          failCode('RATE_LIMITED', 'Too many codes were sent. Please try again later.', { retryAfterMs });
        }
      }
    }
    await tx.query(
      `INSERT INTO otp_challenges (user_id, phone_number, code_hash, attempts, expires_at, last_sent_at, window_started_at, send_count)
       VALUES ($1, $2, $3, 0, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET phone_number = EXCLUDED.phone_number, code_hash = EXCLUDED.code_hash,
         attempts = 0, expires_at = EXCLUDED.expires_at, last_sent_at = EXCLUDED.last_sent_at,
         window_started_at = EXCLUDED.window_started_at, send_count = EXCLUDED.send_count`,
      [
        actor.uid,
        phone,
        codeHash(actor.uid, phone, code),
        new Date(now + CODE_TTL_MS),
        new Date(now),
        new Date(windowStart),
        sends,
      ],
    );
    // A test number never gets an SMS: its code is fixed and known.
    if (testCode === undefined) {
      const body = `${code} is your InstaSupply verification code. It expires in 5 minutes. Never share it.`;
      await enqueue(
        tx,
        'sms.send',
        { to: phone, body, purpose: 'otp', sensitive: true },
        { sensitive: true },
      );
    }
  });
  return {
    phoneNumber: phone,
    expiresInSeconds: CODE_TTL_MS / 1000,
    resendInSeconds: RESEND_MS / 1000,
    ...(config.EXPOSE_DEV_CODES ? { devCode: code } : {}),
  };
}

type VerifyOutcome = { ok: true; phone: string } | { ok: false; error: ApiError };

export async function verifyPhoneOtp(
  ctx: RequestContext,
  actor: Actor,
  code: string,
): Promise<VerifyPhoneOtpResponse> {
  const { deps } = ctx;
  // A wrong code's attempt must be committed, so failures are returned from the transaction, not thrown.
  let outcome: VerifyOutcome;
  try {
    outcome = await withTransaction(deps, async (tx): Promise<VerifyOutcome> => {
      const { rows } = await tx.query<ChallengeRow>(
        `SELECT phone_number, code_hash, attempts, expires_at, last_sent_at, window_started_at, send_count
           FROM otp_challenges WHERE user_id = $1 FOR NO KEY UPDATE`,
        [actor.uid],
      );
      const challenge = rows[0];
      if (!challenge)
        return {
          ok: false,
          error: new ApiError('failed-precondition', 'Request a verification code first.'),
        };
      if (challenge.expires_at <= tx.now) {
        return {
          ok: false,
          error: new ApiError('failed-precondition', 'This code has expired. Request a new one.'),
        };
      }
      if (challenge.attempts >= ATTEMPTS) {
        return {
          ok: false,
          error: new ApiError('resource-exhausted', 'Too many incorrect attempts. Request a new code.'),
        };
      }
      if (!safeEqualHex(codeHash(actor.uid, challenge.phone_number, code), challenge.code_hash)) {
        await tx.query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE user_id = $1', [actor.uid]);
        const left = ATTEMPTS - challenge.attempts - 1;
        return {
          ok: false,
          error: new ApiError(
            'invalid-argument',
            `That code is incorrect. ${left} attempt${left === 1 ? '' : 's'} left.`,
            null,
            { remaining: left },
          ),
        };
      }
      await tx.query('DELETE FROM otp_challenges WHERE user_id = $1', [actor.uid]);
      await tx.query(
        `UPDATE users SET phone_number = $2, phone_verified = true, updated_at = $3 WHERE id = $1`,
        [actor.uid, challenge.phone_number, new Date(tx.now)],
      );
      await publishUser(tx, actor.uid, actor.role);
      return { ok: true, phone: challenge.phone_number };
    });
  } catch (error) {
    if (pgCode(error) === '23505') {
      throw new ApiError('already-exists', 'This mobile number is already linked to another account.');
    }
    throw error;
  }
  if (!outcome.ok) throw outcome.error;
  return { phoneNumber: outcome.phone };
}

export function registerPhoneOtpCommands(): void {
  defineCommand({
    name: 'requestPhoneOtp',
    policy: requireRoleSet,
    schema: RequestPhoneOtpRequestSchema,
    handler: (ctx, req, actor) => requestPhoneOtp(ctx, actor!, req.phoneNumber),
  });
  defineCommand({
    name: 'verifyPhoneOtp',
    policy: requireRoleSet,
    schema: VerifyPhoneOtpRequestSchema,
    handler: (ctx, req, actor) => verifyPhoneOtp(ctx, actor!, req.code),
  });
}
