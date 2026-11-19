/** The `mail.send` outbox handler (docs/PLATFORM.md §9.3, §10.3). */
import { recordOutboxMessage, type OutboxPurpose } from '../dev-outbox';
import { MAX_ATTEMPTS } from '../outbox/outbox';
import { registerHandler } from '../outbox/registry';

export interface MailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
  purpose: OutboxPurpose;
  sensitive?: boolean;
}

export function registerMailHandler(): void {
  registerHandler<MailPayload>('mail.send', async (payload, { deps, attempt, eventId }) => {
    const { mail } = deps;
    const base = {
      channel: 'email' as const,
      to: payload.to,
      subject: payload.subject,
      body: payload.text,
      purpose: payload.purpose,
      provider: mail.driver,
      sensitive: payload.sensitive === true,
    };
    try {
      const { providerRef } = await mail.send({
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        ...(payload.html ? { html: payload.html } : {}),
        idempotencyKey: `outbox-${eventId}`,
      });
      await recordOutboxMessage(deps.pool, {
        ...base,
        status: mail.driver === 'outbox' ? 'stored' : 'sent',
        providerRef,
        error: null,
        now: deps.clock.now(),
      });
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS['mail.send']) {
        await recordOutboxMessage(deps.pool, {
          ...base,
          status: 'failed',
          providerRef: null,
          error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          now: deps.clock.now(),
        });
      }
      throw error;
    }
  });
}
