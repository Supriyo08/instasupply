/**
 * The two collaborators a test context replaces (docs/PLATFORM.md §12): a recording wrapper around
 * TestGateway, and a push client that records instead of calling Expo.
 */
import type { PaymentGateway } from '../../src/platform/payments/gateway';
import { TestGateway } from '../../src/platform/payments/test-gateway';
import type { ExpoMessage, ExpoReceipt, ExpoTicket, PushClient } from '../../src/platform/push/expo';
import type { Clock } from '../../src/platform/clock';

type Op = 'authorize' | 'capture' | 'void' | 'refund' | 'transfer';

export interface GatewayCall<O extends Op = Op> {
  op: O;
  input: Parameters<PaymentGateway[O]>[0];
  result: Awaited<ReturnType<PaymentGateway[O]>> | undefined;
  at: number;
}

/** TestGateway's answers (decline by last 4, 0341 failing captures), with every call kept for assertions. */
export class RecordingGateway implements PaymentGateway {
  readonly mode = 'test' as const;
  readonly calls: GatewayCall[] = [];
  private readonly inner: TestGateway;

  constructor(private readonly clock: Clock) {
    this.inner = new TestGateway(clock);
  }

  private async record<O extends Op>(
    op: O,
    input: Parameters<PaymentGateway[O]>[0],
    run: () => Promise<Awaited<ReturnType<PaymentGateway[O]>>>,
  ): Promise<Awaited<ReturnType<PaymentGateway[O]>>> {
    const entry: GatewayCall<O> = { op, input, result: undefined, at: this.clock.now() };
    this.calls.push(entry as unknown as GatewayCall);
    entry.result = await run();
    return entry.result;
  }

  authorize(i: Parameters<PaymentGateway['authorize']>[0]) {
    return this.record('authorize', i, () => this.inner.authorize(i));
  }
  capture(i: Parameters<PaymentGateway['capture']>[0]) {
    return this.record('capture', i, () => this.inner.capture(i));
  }
  void(i: Parameters<PaymentGateway['void']>[0]) {
    return this.record('void', i, () => this.inner.void());
  }
  refund(i: Parameters<PaymentGateway['refund']>[0]) {
    return this.record('refund', i, () => this.inner.refund(i));
  }
  transfer(i: Parameters<PaymentGateway['transfer']>[0]) {
    return this.record('transfer', i, () => this.inner.transfer(i));
  }

  of<O extends Op>(op: O): GatewayCall<O>[] {
    return this.calls.filter((call) => call.op === op) as unknown as GatewayCall<O>[];
  }

  /** Distinct intents that were authorized successfully (§12.3: "one distinct intent"). */
  intents(): string[] {
    const refs = new Set<string>();
    for (const call of this.of('authorize')) if (call.result?.ok) refs.add(call.result.intentRef);
    return [...refs];
  }

  reset(): void {
    this.calls.length = 0;
  }
}

/** Push that never leaves the process. Tickets are `ok` unless a token was told to fail. */
export class RecordingPush implements PushClient {
  readonly sent: ExpoMessage[] = [];
  readonly receiptRequests: string[][] = [];
  /** Tokens whose ticket is a `DeviceNotRegistered` error. */
  readonly unregistered = new Set<string>();
  /** Receipts by ticket id; an id without one is answered `ok`. */
  readonly receipts = new Map<string, ExpoReceipt>();
  private nextTicket = 1;

  async send(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
    this.sent.push(...messages);
    return messages.map((message) =>
      this.unregistered.has(message.to)
        ? {
            status: 'error' as const,
            message: 'not registered',
            details: { error: 'DeviceNotRegistered' },
          }
        : { status: 'ok' as const, id: `ticket-${this.nextTicket++}` },
    );
  }

  async getReceipts(ids: string[]): Promise<Record<string, ExpoReceipt>> {
    this.receiptRequests.push(ids);
    return Object.fromEntries(ids.map((id) => [id, this.receipts.get(id) ?? { status: 'ok' as const }]));
  }
}
