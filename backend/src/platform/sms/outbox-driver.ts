import type { SmsSender } from './sms';

/** Development and production before Twilio: the message only lands in dev_outbox (written by the handler). */
export const createOutboxSms = (): SmsSender => ({
  driver: 'outbox',
  send: async () => ({ providerRef: null }),
});
