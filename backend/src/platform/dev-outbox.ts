/**
 * One dev_outbox row per SMS or email, whatever the driver (docs/PLATFORM.md §10.3). Sensitive messages
 * that a real provider delivered keep no body: we do not store codes that were really sent.
 */
import type pg from 'pg';
import { newId } from './ids';
import { publishChange } from './live/publish';

export type OutboxPurpose = 'otp' | 'tracking_link' | 'store_alert' | 'other' | 'password_reset' | 'invite';
export const SENSITIVE_PURPOSES: ReadonlySet<OutboxPurpose> = new Set(['otp', 'password_reset', 'invite']);
const KEEP_MS = 7 * 86_400_000;

export async function recordOutboxMessage(
  pool: Pick<pg.Pool, 'query'>,
  input: {
    channel: 'sms' | 'email';
    to: string;
    subject: string | null;
    body: string;
    purpose: OutboxPurpose;
    provider: 'outbox' | 'twilio' | 'resend' | 'smtp';
    status: 'stored' | 'sent' | 'failed';
    providerRef: string | null;
    error: string | null;
    sensitive: boolean;
    now: number;
  },
): Promise<string> {
  const id = newId();
  const sensitive = input.sensitive || SENSITIVE_PURPOSES.has(input.purpose);
  const keepBody = input.provider === 'outbox' || !sensitive;
  await pool.query(
    `INSERT INTO dev_outbox (id, channel, to_address, subject, body, purpose, provider, status, provider_ref, error,
                             sensitive, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      input.channel,
      input.to,
      input.subject,
      keepBody ? input.body : null,
      input.purpose,
      input.provider,
      input.status,
      input.providerRef,
      input.error,
      sensitive,
      new Date(input.now),
      new Date(input.now + KEEP_MS),
    ],
  );
  await publishChange({ query: pool.query.bind(pool), now: input.now }, 'dev_outbox', 'created', { id });
  return id;
}
