/** SMS behind one interface (docs/PLATFORM.md §10.3). The `outbox` driver sends nothing; the handler stores every message. */
import type { Config } from '../../config/env';
import { createOutboxSms } from './outbox-driver';
import { createTwilioSms } from './twilio-driver';

export interface SmsSender {
  readonly driver: 'outbox' | 'twilio';
  send(message: { to: string; body: string }): Promise<{ providerRef: string | null }>;
}

export function createSms(config: Config): SmsSender {
  return config.SMS_DRIVER === 'twilio' ? createTwilioSms(config) : createOutboxSms();
}
