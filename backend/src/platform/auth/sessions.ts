/**
 * Sessions and refresh tokens (docs/PLATFORM.md §6.2, §6.3.5, §6.3.6). Only hashes are stored. Every
 * revocation, whatever its reason, runs the same clean-up: the device row goes (no push to a signed-out
 * phone), sockets are dropped, and a driver's `driver` session takes the driver offline.
 */
import type { ClientApp, DevicePlatform } from '@instasupply/shared';
import type { Config } from '../../config/env';
import { sha256Hex } from '../crypto';
import type { Tx } from '../db/tx';
import { newId } from '../ids';
import { publishChange, publishControl } from '../live/publish';
import { formatRefreshToken, newSecret } from './tokens';

export type RevokeReason =
  | 'logout'
  | 'password_changed'
  | 'password_reset'
  | 'suspended'
  | 'reuse_detected'
  | 'removed'
  | 'expired'
  | 'admin';

export const MAX_ACTIVE_SESSIONS = 10;
const DAY_MS = 86_400_000;

type SessionConfig = Pick<Config, 'REFRESH_TOKEN_TTL_DAYS' | 'SESSION_MAX_DAYS'>;

export interface SessionInput {
  userId: string;
  app: ClientApp;
  installationId: string;
  platform: DevicePlatform | null;
  appVersion: string | null;
  deviceName: string | null;
  userAgent: string | null;
  ipHash: string | null;
}

export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  refreshTokenExpiresAt: number;
}

interface RevokedRow {
  id: string;
  user_id: string;
  installation_id: string;
  app: ClientApp;
  role: string | null;
}

/** Inserts one refresh token of a session; `expires_at = min(now + REFRESH_TOKEN_TTL_DAYS, session end)`. */
export async function issueRefreshToken(
  tx: Tx,
  config: SessionConfig,
  input: { sessionId: string; sessionExpiresAt: number; parentId: string | null },
): Promise<{ tokenId: string; refreshToken: string; expiresAt: number }> {
  const tokenId = newId();
  const secret = newSecret();
  const expiresAt = Math.min(tx.now + config.REFRESH_TOKEN_TTL_DAYS * DAY_MS, input.sessionExpiresAt);
  await tx.query(
    `INSERT INTO refresh_tokens (id, session_id, token_hash, created_at, expires_at, parent_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tokenId, input.sessionId, sha256Hex(secret), new Date(tx.now), new Date(expiresAt), input.parentId],
  );
  return { tokenId, refreshToken: formatRefreshToken(tokenId, secret), expiresAt };
}

/**
 * A new session for a sign-in (§6.3.4 step 8). The user row must be locked by the caller. A previous active
 * session of the same install is revoked (`removed`); at most 10 stay active, the least recently used goes.
 */
export async function createSession(
  tx: Tx,
  config: SessionConfig,
  input: SessionInput,
): Promise<IssuedSession> {
  const { rows: previous } = await tx.query<{ id: string }>(
    `SELECT id FROM sessions WHERE user_id = $1 AND installation_id = $2 AND revoked_at IS NULL ORDER BY id`,
    [input.userId, input.installationId],
  );
  await revokeSessions(
    tx,
    previous.map((row) => row.id),
    'removed',
  );

  const { rows: active } = await tx.query<{ id: string }>(
    `SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2
      ORDER BY last_used_at DESC, id DESC`,
    [input.userId, new Date(tx.now)],
  );
  if (active.length >= MAX_ACTIVE_SESSIONS) {
    await revokeSessions(
      tx,
      active.slice(MAX_ACTIVE_SESSIONS - 1).map((row) => row.id),
      'removed',
    );
  }

  const sessionId = newId();
  const sessionExpiresAt = tx.now + config.SESSION_MAX_DAYS * DAY_MS;
  await tx.query(
    `INSERT INTO sessions (id, user_id, app, installation_id, platform, app_version, device_name, user_agent, ip_hash,
                           created_at, last_used_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11)`,
    [
      sessionId,
      input.userId,
      input.app,
      input.installationId,
      input.platform,
      input.appVersion,
      input.deviceName,
      input.userAgent ? input.userAgent.slice(0, 300) : null,
      input.ipHash,
      new Date(tx.now),
      new Date(sessionExpiresAt),
    ],
  );
  const token = await issueRefreshToken(tx, config, { sessionId, sessionExpiresAt, parentId: null });
  return { sessionId, refreshToken: token.refreshToken, refreshTokenExpiresAt: token.expiresAt };
}

/** Revokes the given sessions (those still active) and runs the clean-up of §6.3.6. Returns the revoked ids. */
export async function revokeSessions(
  tx: Tx,
  sessionIds: readonly string[],
  reason: RevokeReason,
): Promise<string[]> {
  if (sessionIds.length === 0) return [];
  const { rows } = await tx.query<RevokedRow>(
    `UPDATE sessions s SET revoked_at = $2, revoked_reason = $3
       FROM users u
      WHERE s.id = ANY($1::text[]) AND s.revoked_at IS NULL AND u.id = s.user_id
      RETURNING s.id, s.user_id, s.installation_id, s.app, u.role`,
    [[...sessionIds], new Date(tx.now), reason],
  );
  for (const row of rows) {
    await tx.query('DELETE FROM devices WHERE user_id = $1 AND installation_id = $2', [
      row.user_id,
      row.installation_id,
    ]);
    if (row.app === 'driver' && row.role === 'driver') await setDriverOffline(tx, row.user_id);
    await publishControl(tx, { ctl: 'drop_session', sid: row.id });
  }
  return rows.map((row) => row.id);
}

export async function revokeSession(tx: Tx, sessionId: string, reason: RevokeReason): Promise<boolean> {
  return (await revokeSessions(tx, [sessionId], reason)).length > 0;
}

/** Every active session of a user, optionally except one (password change keeps the current session). */
export async function revokeAllSessions(
  tx: Tx,
  userId: string,
  reason: RevokeReason,
  opts: { except?: string } = {},
): Promise<string[]> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR id <> $2) ORDER BY id`,
    [userId, opts.except ?? null],
  );
  return revokeSessions(
    tx,
    rows.map((row) => row.id),
    reason,
  );
}

/** A signed-out or suspended driver stops getting job offers even if the app's last "offline" report failed. */
export async function setDriverOffline(tx: Tx, driverId: string): Promise<void> {
  const { rows } = await tx.query<{
    lat: number;
    lng: number;
    heading: number | null;
    speed: number | null;
    accuracy: number | null;
    battery: number | null;
    updated_at: number;
  }>(
    `UPDATE driver_locations SET online = false, updated_at = $2 WHERE driver_id = $1 AND online
     RETURNING lat, lng, heading, speed, accuracy, battery, updated_at`,
    [driverId, new Date(tx.now)],
  );
  const row = rows[0];
  if (!row) return;
  await publishChange(tx, 'driver_locations', 'updated', {
    id: driverId,
    lat: row.lat,
    lng: row.lng,
    heading: row.heading,
    speed: row.speed,
    accuracy: row.accuracy,
    online: false,
    battery: row.battery,
    updatedAt: row.updated_at,
  });
}

export const MAX_REPEATS = 5;

export type RotateResult =
  | { ok: true; sessionId: string; userId: string; refreshToken: string; refreshTokenExpiresAt: number }
  | {
      ok: false;
      reason: 'token_invalid' | 'token_expired' | 'session_revoked' | 'refresh_reused' | 'account_suspended';
    };

interface TokenRow {
  id: string;
  session_id: string;
  token_hash: string;
  expires_at: number;
  used_at: number | null;
  parent_id: string | null;
  superseded_at: number | null;
}

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: number;
  revoked_at: number | null;
  revoked_reason: string | null;
}

/**
 * Refresh with rotation and reuse detection (§6.3.5, step 2). Failures that revoke the session are returned,
 * not thrown, so the caller commits the revocation before it answers the error.
 */
export async function rotate(
  tx: Tx,
  config: SessionConfig,
  token: { tokenId: string; secret: string },
  safeEqual: (a: string, b: string) => boolean,
): Promise<RotateResult> {
  const { rows: tokens } = await tx.query<TokenRow>(
    `SELECT id, session_id, token_hash, expires_at, used_at, parent_id, superseded_at
       FROM refresh_tokens WHERE id = $1 FOR NO KEY UPDATE`,
    [token.tokenId],
  );
  const row = tokens[0];
  if (!row || !safeEqual(sha256Hex(token.secret), row.token_hash))
    return { ok: false, reason: 'token_invalid' };
  const { rows: sessions } = await tx.query<SessionRow>(
    `SELECT id, user_id, expires_at, revoked_at, revoked_reason FROM sessions WHERE id = $1 FOR NO KEY UPDATE`,
    [row.session_id],
  );
  const session = sessions[0];
  if (!session) return { ok: false, reason: 'token_invalid' };
  const { rows: users } = await tx.query<{ status: string }>('SELECT status FROM users WHERE id = $1', [
    session.user_id,
  ]);

  if (users[0]?.status === 'suspended' || session.revoked_reason === 'suspended') {
    if (session.revoked_at === null) await revokeSession(tx, session.id, 'suspended');
    return { ok: false, reason: 'account_suspended' };
  }
  if (session.revoked_at !== null) return { ok: false, reason: 'session_revoked' };
  if (row.expires_at <= tx.now || session.expires_at <= tx.now) return { ok: false, reason: 'token_expired' };

  const reuse = async (): Promise<RotateResult> => {
    await revokeSession(tx, session.id, 'reuse_detected');
    return { ok: false, reason: 'refresh_reused' };
  };
  if (row.superseded_at !== null) return reuse();

  if (row.used_at !== null) {
    const { rows: children } = await tx.query<{ n: number; used: boolean }>(
      `SELECT count(*)::int AS n, COALESCE(bool_or(used_at IS NOT NULL), false) AS used
         FROM refresh_tokens WHERE parent_id = $1`,
      [row.id],
    );
    const { n, used } = children[0] ?? { n: 0, used: false };
    // The chain moved on (a child was used), or a sixth repeat: the token was replayed.
    if (used || n >= MAX_REPEATS) return reuse();
  } else {
    await tx.query('UPDATE refresh_tokens SET used_at = $2 WHERE id = $1', [row.id, new Date(tx.now)]);
    if (row.parent_id !== null) {
      // Its unused siblings (children of earlier repeats of the same parent) can never be used now.
      await tx.query(
        `UPDATE refresh_tokens SET superseded_at = $3
          WHERE parent_id = $1 AND id <> $2 AND used_at IS NULL AND superseded_at IS NULL`,
        [row.parent_id, row.id, new Date(tx.now)],
      );
    }
  }

  const child = await issueRefreshToken(tx, config, {
    sessionId: session.id,
    sessionExpiresAt: session.expires_at,
    parentId: row.id,
  });
  await tx.query('UPDATE refresh_tokens SET replaced_by = $2 WHERE id = $1', [row.id, child.tokenId]);
  await tx.query('UPDATE sessions SET last_used_at = $2 WHERE id = $1', [session.id, new Date(tx.now)]);
  return {
    ok: true,
    sessionId: session.id,
    userId: session.user_id,
    refreshToken: child.refreshToken,
    refreshTokenExpiresAt: child.expiresAt,
  };
}
