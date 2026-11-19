/**
 * End-to-end backend test: real callables + triggers running in the emulators.
 *
 *   npm run test:integration      # throwaway emulators (CI)
 *
 * Uses run-scoped accounts and cleans up after itself, so it is also safe to run against the
 * emulators you develop with (`npx tsx --test firebase/tests/delivery-workflow.test.ts`).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

import type { CreateDeliveriesResponse } from '@instasupply/shared';

import { callFunction, PROJECT_ID, signIn, sleep } from '../../scripts/lib/emulator';

const RUN = `wf${Date.now().toString(36)}`;
const PASSWORD = 'Workflow@12345';
const app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID });
const auth = getAuth(app);
const db = getFirestore(app);

const accounts = {
  staff: {
    email: `${RUN}-staff@instasupply.test`,
    role: 'dispatcher',
    name: 'Test Dispatcher',
    uid: '',
    token: '',
  },
  driver: {
    email: `${RUN}-driver@instasupply.test`,
    role: 'driver',
    name: 'Test Driver',
    uid: '',
    token: '',
  },
  backup: {
    email: `${RUN}-backup@instasupply.test`,
    role: 'driver',
    name: 'Backup Driver',
    uid: '',
    token: '',
  },
};
const createdDeliveries: string[] = [];

/** Poll until `check` returns a truthy value (triggers run asynchronously). */
async function eventually<T>(
  check: () => Promise<T | null | undefined | false>,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting for a background trigger.');
    await sleep(300);
  }
}

const call = <T = unknown>(account: keyof typeof accounts, name: string, data: unknown) =>
  callFunction<T>(name, accounts[account].token, data);

before(async () => {
  for (const account of Object.values(accounts)) {
    const user = await auth.createUser({
      email: account.email,
      password: PASSWORD,
      displayName: account.name,
    });
    account.uid = user.uid;
    await auth.setCustomUserClaims(user.uid, { role: account.role, active: true });
    await db.doc(`users/${user.uid}`).set({
      uid: user.uid,
      role: account.role,
      status: 'active',
      displayName: account.name,
      email: account.email,
      phoneVerified: true,
      vehicle: account.role === 'driver' ? { type: 'scooter', plate: 'KA01TEST', model: null } : null,
    });
    account.token = await signIn(account.email, PASSWORD);
  }
  await db
    .doc(`driverLocations/${accounts.driver.uid}`)
    .set({ lat: 12.93, lng: 77.61, online: true, updatedAt: new Date() });
});

after(async () => {
  for (const id of createdDeliveries) {
    const ref = db.doc(`deliveries/${id}`);
    const meta = await ref.collection('private').doc('meta').get();
    if (meta.exists) await db.doc(`tracking/${meta.get('trackingToken')}`).delete();
    await db.recursiveDelete(ref);
  }
  for (const account of Object.values(accounts)) {
    if (!account.uid) continue;
    await db.recursiveDelete(db.doc(`users/${account.uid}`));
    await db.doc(`driverLocations/${account.uid}`).delete();
    await db.doc(`routes/${account.uid}`).delete();
    await db.recursiveDelete(db.doc(`threads/${account.uid}`));
    const notes = await db.collection('notifications').where('userId', '==', account.uid).get();
    await Promise.all(notes.docs.map((note) => note.ref.delete()));
    await auth.deleteUser(account.uid);
  }
});

async function createDelivery(overrides: Record<string, unknown> = {}) {
  const result = await call<CreateDeliveriesResponse>('staff', 'createDeliveries', {
    deliveries: [
      {
        customerName: 'Workflow Customer',
        customerPhone: '+919811009999',
        address: '1 Test Street, Bengaluru',
        location: { lat: 12.9352, lng: 77.6245 },
        driverId: accounts.driver.uid,
        ...overrides,
      },
    ],
  });
  assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
  const created = result.created[0]!;
  createdDeliveries.push(created.id);
  return created;
}

describe('delivery workflow', () => {
  it('rejects invalid input and non-staff callers', async () => {
    const invalid = await call<CreateDeliveriesResponse>('staff', 'createDeliveries', {
      deliveries: [{ customerName: '', address: '' }],
    });
    assert.equal(invalid.created.length, 0);
    assert.match(invalid.errors[0]!.message, /required/i);
    await assert.rejects(call('driver', 'createDeliveries', { deliveries: [{}] }), /PERMISSION_DENIED/);
  });

  it('runs assignment → trip → live tracking → proof of delivery', async () => {
    const created = await createDelivery({ requireCode: true, codAmount: 499 });
    const ref = db.doc(`deliveries/${created.id}`);

    // Assignment notifies the driver and plans their route.
    await eventually(async () => {
      const notes = await db.collection('notifications').where('userId', '==', accounts.driver.uid).get();
      return notes.docs.some((note) => note.get('type') === 'delivery_assigned');
    });
    await eventually(async () => {
      const route = await db.doc(`routes/${accounts.driver.uid}`).get();
      return route.get('stops')?.some((stop: { deliveryId: string }) => stop.deliveryId === created.id);
    });

    // Drivers can't skip steps.
    await assert.rejects(
      call('driver', 'updateDeliveryStatus', { deliveryId: created.id, status: 'delivered' }),
      /FAILED_PRECONDITION/,
    );

    for (const status of ['accepted', 'picked_up', 'in_transit', 'arrived']) {
      await call('driver', 'updateDeliveryStatus', { deliveryId: created.id, status });
    }
    assert.equal((await ref.get()).get('status'), 'arrived');

    // The public tracking page follows along and shows the hand-off code.
    const tracking = await eventually(async () => {
      const snapshot = await db.doc(`tracking/${created.trackingToken}`).get();
      return snapshot.get('status') === 'arrived' ? snapshot : null;
    });
    const code = tracking.get('handoffCode') as string;
    assert.match(code, /^\d{4}$/);
    assert.equal(tracking.get('driver.firstName'), 'Test');

    // Wrong code is rejected and counted; cash must be confirmed; the right code completes it.
    const wrong = code === '0000' ? '1111' : '0000';
    await assert.rejects(
      call('driver', 'completeDelivery', {
        deliveryId: created.id,
        recipientName: 'Customer',
        handoffCode: wrong,
        codCollected: 499,
      }),
      /incorrect/,
    );
    await assert.rejects(
      call('driver', 'completeDelivery', {
        deliveryId: created.id,
        recipientName: 'Customer',
        handoffCode: code,
      }),
      /cash/i,
    );
    await call('driver', 'completeDelivery', {
      deliveryId: created.id,
      recipientName: 'Customer',
      handoffCode: code,
      codCollected: 499,
    });

    const delivered = await ref.get();
    assert.equal(delivered.get('status'), 'delivered');
    assert.equal(delivered.get('proof.codeVerified'), true);
    assert.equal(delivered.get('proof.codCollected'), 499);

    const events = await ref.collection('events').get();
    const messages = events.docs.map((event) => event.get('message') as string);
    assert.ok(messages.some((message) => message.startsWith('Delivered')));
    assert.ok(
      messages.some((message) => message.includes('Tracking link')),
      'customer SMS should be logged',
    );
  });

  it('lets drivers decline, and staff reassign', async () => {
    const created = await createDelivery();
    await assert.rejects(
      call('driver', 'updateDeliveryStatus', { deliveryId: created.id, status: 'unassigned' }),
      /declining/,
    );
    await call('driver', 'updateDeliveryStatus', {
      deliveryId: created.id,
      status: 'unassigned',
      declineReason: 'too_far',
    });

    const declined = await db.doc(`deliveries/${created.id}`).get();
    assert.equal(declined.get('status'), 'unassigned');
    assert.equal(declined.get('driverId'), null);
    assert.deepEqual(declined.get('declinedBy'), [accounts.driver.uid]);

    // The driver can no longer see or touch it.
    await assert.rejects(
      call('driver', 'updateDeliveryStatus', { deliveryId: created.id, status: 'accepted' }),
      /PERMISSION_DENIED/,
    );

    await call('staff', 'assignDelivery', { deliveryId: created.id, driverId: accounts.backup.uid });
    const reassigned = await db.doc(`deliveries/${created.id}`).get();
    assert.equal(reassigned.get('driverId'), accounts.backup.uid);
    assert.equal(reassigned.get('status'), 'assigned');

    await eventually(async () => {
      const notes = await db.collection('notifications').where('userId', '==', accounts.staff.uid).get();
      return notes.docs.some((note) => note.get('type') === 'delivery_declined');
    });
  });

  it('keeps only one trip in transit per driver', async () => {
    const first = await createDelivery({ address: '2 Test Street', location: { lat: 12.94, lng: 77.62 } });
    const second = await createDelivery({ address: '3 Test Street', location: { lat: 12.95, lng: 77.63 } });
    for (const id of [first.id, second.id]) {
      await call('driver', 'updateDeliveryStatus', { deliveryId: id, status: 'accepted' });
      await call('driver', 'updateDeliveryStatus', { deliveryId: id, status: 'picked_up' });
    }
    await call('driver', 'updateDeliveryStatus', { deliveryId: first.id, status: 'in_transit' });
    await call('driver', 'updateDeliveryStatus', { deliveryId: second.id, status: 'in_transit' });

    assert.equal((await db.doc(`deliveries/${first.id}`).get()).get('status'), 'picked_up');
    assert.equal((await db.doc(`deliveries/${second.id}`).get()).get('status'), 'in_transit');
  });
});
