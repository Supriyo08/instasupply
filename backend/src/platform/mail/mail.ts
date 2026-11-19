/** Email behind one interface (docs/PLATFORM.md §10.3). */
import type { Config } from '../../config/env';
import { createOutboxMail } from './outbox-driver';
import { createResendMail } from './resend-driver';
import { createSmtpMail } from './smtp-driver';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  idempotencyKey: string;
}

export interface MailSender {
  readonly driver: 'outbox' | 'resend' | 'smtp';
  send(message: MailMessage): Promise<{ providerRef: string | null }>;
}

export function createMail(config: Config): MailSender {
  switch (config.EMAIL_DRIVER) {
    case 'resend':
      return createResendMail(config);
    case 'smtp':
      return createSmtpMail(config);
    case 'outbox':
      return createOutboxMail();
  }
}
