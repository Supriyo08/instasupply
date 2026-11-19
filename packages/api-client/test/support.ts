// Shared fixtures for the test files (not a test file itself: the runner only picks *.test.ts).
import type { UserProfile } from '@instasupply/shared';

import { createTestClient, type FakeRequest } from '../src/testing';

export const EMAIL = 'dana@example.com';
export const PASSWORD = 'correct-horse-1';

export function customerProfile(uid: string, overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid,
    role: 'customer',
    status: 'active',
    displayName: 'Dana Whitfield',
    email: EMAIL,
    phoneNumber: null,
    phoneVerified: false,
    ...overrides,
  };
}

/** A started client signed in as one customer. */
export async function signedIn(options: Parameters<typeof createTestClient>[0] = {}) {
  const kit = createTestClient(options);
  const { uid } = kit.server.addAccount({ email: EMAIL, password: PASSWORD, profile: null });
  // The account's profile names its own uid, so it is set once the uid is known.
  kit.server.on('GET', '/me', (request) => ({
    body: {
      account: { uid, email: EMAIL, createdAt: 0 },
      profile: request.uid === uid ? customerProfile(uid) : null,
      store: null,
      serverTime: kit.clock.now(),
    },
  }));
  await kit.client.session.signIn({ email: EMAIL, password: PASSWORD });
  await kit.client.session.refreshProfile();
  return { ...kit, uid };
}

/** Requests to one path, for counting. */
export function requestsTo(kit: { server: { requests: FakeRequest[] } }, method: string, path: string): FakeRequest[] {
  return kit.server.requests.filter((request) => request.method === method && request.path === path);
}
