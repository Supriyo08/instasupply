/** Any SMTP provider through nodemailer. SMTP has no idempotency: a crash after sending can duplicate. */
import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../../config/env';
import type { MailSender } from './mail';

export function createSmtpMail(config: Config): MailSender {
  // Created lazily: the server contacts no provider while it starts (§2.7).
  let transport: Transporter | null = null;
  return {
    driver: 'smtp',
    async send(message) {
      transport ??= nodemailer.createTransport(config.SMTP_URL!);
      const info = (await transport.sendMail({
        from: config.EMAIL_FROM!,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      })) as { messageId?: string };
      return { providerRef: info.messageId ?? null };
    },
  };
}
