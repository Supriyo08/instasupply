/**
 * modules/payments (docs/PLATFORM.md §10.4, §9.3, §9.5): the outbox handlers payment.finalize, payment.refund
 * and payment.void, the captureDuePayments job, and the §9.1 helpers other modules call.
 */
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../container';
import { registerHandler } from '../../platform/outbox/registry';
import { registerJob } from '../../platform/scheduler/registry';
import { runCaptureDuePayments } from './capture-sweep';
import { finalizeOrderPayment, refundOrderPayment, voidOrderAuthorization } from './payment-service';

export {
  attachAuthorization,
  authorizeOrderPayment,
  AuthorizationLost,
  finalizeOrderPayment,
  OrderAlreadyPlaced,
  refundOrderPayment,
  voidOrderAuthorization,
} from './payment-service';
export { runCaptureDuePayments } from './capture-sweep';

interface FinalizePayload {
  orderId: string;
  deadline?: boolean;
}
interface RefundPayload {
  orderId: string;
  storeOrderId: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
  issueId: string | null;
}
interface VoidPayload {
  orderId: string;
}

export function register(_app: FastifyInstance, _deps: Deps): void {
  registerHandler<FinalizePayload>('payment.finalize', (payload, ctx) =>
    finalizeOrderPayment(ctx.deps, payload.orderId, { deadline: payload.deadline === true }),
  );
  registerHandler<RefundPayload>('payment.refund', async (payload, ctx) => {
    await refundOrderPayment(ctx.deps, payload);
  });
  registerHandler<VoidPayload>('payment.void', (payload, ctx) =>
    voidOrderAuthorization(ctx.deps, payload.orderId),
  );
  registerJob({ name: 'captureDuePayments', schedule: { everyMs: 30 * 60_000 }, run: runCaptureDuePayments });
}
