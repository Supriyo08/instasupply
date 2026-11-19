import { toApiError } from '../errors';
import { STORAGE_KEYS, type SecretStorage } from '../platform';

/** At most this many refresh tokens wait for their logout (CLIENTS §2.5 step 2). */
export const LOGOUT_QUEUE_MAX = 5;

/**
 * Sign-outs that could not reach the server. The refresh token stays in secret storage until
 * `POST /auth/logout` has been delivered, because only that call removes the push device of the
 * old account from this phone (assumption B9).
 */
export class LogoutQueue {
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly storage: SecretStorage,
    private readonly send: (refreshToken: string) => Promise<void>,
  ) {}

  async read(): Promise<string[]> {
    const raw = await this.storage.getItem(STORAGE_KEYS.logoutQueue);
    if (!raw) return [];
    try {
      const value: unknown = JSON.parse(raw);
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  async push(refreshToken: string): Promise<void> {
    const queue = (await this.read()).filter((token) => token !== refreshToken);
    queue.push(refreshToken);
    await this.write(queue.slice(-LOGOUT_QUEUE_MAX));
  }

  /** Sends every queued logout once; the ones that still meet no network stay queued. */
  flush(): Promise<void> {
    if (!this.flushing) {
      this.flushing = this.runFlush().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  private async runFlush(): Promise<void> {
    const queue = await this.read();
    if (queue.length === 0) return;
    const remaining: string[] = [];
    for (const token of queue) {
      try {
        await this.send(token);
      } catch (error) {
        // Any answer from the server settles it (logout always answers 204, even for a dead token);
        // only "no answer" keeps the entry for the next start or `online`.
        if (toApiError(error).isNetwork) remaining.push(token);
      }
    }
    // Another sign-out may have queued a token meanwhile: keep it.
    const latest = await this.read();
    const kept = latest.filter((token) => !queue.includes(token) || remaining.includes(token));
    await this.write(kept);
  }

  private async write(queue: string[]): Promise<void> {
    if (queue.length === 0) await this.storage.removeItem(STORAGE_KEYS.logoutQueue);
    else await this.storage.setItem(STORAGE_KEYS.logoutQueue, JSON.stringify(queue));
  }
}
