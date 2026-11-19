/**
 * The Expo push service, two fetch calls (port of legacy/…/notifications/push.ts; no expo-server-sdk). At
 * most 100 messages per request; 429 and 5xx throw so the outbox retries with backoff.
 */
export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  priority: 'high';
  channelId: string;
  data: Record<string, string>;
}

export type ExpoTicket =
  { status: 'ok'; id: string } | { status: 'error'; message?: string; details?: { error?: string } };
export type ExpoReceipt =
  { status: 'ok' } | { status: 'error'; message?: string; details?: { error?: string } };

export interface PushClient {
  send(messages: ExpoMessage[]): Promise<ExpoTicket[]>;
  getReceipts(ids: string[]): Promise<Record<string, ExpoReceipt>>;
}

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

export function createExpoClient(accessToken: string | null): PushClient {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
  async function post<T>(url: string, body: unknown): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 429 || response.status >= 500)
      throw new Error(`Expo push answered ${response.status}`);
    const json = (await response.json()) as { data?: T; errors?: { message?: string }[] };
    if (!response.ok || json.data === undefined) {
      throw new Error(
        `Expo push refused the request (${response.status}): ${json.errors?.[0]?.message ?? 'no data'}`,
      );
    }
    return json.data;
  }
  return {
    send: (messages) => post<ExpoTicket[]>(SEND_URL, messages),
    getReceipts: (ids) => post<Record<string, ExpoReceipt>>(RECEIPTS_URL, { ids }),
  };
}
