/**
 * Security rules for the shopping side: the public catalogue, the shopper's private data (address
 * book, favourites, saved cards), product reviews and server-owned orders. Run-scoped ids; only the
 * documents created here are deleted afterwards.
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
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const root = path.resolve(import.meta.dirname, '..');
const [firestoreHost, firestorePort] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');

const RUN = `shop-${Date.now().toString(36)}`;
const SHOPPER = `${RUN}-shopper`;
const OTHER_SHOPPER = `${RUN}-other`;
const DRIVER = `${RUN}-driver`;
const STAFF = `${RUN}-staff`;
const ADMIN = `${RUN}-admin`;
const PRODUCT = `${RUN}-mango`;
const NEW_PRODUCT = `${RUN}-new`;
const CATEGORY = `${RUN}-fruits`;
const ORDER = `${RUN}-order`;

let env: RulesTestEnvironment;

const as = (uid: string, role: string) => env.authenticatedContext(uid, { role, active: true }).firestore();
const asShopper = (uid = SHOPPER) => as(uid, 'customer');
const asStaff = () => as(STAFF, 'dispatcher');
const asAdmin = () => as(ADMIN, 'admin');
const asDriver = () => as(DRIVER, 'driver');
const asGuest = () => env.unauthenticatedContext().firestore();
/** The rules-testing contexts hand out compat Firestore instances. */
type Db = ReturnType<typeof asGuest>;

const product = (overrides: Record<string, unknown> = {}) => ({
  name: 'Alphonso Mango',
  categoryId: CATEGORY,
  unit: '1 kg',
  price: 349,
  mrp: 399,
  description: 'Sweet and fragrant.',
  imageKey: 'mango',
  imageUrl: null,
  badge: null,
  rating: 0,
  ratingCount: 0,
  stock: 20,
  active: true,
  featured: false,
  searchTerms: ['al', 'alp'],
  updatedAt: serverTimestamp(),
  ...overrides,
});

const card = (overrides: Record<string, unknown> = {}) => ({
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2030,
  holder: 'Test Shopper',
  isDefault: true,
  createdAt: serverTimestamp(),
  ...overrides,
});

const address = (overrides: Record<string, unknown> = {}) => ({
  label: 'Home',
  name: 'Test Shopper',
  phone: '+919811000999',
  line1: '1 Test Road, HSR Layout',
  line2: null,
  landmark: null,
  city: 'Bengaluru',
  zip: '560102',
  location: { lat: 12.9121, lng: 77.6446 },
  isDefault: true,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...overrides,
});

const review = (uid: string, overrides: Record<string, unknown> = {}) => ({
  productId: PRODUCT,
  userId: uid,
  userName: 'Test Shopper',
  rating: 5,
  text: 'Lovely',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...overrides,
});

async function deleteCollection(db: Db, ...segments: [string, ...string[]]) {
  const snapshot = await getDocs(collection(db, ...segments));
  await Promise.all(snapshot.docs.map((item) => deleteDoc(item.ref)));
}

async function removeFixtures() {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const uid of [SHOPPER, OTHER_SHOPPER]) {
      for (const sub of ['addresses', 'cards', 'favorites']) await deleteCollection(db, 'users', uid, sub);
      await deleteDoc(doc(db, 'users', uid));
    }
    for (const id of [PRODUCT, NEW_PRODUCT]) {
      await deleteCollection(db, 'products', id, 'reviews');
      await deleteDoc(doc(db, 'products', id));
    }
    await deleteDoc(doc(db, 'categories', CATEGORY));
    await deleteDoc(doc(db, 'orders', ORDER));
  });
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT ?? 'demo-instasupply',
    firestore: {
      rules: readFileSync(path.join(root, 'firestore.rules'), 'utf8'),
      host: firestoreHost,
      port: Number(firestorePort),
    },
  });
});

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
    await setDoc(doc(db, 'users', SHOPPER), {
      role: 'customer',
      status: 'active',
      displayName: 'Test Shopper',
      email: 's@x.test',
      phoneVerified: false,
      preferences: { orderPush: true, promoPush: true },
    });
    await setDoc(doc(db, 'categories', CATEGORY), { name: 'Fruits', iconKey: 'cat-fruits', sortOrder: 1 });
    await setDoc(doc(db, 'products', PRODUCT), { ...product(), updatedAt: new Date() });
    await setDoc(doc(db, 'orders', ORDER), {
      number: 'IS-1',
      customerId: SHOPPER,
      status: 'placed',
      total: 349,
    });
  });
});

describe('catalogue', () => {
  it('is public to read, even without an account', async () => {
    await assertSucceeds(getDoc(doc(asGuest(), 'products', PRODUCT)));
    await assertSucceeds(getDoc(doc(asGuest(), 'categories', CATEGORY)));
    await assertSucceeds(getDocs(collection(asGuest(), 'products', PRODUCT, 'reviews')));
  });

  it('only staff can change products, and only with valid data', async () => {
    await assertFails(
      updateDoc(doc(asShopper(), 'products', PRODUCT), { price: 1, updatedAt: serverTimestamp() }),
    );
    await assertFails(setDoc(doc(asGuest(), 'products', NEW_PRODUCT), product()));
    await assertSucceeds(setDoc(doc(asStaff(), 'products', NEW_PRODUCT), product()));
    await assertSucceeds(
      updateDoc(doc(asStaff(), 'products', PRODUCT), { stock: 5, updatedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(doc(asStaff(), 'products', PRODUCT), { stock: 2.5, updatedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(doc(asStaff(), 'products', PRODUCT), { price: -1, updatedAt: serverTimestamp() }),
    );
    // updatedAt must be the server time, so edits are always stamped.
    await assertFails(updateDoc(doc(asStaff(), 'products', PRODUCT), { stock: 4 }));
  });

  it('only admins delete products; staff manage categories', async () => {
    await assertFails(deleteDoc(doc(asStaff(), 'products', PRODUCT)));
    await assertSucceeds(deleteDoc(doc(asAdmin(), 'products', PRODUCT)));
    await assertSucceeds(updateDoc(doc(asStaff(), 'categories', CATEGORY), { sortOrder: 3 }));
    await assertFails(updateDoc(doc(asShopper(), 'categories', CATEGORY), { sortOrder: 3 }));
  });
});

describe('saved cards', () => {
  it('store brand, last 4 and expiry only — never a card number or CVV', async () => {
    const cards = collection(asShopper(), 'users', SHOPPER, 'cards');
    await assertSucceeds(addDoc(cards, card()));
    await assertFails(addDoc(cards, card({ number: '4242424242424242' })));
    await assertFails(addDoc(cards, card({ cvv: '123' })));
    await assertFails(addDoc(cards, card({ last4: '424242' })));
    await assertFails(addDoc(cards, card({ last4: 'abcd' })));
    await assertFails(addDoc(cards, card({ expMonth: 13 })));
  });

  it('are private to their owner', async () => {
    await assertFails(addDoc(collection(asShopper(OTHER_SHOPPER), 'users', SHOPPER, 'cards'), card()));
    await assertFails(getDocs(collection(asShopper(OTHER_SHOPPER), 'users', SHOPPER, 'cards')));
    await assertFails(getDocs(collection(asStaff(), 'users', SHOPPER, 'cards')));
    await assertSucceeds(getDocs(collection(asShopper(), 'users', SHOPPER, 'cards')));
  });
});

describe('address book and favourites', () => {
  it('validates addresses and keeps them private', async () => {
    const addresses = collection(asShopper(), 'users', SHOPPER, 'addresses');
    await assertSucceeds(addDoc(addresses, address()));
    await assertSucceeds(addDoc(addresses, address({ location: null, line2: 'Flat 4B' })));
    await assertFails(addDoc(addresses, address({ zip: '1' })));
    await assertFails(addDoc(addresses, address({ isAdmin: true })));
    await assertFails(addDoc(collection(asShopper(OTHER_SHOPPER), 'users', SHOPPER, 'addresses'), address()));
  });

  it('favourites are keyed by product and stamped by the server', async () => {
    const favorite = (db: Db, productId: string) => doc(db, 'users', SHOPPER, 'favorites', productId);
    await assertSucceeds(
      setDoc(favorite(asShopper(), PRODUCT), { productId: PRODUCT, createdAt: serverTimestamp() }),
    );
    await assertFails(
      setDoc(favorite(asShopper(), NEW_PRODUCT), { productId: PRODUCT, createdAt: serverTimestamp() }),
    );
    await assertFails(
      setDoc(favorite(asShopper(), NEW_PRODUCT), { productId: NEW_PRODUCT, createdAt: new Date(0) }),
    );
    await assertFails(
      setDoc(favorite(asShopper(OTHER_SHOPPER), NEW_PRODUCT), {
        productId: NEW_PRODUCT,
        createdAt: serverTimestamp(),
      }),
    );
  });
});

describe('reviews', () => {
  it('one review per shopper, written as themselves', async () => {
    const mine = doc(asShopper(), 'products', PRODUCT, 'reviews', SHOPPER);
    await assertFails(setDoc(mine, review(SHOPPER, { rating: 6 })));
    await assertFails(setDoc(mine, review(SHOPPER, { rating: 4.5 })));
    await assertSucceeds(setDoc(mine, review(SHOPPER)));
    await assertFails(
      setDoc(doc(asShopper(), 'products', PRODUCT, 'reviews', OTHER_SHOPPER), review(OTHER_SHOPPER)),
    );
    await assertFails(setDoc(doc(asDriver(), 'products', PRODUCT, 'reviews', DRIVER), review(DRIVER)));
  });

  it('edits keep the original creation time', async () => {
    const mine = doc(asShopper(), 'products', PRODUCT, 'reviews', SHOPPER);
    await assertSucceeds(setDoc(mine, review(SHOPPER)));
    await assertFails(
      updateDoc(mine, { rating: 4, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(updateDoc(mine, { rating: 4, text: 'Good', updatedAt: serverTimestamp() }));
  });
});

describe('orders', () => {
  it('shoppers read only their own orders; staff read all', async () => {
    await assertSucceeds(getDoc(doc(asShopper(), 'orders', ORDER)));
    await assertFails(getDoc(doc(asShopper(OTHER_SHOPPER), 'orders', ORDER)));
    await assertFails(getDoc(doc(asDriver(), 'orders', ORDER)));
    await assertSucceeds(getDoc(doc(asStaff(), 'orders', ORDER)));
  });

  it('can only be written by Cloud Functions', async () => {
    await assertFails(updateDoc(doc(asShopper(), 'orders', ORDER), { status: 'delivered' }));
    await assertFails(updateDoc(doc(asShopper(), 'orders', ORDER), { total: 1 }));
    await assertFails(setDoc(doc(asShopper(), 'orders', `${RUN}-forged`), { customerId: SHOPPER, total: 1 }));
    await assertFails(updateDoc(doc(asStaff(), 'orders', ORDER), { status: 'delivered' }));
  });
});

describe('shopper profile', () => {
  it('shoppers edit their name and notification preferences, never their role or verification', async () => {
    const me = doc(asShopper(), 'users', SHOPPER);
    await assertSucceeds(
      updateDoc(me, {
        displayName: 'Priya S',
        preferences: { orderPush: false, promoPush: true },
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(updateDoc(me, { role: 'admin' }));
    // Verification only happens through the OTP callable.
    await assertFails(updateDoc(me, { phoneVerified: true, displayName: 'Priya' }));
  });
});
