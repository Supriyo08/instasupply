import type { MailSender } from './mail';

/** Stored only: the handler writes the dev_outbox row, where admins read reset codes and invite links. */
export const createOutboxMail = (): MailSender => ({
  driver: 'outbox',
  send: async () => ({ providerRef: null }),
});
