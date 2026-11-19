/**
 * Outbound SMS. Uses Twilio when configured; otherwise writes to the dev outbox (visible to staff
 * in the back office) so OTP codes and tracking links can be tested without a provider.
 */
import { COLLECTIONS, type DevOutboxMessage } from '@instasupply/shared';
import * as logger from 'firebase-functions/logger';

import { isEmulator, settings } from '../../config/runtime';
import { db, serverTimestamp, Timestamp } from '../../lib/admin';
import { failedPrecondition } from '../../lib/errors';

export interface SmsMessage {
  to: string;
  body: string;
  purpose: DevOutboxMessage['purpose'];
}

const OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export async function sendSms(message: SmsMessage): Promise<'sent' | 'outbox'> {
  const twilio = settings.twilio;
  if (twilio) {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilio.accountSid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: message.to, From: twilio.from, Body: message.body }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      logger.error('Twilio rejected SMS', { status: response.status, detail: detail.slice(0, 500) });
      throw new Error(`SMS provider error (${response.status}).`);
    }
    return 'sent';
  }

  if (!isEmulator && message.purpose === 'otp') {
    failedPrecondition('SMS verification is not configured yet. Please contact support.');
  }

  await db.collection(COLLECTIONS.devOutbox).add({
    channel: 'sms',
    to: message.to,
    body: message.body,
    purpose: message.purpose,
    createdAt: serverTimestamp(),
    // TTL policy on this field cleans up old entries automatically.
    expiresAt: Timestamp.fromMillis(Date.now() + OUTBOX_RETENTION_MS),
  });
  logger.info('SMS written to dev outbox', { to: message.to, purpose: message.purpose });
  return 'outbox';
}
