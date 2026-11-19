/** Twilio's Messages API, one fetch (port of legacy/…/sms/sms.ts). A non-2xx answer throws; the outbox retries. */
import type { Config } from '../../config/env';
import type { SmsSender } from './sms';

export function createTwilioSms(config: Config): SmsSender {
  const sid = config.TWILIO_ACCOUNT_SID!;
  const auth = `Basic ${Buffer.from(`${sid}:${config.TWILIO_AUTH_TOKEN!}`).toString('base64')}`;
  return {
    driver: 'twilio',
    async send(message) {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
        {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ To: message.to, From: config.TWILIO_FROM!, Body: message.body }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) throw new Error(`Twilio answered ${response.status}`);
      const json = (await response.json().catch(() => ({}))) as { sid?: string };
      return { providerRef: json.sid ?? null };
    },
  };
}
