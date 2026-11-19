/** The `sms.send` outbox handler (docs/PLATFORM.md §9.3, §10.3). */
import { recordOutboxMessage, type OutboxPurpose } from '../dev-outbox';
import { MAX_ATTEMPTS } from '../outbox/outbox';
import { registerHandler } from '../outbox/registry';

export interface SmsPayload {
  to: string;
  body: string;
  purpose: OutboxPurpose;
  sensitive?: boolean;
}

export function registerSmsHandler(): void {
  registerHandler<SmsPayload>('sms.send', async (payload, { deps, attempt }) => {
    const { sms } = deps;
    const base = {
      channel: 'sms' as const,
      to: payload.to,
      subject: null,
      body: payload.body,
      purpose: payload.purpose,
      provider: sms.driver,
      sensitive: payload.sensitive === true,
    };
    try {
      const { providerRef } = await sms.send({ to: payload.to, body: payload.body });
      await recordOutboxMessage(deps.pool, {
        ...base,
        status: sms.driver === 'outbox' ? 'stored' : 'sent',
        providerRef,
        error: null,
        now: deps.clock.now(),
      });
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS['sms.send']) {
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
