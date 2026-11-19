/**
 * Security-rules tests. They run against the Firestore & Storage emulators:
 *
 *   npm run test:rules            # starts throwaway emulators (CI)
 *
 * or, with `npm run emulators` already running:
 *
 *   npx tsx --test firebase/tests/*.test.ts
 *
 * Tests use the emulator's project (Storage rules read Firestore cross-service, which only works
 * within one project) but run-scoped document ids, and delete only what they created — so they
 * never wipe your seeded demo data.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

const root = path.resolve(import.meta.dirname, '..');
const [firestoreHost, firestorePort] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
const [storageHost, storagePort] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199').split(
  ':',
);

const RUN = `rules-${Date.now().toString(36)}`;
const DRIVER = `${RUN}-driver-1`;
const OTHER_DRIVER = `${RUN}-driver-2`;
const PENDING_DRIVER = `${RUN}-driver-pending`;
const STAFF = `${RUN}-staff`;
const MINE = `${RUN}-mine`;
const THEIRS = `${RUN}-theirs`;
const TOKEN = `${RUN}-token`;
const NOTE = `${RUN}-note`;

/** Every document the fixtures create, so cleanup removes exactly these. */
const FIXTURE_PATHS = [
  `users/${DRIVER}`,
  `users/${OTHER_DRIVER}`,
  `deliveries/${MINE}`,
  `deliveries/${THEIRS}`,
  `deliveries/${MINE}/private/meta`,
  `tracking/${TOKEN}`,
  `notifications/${NOTE}`,
  `threads/${DRIVER}`,
  `driverLocations/${DRIVER}`,
];

let env: RulesTestEnvironment;

const asDriver = (uid = DRIVER) =>
  env.authenticatedContext(uid, { role: 'driver', active: true }).firestore();
const asPending = () =>
  env.authenticatedContext(PENDING_DRIVER, { role: 'driver', active: false }).firestore();
const asStaff = () => env.authenticatedContext(STAFF, { role: 'dispatcher', active: true }).firestore();
const asGuest = () => env.unauthenticatedContext().firestore();

const location = (overrides: Record<string, unknown> = {}) => ({
  lat: 12.97,
  lng: 77.59,
  heading: 90,
  speed: 5,
  accuracy: 8,
  online: true,
  battery: 0.8,
  updatedAt: serverTimestamp(),
  ...overrides,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT ?? 'demo-instasupply',
    firestore: {
      rules: readFileSync(path.join(root, 'firestore.rules'), 'utf8'),
      host: firestoreHost,
      port: Number(firestorePort),
    },
    storage: {
      rules: readFileSync(path.join(root, 'storage.rules'), 'utf8'),
      host: storageHost,
      port: Number(storagePort),
    },
  });
});

async function removeFixtures() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all(FIXTURE_PATHS.map((fixturePath) => deleteDoc(doc(db, fixturePath))));
    const messages = await getDocs(collection(db, 'threads', DRIVER, 'messages'));
    await Promise.all(messages.docs.map((message) => deleteDoc(message.ref)));
  });
}

after(async () => {
  if (env) {
    await removeFixtures();
    await env.cleanup();
  }
});

beforeEach(async () => {
  await removeFixtures();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'users', DRIVER), {
      role: 'driver',
      status: 'active',
      displayName: 'Ravi',
      email: 'r@x.test',
    });
    await setDoc(doc(db, 'users', OTHER_DRIVER), {
      role: 'driver',
      status: 'active',
      displayName: 'Meera',
      email: 'm@x.test',
    });
    await setDoc(doc(db, 'deliveries', MINE), {
      orderId: 'IS-1',
      driverId: DRIVER,
      status: 'accepted',
      address: '12 MG Road',
      location: { lat: 12.97, lng: 77.6 },
      priority: 'normal',
      notes: null,
    });
    await setDoc(doc(db, 'deliveries', THEIRS), {
      orderId: 'IS-2',
      driverId: OTHER_DRIVER,
      status: 'accepted',
    });
    await setDoc(doc(db, 'deliveries', MINE, 'private', 'meta'), {
      trackingToken: TOKEN,
      handoffCode: '1234',
    });
    await setDoc(doc(db, 'tracking', TOKEN), { orderId: 'IS-1', status: 'accepted' });
    await setDoc(doc(db, 'notifications', NOTE), { userId: DRIVER, title: 'Hi', body: 'b', read: false });
    await setDoc(doc(db, 'threads', DRIVER), { driverId: DRIVER, unreadByDriver: 2, unreadByStaff: 1 });
  });
});

describe('users', () => {
  it('drivers read only their own profile; staff read all', async () => {
    await assertSucceeds(getDoc(doc(asDriver(), 'users', DRIVER)));
    await assertFails(getDoc(doc(asDriver(), 'users', OTHER_DRIVER)));
    await assertSucceeds(getDoc(doc(asStaff(), 'users', OTHER_DRIVER)));
    await assertFails(getDoc(doc(asGuest(), 'users', DRIVER)));
  });

  it('drivers can edit their name but never their role or status', async () => {
    await assertSucceeds(
      updateDoc(doc(asDriver(), 'users', DRIVER), { displayName: 'Ravi K', updatedAt: serverTimestamp() }),
    );
    await assertFails(updateDoc(doc(asDriver(), 'users', DRIVER), { role: 'admin' }));
    // A no-op write of the same value is harmless, so test a real change.
    await assertFails(updateDoc(doc(asDriver(), 'users', DRIVER), { status: 'pending' }));
    await assertFails(setDoc(doc(asDriver(), 'users', `${RUN}-new-user`), { role: 'driver' }));
  });
});

describe('driver locations', () => {
  it('approved drivers publish valid positions for themselves only', async () => {
    await assertSucceeds(setDoc(doc(asDriver(), 'driverLocations', DRIVER), location()));
    await assertFails(setDoc(doc(asDriver(), 'driverLocations', OTHER_DRIVER), location()));
    await assertFails(setDoc(doc(asPending(), 'driverLocations', PENDING_DRIVER), location()));
  });

  it('rejects malformed positions and client timestamps', async () => {
    await assertFails(setDoc(doc(asDriver(), 'driverLocations', DRIVER), location({ lat: 123 })));
    await assertFails(
      setDoc(doc(asDriver(), 'driverLocations', DRIVER), location({ updatedAt: new Date() })),
    );
    await assertFails(setDoc(doc(asDriver(), 'driverLocations', DRIVER), location({ extra: true })));
  });

  it('only staff and the driver can read positions', async () => {
    await env.withSecurityRulesDisabled((context) =>
      setDoc(doc(context.firestore(), 'driverLocations', DRIVER), { lat: 1, lng: 1, online: true }),
    );
    await assertSucceeds(getDoc(doc(asStaff(), 'driverLocations', DRIVER)));
    await assertFails(getDoc(doc(asDriver(OTHER_DRIVER), 'driverLocations', DRIVER)));
  });
});

describe('deliveries', () => {
  it('drivers see only deliveries assigned to them', async () => {
    await assertSucceeds(getDoc(doc(asDriver(), 'deliveries', MINE)));
    await assertFails(getDoc(doc(asDriver(), 'deliveries', THEIRS)));
    await assertSucceeds(
      getDocs(query(collection(asDriver(), 'deliveries'), where('driverId', '==', DRIVER))),
    );
    // Listing everything (including other drivers' work) is denied.
    await assertFails(getDocs(collection(asDriver(), 'deliveries')));
  });

  it('status and assignment can only change through Cloud Functions', async () => {
    await assertFails(updateDoc(doc(asDriver(), 'deliveries', MINE), { status: 'delivered' }));
    await assertFails(
      updateDoc(doc(asStaff(), 'deliveries', MINE), {
        status: 'cancelled',
        updatedBy: STAFF,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(setDoc(doc(asStaff(), 'deliveries', `${RUN}-new`), { status: 'assigned' }));
  });

  it('staff can edit drop-off details', async () => {
    await assertSucceeds(
      updateDoc(doc(asStaff(), 'deliveries', MINE), {
        notes: 'Call before arriving',
        updatedBy: STAFF,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('the hand-off code is hidden from drivers', async () => {
    await assertFails(getDoc(doc(asDriver(), 'deliveries', MINE, 'private', 'meta')));
    await assertSucceeds(getDoc(doc(asStaff(), 'deliveries', MINE, 'private', 'meta')));
  });
});

describe('public tracking', () => {
  it('anyone with the token can read, nobody can list or write', async () => {
    await assertSucceeds(getDoc(doc(asGuest(), 'tracking', TOKEN)));
    await assertFails(getDocs(collection(asGuest(), 'tracking')));
    await assertFails(setDoc(doc(asGuest(), 'tracking', TOKEN), { status: 'delivered' }));
    await assertFails(setDoc(doc(asDriver(), 'tracking', TOKEN), { status: 'delivered' }));
  });
});

describe('notifications', () => {
  it('recipients can read and mark as read, nothing else', async () => {
    await assertSucceeds(getDoc(doc(asDriver(), 'notifications', NOTE)));
    await assertFails(getDoc(doc(asDriver(OTHER_DRIVER), 'notifications', NOTE)));
    await assertSucceeds(
      updateDoc(doc(asDriver(), 'notifications', NOTE), { read: true, readAt: serverTimestamp() }),
    );
    await assertFails(updateDoc(doc(asDriver(), 'notifications', NOTE), { title: 'Changed' }));
    await assertFails(addDoc(collection(asDriver(), 'notifications'), { userId: DRIVER, title: 'Spam' }));
  });
});

describe('chat', () => {
  const message = (overrides: Record<string, unknown> = {}) => ({
    text: 'On my way',
    senderId: DRIVER,
    senderName: 'Ravi',
    senderRole: 'driver',
    deliveryId: null,
    kind: 'quick_reply',
    createdAt: serverTimestamp(),
    ...overrides,
  });

  it('drivers post only in their own thread, as themselves', async () => {
    await assertSucceeds(addDoc(collection(asDriver(), 'threads', DRIVER, 'messages'), message()));
    await assertFails(
      addDoc(collection(asDriver(), 'threads', DRIVER, 'messages'), message({ senderRole: 'staff' })),
    );
    await assertFails(
      addDoc(
        collection(asDriver(OTHER_DRIVER), 'threads', DRIVER, 'messages'),
        message({ senderId: OTHER_DRIVER }),
      ),
    );
    await assertFails(addDoc(collection(asDriver(), 'threads', DRIVER, 'messages'), message({ text: '' })));
  });

  it('staff can message any driver', async () => {
    await assertSucceeds(
      addDoc(
        collection(asStaff(), 'threads', DRIVER, 'messages'),
        message({ senderId: STAFF, senderRole: 'staff' }),
      ),
    );
  });

  it('participants can only reset their own unread counter', async () => {
    await assertSucceeds(
      updateDoc(doc(asDriver(), 'threads', DRIVER), { unreadByDriver: 0, driverReadAt: serverTimestamp() }),
    );
    await assertFails(updateDoc(doc(asDriver(), 'threads', DRIVER), { unreadByStaff: 0 }));
    await assertFails(updateDoc(doc(asDriver(), 'threads', DRIVER), { unreadByDriver: 5 }));
    await assertSucceeds(
      updateDoc(doc(asStaff(), 'threads', DRIVER), { unreadByStaff: 0, staffReadAt: serverTimestamp() }),
    );
  });
});

describe('proof-of-delivery storage', () => {
  const image = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

  it('only the assigned driver can upload images', async () => {
    const mine = env.authenticatedContext(DRIVER, { role: 'driver', active: true }).storage();
    const other = env.authenticatedContext(OTHER_DRIVER, { role: 'driver', active: true }).storage();
    await assertSucceeds(
      uploadBytes(ref(mine, `proofs/${MINE}/photo.jpg`), image, { contentType: 'image/jpeg' }),
    );
    await assertFails(
      uploadBytes(ref(other, `proofs/${MINE}/photo.jpg`), image, { contentType: 'image/jpeg' }),
    );
    await assertFails(
      uploadBytes(ref(mine, `proofs/${MINE}/notes.txt`), image, { contentType: 'text/plain' }),
    );
  });
});
