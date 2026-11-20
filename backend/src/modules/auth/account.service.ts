/**
 * The account flows of docs/PLATFORM.md §6.3: register, log in, refresh, log out, passwords and invites.
 * Each flow validates first, applies the limits of §4.6, then does its work in one short transaction.
 */
import {
  localDateOf,
  type AuthSessionResponse,
  type ClientApp,
  type InviteInfo,
  type Role,
  type StoreRole,
} from '@instasupply/shared';
import type { RequestContext } from '../../platform/http/context';
import { parseClientHeader } from '../../platform/http/context';
import { hmacHex, randomDigits, safeEqualHex } from '../../platform/crypto';
import { pgCode, withTransaction, type Tx } from '../../platform/db/tx';
import { ApiError, invalidArgument, notFound } from '../../platform/http/errors';
import { consumeAll, use } from '../../platform/http/rate-limit';
import { newId } from '../../platform/ids';
import { inviteMail, passwordResetMail } from '../../platform/mail/templates';
import { enqueue } from '../../platform/outbox/outbox';
import { dummyPasswordHash, hashPassword, needsRehash, verifyPassword } from '../../platform/auth/passwords';
import { suspendedError, unauthenticated } from '../../platform/auth/policies';
import {
  createSession,
  revokeAllSessions,
  revokeSession,
  rotate,
  type IssuedSession,
} from '../../platform/auth/sessions';
import {
  newSecret,
  formatSetPasswordToken,
  parseRefreshToken,
  parseSetPasswordToken,
  signAccessToken,
} from '../../platform/auth/tokens';
import { sha256Hex } from '../../platform/crypto';
import { notifyStaff } from '../notifications/notify';
import { loadMe } from './serializers';
import {
  countAuthTokenAttempt,
  countFailedLogin,
  deleteAuthToken,
  findActiveAuthToken,
  findAuthTokenById,
  findUserByEmail,
  findUserById,
  insertUser,
  lockUser,
  markAuthTokenUsed,
  normalizeEmail,
  recordLogin,
  replaceAuthToken,
  setPassword,
  type UserDoc,
} from './users.repository';

const DAY_MS = 86_400_000;
const RESET_CODE_MS = 15 * 60_000;
const RESET_ATTEMPTS = 5;
const RESET_FAILS_PER_DAY = 10;
const FAILED_LOGIN_ALERT = 10;
const WRONG_CREDENTIALS = 'That email and password combination is incorrect.';
const WRONG_RESET_CODE = 'That code is incorrect or has expired.';

/** `YYYYMMDD` of an instant in Toronto: the day part of alert keys. */
const dayKey = (ms: number): string => localDateOf(ms).replace(/-/g, '');

export const ipSubject = (ctx: RequestContext): string => hmacHex('ip', ctx.ip);
const emailSubject = (email: string): string => hmacHex('email', normalizeEmail(email));

/** The session row's device fields, from the X-Client header and the request (§4.1). */
function sessionDevice(ctx: RequestContext, request: { headers: Record<string, unknown> }) {
  const client = parseClientHeader(ctx.client);
  const userAgent = request.headers['user-agent'];
  return {
    platform: client.platform,
    appVersion: client.version,
    deviceName: null,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
    ipHash: ipSubject(ctx),
  };
}

/** The token pair plus `me` (§6.2): what register, login, refresh and password/setup answer. */
async function sessionResponse(
  ctx: RequestContext,
  uid: string,
  session: { sessionId: string; refreshToken: string; refreshTokenExpiresAt: number },
): Promise<AuthSessionResponse> {
  const { deps } = ctx;
  const now = deps.clock.now();
  const accessToken = await signAccessToken(deps.config, { uid, sessionId: session.sessionId, now });
  return {
    accessToken,
    accessTokenTtlSeconds: deps.config.ACCESS_TOKEN_TTL_SECONDS,
    refreshToken: session.refreshToken,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt,
    sessionId: session.sessionId,
    me: await loadMe(deps.pool, uid, ctx.origin, now),
  };
}

type RequestLike = { headers: Record<string, unknown> };

// ---------- register (§6.3.1) ----------

export async function register(
  ctx: RequestContext,
  request: RequestLike,
  input: { email: string; password: string; displayName: string; installationId: string; app: ClientApp },
): Promise<AuthSessionResponse> {
  const { deps } = ctx;
  await consumeAll(deps, [use('signup_ip', ipSubject(ctx))]);
  const taken = () =>
    new ApiError('already-exists', 'An account with this email already exists. Try signing in.');
  if (await findUserByEmail(deps.pool, input.email)) throw taken();
  const hash = await hashPassword(input.password);
  const uid = newId();
  let session: IssuedSession;
  try {
    session = await withTransaction(deps, async (tx) => {
      await insertUser(tx, {
        id: uid,
        email: input.email,
        passwordHash: hash,
        role: null,
        status: 'active',
        displayName: input.displayName,
        doc: {},
      });
      return createSession(tx, deps.config, {
        userId: uid,
        app: input.app,
        installationId: input.installationId,
        ...sessionDevice(ctx, request),
      });
    });
  } catch (error) {
    // A concurrent registration of the same email won the unique index.
    if (pgCode(error) === '23505') throw taken();
    throw error;
  }
  return sessionResponse(ctx, uid, session);
}

// ---------- log in (§6.3.4) ----------

/** Known install (a session active or ended in the last 90 days) or a known address used in the last 30 days. */
async function isTrusted(ctx: RequestContext, uid: string, installationId: string): Promise<boolean> {
  const now = ctx.deps.clock.now();
  const { rows } = await ctx.deps.pool.query(
    `SELECT 1 FROM sessions
      WHERE user_id = $1 AND (
        (installation_id = $2 AND COALESCE(revoked_at, expires_at) > $3)
        OR (ip_hash = $4 AND last_used_at > $5))
      LIMIT 1`,
    [uid, installationId, new Date(now - 90 * DAY_MS), ipSubject(ctx), new Date(now - 30 * DAY_MS)],
  );
  return rows.length > 0;
}

export async function login(
  ctx: RequestContext,
  request: RequestLike,
  input: { email: string; password: string; installationId: string; app: ClientApp },
): Promise<AuthSessionResponse> {
  const { deps } = ctx;
  await consumeAll(deps, [use('login_ip', ipSubject(ctx))]);
  const user = await findUserByEmail(deps.pool, input.email);
  const trusted = user !== null && (await isTrusted(ctx, user.id, input.installationId));
  // Consumed whether or not an account has the email, so the limit reveals nothing.
  if (!trusted) await consumeAll(deps, [use('login_email', emailSubject(input.email))]);

  if (!user || user.password_hash === null) {
    await verifyPassword(input.password, await dummyPasswordHash());
    throw unauthenticated('credentials', WRONG_CREDENTIALS);
  }
  if (!(await verifyPassword(input.password, user.password_hash))) {
    const failures = await countFailedLogin(deps.pool, user.id);
    if (failures === FAILED_LOGIN_ALERT) {
      const day = dayKey(deps.clock.now());
      await withTransaction(deps, (tx) =>
        notifyStaff(
          tx,
          {
            type: 'system',
            title: 'Repeated sign-in failures',
            body: `${user.display_name || 'An account'} had ${FAILED_LOGIN_ALERT} wrong passwords in a row.`,
            key: `login-failures-${user.id}-${day}`,
          },
          { adminsOnly: true },
        ),
      ).catch((error: unknown) =>
        ctx.log.error({ err: error }, 'could not alert admins about sign-in failures'),
      );
    }
    throw unauthenticated('credentials', WRONG_CREDENTIALS);
  }
  if (user.status === 'suspended') throw suspendedError();

  const rehash = needsRehash(user.password_hash) ? await hashPassword(input.password) : null;
  const session = await withTransaction(deps, async (tx) => {
    await lockUser(tx, user.id);
    await recordLogin(tx, user.id, rehash);
    return createSession(tx, deps.config, {
      userId: user.id,
      app: input.app,
      installationId: input.installationId,
      ...sessionDevice(ctx, request),
    });
  });
  return sessionResponse(ctx, user.id, session);
}

// ---------- refresh (§6.3.5) ----------

export async function refresh(ctx: RequestContext, refreshToken: string): Promise<AuthSessionResponse> {
  const { deps } = ctx;
  await consumeAll(deps, [use('refresh_ip', ipSubject(ctx))]);
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) throw unauthenticated('token_invalid');
  // The revocations of reuse detection and suspension commit before the error is answered.
  const result = await withTransaction(deps, async (tx) => {
    const rotated = await rotate(tx, deps.config, parsed, safeEqualHex);
    if (rotated.ok) await deps.hooks.at('refresh:afterRotate');
    return rotated;
  });
  if (!result.ok) {
    if (result.reason === 'account_suspended') throw suspendedError();
    throw unauthenticated(result.reason);
  }
  return sessionResponse(ctx, result.userId, result);
}

// ---------- log out (§6.3.6) ----------

/** Always succeeds: unknown, used, expired or already revoked tokens answer 204 too. */
export async function logout(ctx: RequestContext, refreshToken: string): Promise<void> {
  const parsed = parseRefreshToken(refreshToken);
  if (!parsed) return;
  const { deps } = ctx;
  const { rows } = await deps.pool.query<{ session_id: string; token_hash: string }>(
    'SELECT session_id, token_hash FROM refresh_tokens WHERE id = $1',
    [parsed.tokenId],
  );
  const row = rows[0];
  if (!row || !safeEqualHex(sha256Hex(parsed.secret), row.token_hash)) return;
  await withTransaction(deps, (tx) => revokeSession(tx, row.session_id, 'logout'));
}

export async function logoutAll(ctx: RequestContext, uid: string): Promise<void> {
  await withTransaction(ctx.deps, (tx) => revokeAllSessions(tx, uid, 'logout'));
}

// ---------- passwords (§6.3.7) ----------

export async function changePassword(
  ctx: RequestContext,
  actor: { uid: string; sessionId: string },
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const { deps } = ctx;
  await consumeAll(deps, [use('password_change', actor.uid)]);
  const user = await findUserById(deps.pool, actor.uid);
  if (!user?.password_hash || !(await verifyPassword(input.currentPassword, user.password_hash))) {
    if (user) await countFailedLogin(deps.pool, user.id);
    invalidArgument('Your current password is incorrect.', { fields: { currentPassword: 'incorrect' } });
  }
  const hash = await hashPassword(input.newPassword);
  await withTransaction(deps, async (tx) => {
    await lockUser(tx, actor.uid);
    await setPassword(tx, actor.uid, hash);
    await revokeAllSessions(tx, actor.uid, 'password_changed', { except: actor.sessionId });
  });
}

/** True when the account used up its 10 wrong reset codes of the last 24 hours. */
async function resetLocked(ctx: RequestContext, uid: string): Promise<boolean> {
  const { rows } = await ctx.deps.pool.query<{ count: number }>(
    `SELECT count FROM rate_limits WHERE bucket = 'reset_fail_user' AND subject = $1 AND expires_at > $2`,
    [uid, new Date(ctx.deps.clock.now())],
  );
  return (rows[0]?.count ?? 0) >= RESET_FAILS_PER_DAY;
}

/** Always 204 after the same work, whether or not the email has an account (§6.3.7). */
export async function forgotPassword(ctx: RequestContext, email: string): Promise<void> {
  const { deps } = ctx;
  await consumeAll(deps, [use('reset_ip', ipSubject(ctx)), use('reset_email', emailSubject(email))]);
  const user = await findUserByEmail(deps.pool, email);
  const code = randomDigits(6);
  if (!user || user.status === 'suspended' || (await resetLocked(ctx, user.id))) {
    // Same cost as the real branch: one HMAC and one round trip.
    hmacHex('reset', `none:${code}`);
    await deps.pool.query('SELECT 1');
    return;
  }
  await withTransaction(deps, async (tx) => {
    await replaceAuthToken(tx, {
      id: newId(),
      userId: user.id,
      purpose: 'password_reset',
      secretHash: hmacHex('reset', `${user.id}:${code}`),
      expiresAt: tx.now + RESET_CODE_MS,
      createdBy: null,
    });
    const mail = passwordResetMail(code);
    await enqueue(
      tx,
      'mail.send',
      { to: user.email, ...mail, purpose: 'password_reset', sensitive: true },
      { sensitive: true },
    );
  });
}

export async function resetPassword(
  ctx: RequestContext,
  input: { email: string; code: string; newPassword: string },
): Promise<void> {
  const { deps } = ctx;
  await consumeAll(deps, [use('reset_ip', ipSubject(ctx))]);
  const wrong = () => invalidArgument(WRONG_RESET_CODE);
  const user = await findUserByEmail(deps.pool, input.email);
  if (!user) return wrong();
  // Every guess is judged under the user's row lock (rank 1) and the token's lock, and a wrong one is
  // counted before the answer leaves: parallel guesses queue here, so the caps of 5 per code and 10 per
  // day hold however many requests arrive at once.
  const outcome = await withTransaction(deps, async (tx): Promise<'wrong' | 'locked' | 'right'> => {
    await lockUser(tx, user.id);
    const token = await findActiveAuthToken(tx, user.id, 'password_reset', true);
    if (!token || token.expires_at <= tx.now || token.attempts >= RESET_ATTEMPTS) return 'wrong';
    if ((await resetFailures(tx, user.id)) >= RESET_FAILS_PER_DAY) {
      await deleteAuthToken(tx, token.id);
      return 'wrong';
    }
    if (
      /^\d{6}$/.test(input.code) &&
      safeEqualHex(hmacHex('reset', `${user.id}:${input.code}`), token.secret_hash)
    ) {
      // Claimed now so a second right answer in flight cannot use the same code.
      await markAuthTokenUsed(tx, token.id);
      return 'right';
    }
    await countAuthTokenAttempt(tx, token.id);
    // A business rule, not a flood guard: counted even when RATE_LIMITS_DISABLED is set.
    const fails = await countResetFailure(tx, user.id);
    if (fails < RESET_FAILS_PER_DAY) return 'wrong';
    await deleteAuthToken(tx, token.id);
    return fails === RESET_FAILS_PER_DAY ? 'locked' : 'wrong';
  });
  if (outcome === 'locked') {
    await withTransaction(deps, (tx) =>
      notifyStaff(
        tx,
        {
          type: 'system',
          title: 'Password reset blocked',
          body: `${user.display_name || 'An account'} entered ${RESET_FAILS_PER_DAY} wrong reset codes today. No new code is sent for 24 hours.`,
          key: `reset-locked-${user.id}-${dayKey(deps.clock.now())}`,
        },
        { adminsOnly: true },
      ),
    ).catch((error: unknown) =>
      ctx.log.error({ err: error }, 'could not alert admins about a reset lockout'),
    );
  }
  if (outcome !== 'right') return wrong();
  // scrypt runs outside the locks; the code is already used up, so nothing can race this write.
  const hash = await hashPassword(input.newPassword);
  await withTransaction(deps, async (tx) => {
    await lockUser(tx, user.id);
    await setPassword(tx, user.id, hash);
    await revokeAllSessions(tx, user.id, 'password_reset');
  });
}

/** The account's wrong reset codes in the current 24-hour window (bucket reset_fail_user, §4.6). */
async function resetFailures(tx: Tx, uid: string): Promise<number> {
  const { rows } = await tx.query<{ count: number }>(
    `SELECT count FROM rate_limits WHERE bucket = 'reset_fail_user' AND subject = $1 AND expires_at > $2`,
    [uid, new Date(tx.now)],
  );
  return rows[0]?.count ?? 0;
}

/** hitRateLimit's upsert, inside the caller's transaction so the count commits with the attempt. */
async function countResetFailure(tx: Tx, uid: string): Promise<number> {
  const { rows } = await tx.query<{ count: number }>(
    `INSERT INTO rate_limits AS r (bucket, subject, count, window_start, expires_at)
     VALUES ('reset_fail_user', $1, 1, $2, $3)
     ON CONFLICT (bucket, subject) DO UPDATE SET
       count        = CASE WHEN r.expires_at <= EXCLUDED.window_start THEN 1 ELSE r.count + 1 END,
       window_start = CASE WHEN r.expires_at <= EXCLUDED.window_start THEN EXCLUDED.window_start ELSE r.window_start END,
       expires_at   = CASE WHEN r.expires_at <= EXCLUDED.window_start THEN EXCLUDED.expires_at ELSE r.expires_at END
     RETURNING count`,
    [uid, new Date(tx.now), new Date(tx.now + 86_400_000)],
  );
  return rows[0]!.count;
}

// ---------- invites and set-password links (§6.3.8) ----------

export interface InviteInput {
  email: string;
  displayName: string;
  role: Role;
  storeId?: string | null;
  storeRole?: StoreRole | null;
  invitedBy: string | null;
  doc: UserDoc;
}

/**
 * Creates the account without a password (or reuses a not-yet-activated one with the same role and store),
 * replaces its set-password token and enqueues the invite mail. Runs inside the caller's transaction.
 */
export async function inviteUser(
  tx: Tx,
  config: { WEB_URL: string; INVITE_LINK_TTL_HOURS: number },
  input: InviteInput,
): Promise<{ uid: string; passwordSetupLink: string }> {
  const email = normalizeEmail(input.email);
  const { rows } = await tx.query<{
    id: string;
    role: Role | null;
    store_id: string | null;
    password_hash: string | null;
  }>('SELECT id, role, store_id, password_hash FROM users WHERE lower(email) = $1 FOR NO KEY UPDATE', [
    email,
  ]);
  const existing = rows[0];
  let uid: string;
  if (existing) {
    const same = existing.role === input.role && (existing.store_id ?? null) === (input.storeId ?? null);
    if (!same || existing.password_hash !== null) {
      throw new ApiError('already-exists', 'Someone with this email already has an account.');
    }
    uid = existing.id;
  } else {
    uid = newId();
    await insertUser(tx, {
      id: uid,
      email,
      passwordHash: null,
      role: input.role,
      status: 'active',
      displayName: input.displayName,
      storeId: input.storeId ?? null,
      storeRole: input.storeRole ?? null,
      doc: input.doc,
    });
  }
  const tokenId = newId();
  const secret = newSecret();
  await replaceAuthToken(tx, {
    id: tokenId,
    userId: uid,
    purpose: 'set_password',
    secretHash: hmacHex('invite', secret),
    expiresAt: tx.now + config.INVITE_LINK_TTL_HOURS * 3_600_000,
    createdBy: input.invitedBy,
  });
  // The secret travels in the fragment, which browsers never send to a server (§6.2).
  const passwordSetupLink = `${config.WEB_URL}/set-password#token=${formatSetPasswordToken(tokenId, secret)}`;
  const mail = inviteMail({
    displayName: input.displayName,
    link: passwordSetupLink,
    hours: config.INVITE_LINK_TTL_HOURS,
  });
  await enqueue(
    tx,
    'mail.send',
    { to: email, ...mail, purpose: 'invite', sensitive: true },
    { sensitive: true },
  );
  return { uid, passwordSetupLink };
}

async function validInvite(ctx: RequestContext, token: string, lockTx?: Tx) {
  const parsed = parseSetPasswordToken(token);
  if (!parsed) return null;
  const row = await findAuthTokenById(lockTx ?? ctx.deps.pool, parsed.tokenId, lockTx !== undefined);
  const now = ctx.deps.clock.now();
  if (
    !row ||
    row.purpose !== 'set_password' ||
    row.used_at !== null ||
    row.expires_at <= now ||
    !safeEqualHex(hmacHex('invite', parsed.secret), row.secret_hash)
  ) {
    return null;
  }
  return row;
}

const INVITE_GONE = 'This link is no longer valid. Ask for a new invitation.';

export async function inspectInvite(ctx: RequestContext, token: string): Promise<InviteInfo> {
  await consumeAll(ctx.deps, [use('reset_ip', ipSubject(ctx))]);
  const row = await validInvite(ctx, token);
  const user = row ? await findUserById(ctx.deps.pool, row.user_id) : null;
  if (!row || !user || user.role === null) notFound(INVITE_GONE);
  return { email: user.email, displayName: user.display_name, role: user.role, expiresAt: row.expires_at };
}

export async function setupPassword(
  ctx: RequestContext,
  request: RequestLike,
  input: { token: string; password: string; installationId: string; app: ClientApp },
): Promise<AuthSessionResponse> {
  const { deps } = ctx;
  await consumeAll(deps, [use('reset_ip', ipSubject(ctx))]);
  const preview = await validInvite(ctx, input.token);
  if (!preview) notFound(INVITE_GONE);
  const hash = await hashPassword(input.password);
  const session = await withTransaction(deps, async (tx) => {
    const user = await lockUser(tx, preview.user_id);
    const row = await validInvite(ctx, input.token, tx);
    if (!user || !row) notFound(INVITE_GONE);
    if (user.status === 'suspended') throw suspendedError();
    await setPassword(tx, user.id, hash);
    await markAuthTokenUsed(tx, row.id);
    return createSession(tx, deps.config, {
      userId: user.id,
      app: input.app,
      installationId: input.installationId,
      ...sessionDevice(ctx, request),
    });
  });
  return sessionResponse(ctx, preview.user_id, session);
}
