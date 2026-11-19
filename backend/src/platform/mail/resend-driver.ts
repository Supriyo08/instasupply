/** Resend's REST API, one fetch. The idempotency key (`outbox-{eventId}`) makes a retried event send once. */
import type { Config } from '../../config/env';
import type { MailSender } from './mail';

export function createResendMail(config: Config): MailSender {
  return {
    driver: 'resend',
    async send(message) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.RESEND_API_KEY!}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': message.idempotencyKey,
        },
        body: JSON.stringify({
          from: config.EMAIL_FROM,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`Resend answered ${response.status}`);
      const json = (await response.json().catch(() => ({}))) as { id?: string };
      return { providerRef: json.id ?? null };
    },
  };
}
