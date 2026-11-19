/**
 * Customer commerce end to end against the emulators: checkout pricing and stock, promo rules,
 * order ↔ delivery status sync with customer notifications, cancellation, and the security rules
 * for the shopper's own data. Run-scoped accounts/products, cleaned up afterwards.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

import type { Order, PlaceOrderResponse } from '@instasupply/shared';

import { callFunction, PROJECT_ID, signIn, sleep } from '../../scripts/lib/emulator';

const RUN = `cm${Date.now().toString(36)}`;
const PASSWORD = 'Commerce@12345';
const app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID });
const auth = getAuth(app);
const db = getFirestore(app);

const people = {
  shopper: {
    email: `${RUN}-shopper@instasupply.test`,
    role: 'customer',
    name: 'Test Shopper',
    uid: '',
    token: '',
  },
  other: {
    email: `${RUN}-other@instasupply.test`,
    role: 'customer',
    name: 'Other Shopper',
    uid: '',
    token: '',
  },
  staff: {
    email: `${RUN}-staff@instasupply.test`,
    role: 'dispatcher',
    name: 'Test Dispatch',
    uid: '',
    token: '',
  },
  driver: { email: `${RUN}-driver@instasupply.test`, role: 'driver', name: 'Test Rider', uid: '', token: '' },
};
const MANGO = `${RUN}-mango`;
const MILK = `${RUN}-milk`;
let addressId = '';
const orderIds: string[] = [];

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

const call = <T = unknown>(who: keyof typeof people, name: string, data: unknown) =>
  callFunction<T>(name, people[who].token, data);
const order = async (id: string) => (await db.doc(`orders/${id}`).get()).data() as Order;
const stockOf = async (id: string) => (await db.doc(`products/${id}`).get()).get('stock') as number;

before(async () => {
  for (const person of Object.values(people)) {
    const user = await auth.createUser({ email: person.email, password: PASSWORD, displayName: person.name });
    person.uid = user.uid;
    await auth.setCustomUserClaims(user.uid, { role: person.role, active: true });
    await db.doc(`users/${user.uid}`).set({
      uid: user.uid,
      role: person.role,
      status: 'active',
      displayName: person.name,
      email: person.email,
      phoneNumber: '+919811000999',
      phoneVerified: true,
    });
    person.token = await signIn(person.email, PASSWORD);
  }
  const product = (name: string, price: number, stock: number) => ({
    name,
    categoryId: 'fruits',
    unit: '1 kg',
    price,
    mrp: null,
    description: 'test',
    imageKey: null,
    imageUrl: null,
    badge: null,
    rating: 0,
    ratingCount: 0,
    stock,
    active: true,
    featured: false,
    searchTerms: [],
    updatedAt: FieldValue.serverTimestamp(),
  });
  await db.doc(`products/${MANGO}`).set(product('Test Mango', 300, 5));
  await db.doc(`products/${MILK}`).set(product('Test Milk', 50, 50));
  const address = await db.collection(`users/${people.shopper.uid}/addresses`).add({
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
  });
  addressId = address.id;
});

after(async () => {
  for (const id of orderIds) {
    const snapshot = await db.doc(`orders/${id}`).get();
    if (!snapshot.exists) continue;
    const deliveryId = snapshot.get('deliveryId') as string;
    await db.doc(`tracking/${snapshot.get('trackingToken')}`).delete();
    await db.recursiveDelete(db.doc(`deliveries/${deliveryId}`));
    await snapshot.ref.delete();
  }
  await db.recursiveDelete(db.doc(`products/${MANGO}`));
  await db.recursiveDelete(db.doc(`products/${MILK}`));
  for (const person of Object.values(people)) {
    if (!person.uid) continue;
    await db.recursiveDelete(db.doc(`users/${person.uid}`));
    await db.doc(`routes/${person.uid}`).delete();
    const notes = await db.collection('notifications').where('userId', '==', person.uid).get();
    await Promise.all(notes.docs.map((note) => note.ref.delete()));
    await auth.deleteUser(person.uid);
  }
});

describe('checkout', () => {
  it('rejects non-customers, unknown products and over-stock quantities', async () => {
    const items = [{ productId: MANGO, quantity: 1 }];
    await assert.rejects(
      call('driver', 'placeOrder', { items, addressId, paymentMethod: 'cod' }),
      /PERMISSION_DENIED/,
    );
    await assert.rejects(
      call('shopper', 'placeOrder', {
        items: [{ productId: `${RUN}-nope`, quantity: 1 }],
        addressId,
        paymentMethod: 'cod',
      }),
      /no longer available/,
    );
    await assert.rejects(
      call('shopper', 'placeOrder', {
        items: [{ productId: MANGO, quantity: 6 }],
        addressId,
        paymentMethod: 'cod',
      }),
      /Only 5/,
    );
  });

  it('prices on the server, applies FIRST20 once, decrements stock and creates the delivery', async () => {
    const placed = await call<PlaceOrderResponse>('shopper', 'placeOrder', {
      // A tampered client price is ignored: the server only accepts product ids and quantities.
      items: [
        { productId: MANGO, quantity: 1, price: 1 },
        { productId: MILK, quantity: 2 },
      ],
      addressId,
      paymentMethod: 'cod',
      promoCode: 'first20',
    });
    orderIds.push(placed.orderId);
    const saved = await order(placed.orderId);
    assert.equal(saved.subtotal, 400); // 300 + 2 × 50
    assert.equal(saved.deliveryFee, 30); // below the free-delivery threshold
    assert.equal(saved.discount, 80); // 20% of 400, under the ₹100 cap
    assert.equal(saved.total, 350);
    assert.equal(saved.promoCode, 'FIRST20');
    assert.equal(saved.paymentStatus, 'cod_pending');
    assert.equal(saved.status, 'placed');
    assert.equal(await stockOf(MANGO), 4);

    const delivery = (await db.doc(`deliveries/${saved.deliveryId}`).get()).data()!;
    assert.equal(delivery.sourceOrderId, placed.orderId);
    assert.equal(delivery.codAmount, 350);
    assert.equal(delivery.requireCode, true);
    assert.equal(delivery.orderId, saved.number);
    assert.equal(delivery.status, 'unassigned');

    // Second order: the first-order promo no longer applies.
    await assert.rejects(
      call('shopper', 'placeOrder', {
        items: [{ productId: MILK, quantity: 1 }],
        addressId,
        paymentMethod: 'cod',
        promoCode: 'FIRST20',
      }),
      /first order only/,
    );
  });

  it('keeps the order in step with the delivery and notifies the shopper', async () => {
    const placed = await call<PlaceOrderResponse>('shopper', 'placeOrder', {
      items: [{ productId: MILK, quantity: 12 }], // ₹600: free delivery
      addressId,
      paymentMethod: 'cod',
    });
    orderIds.push(placed.orderId);
    const { deliveryId, deliveryFee } = await order(placed.orderId);
    assert.equal(deliveryFee, 0);

    await call('staff', 'assignDelivery', { deliveryId, driverId: people.driver.uid });
    await eventually(async () => (await order(placed.orderId)).status === 'confirmed');
    for (const status of ['accepted', 'picked_up']) {
      await call('driver', 'updateDeliveryStatus', { deliveryId, status });
    }
    await eventually(async () => (await order(placed.orderId)).status === 'packed');
    await call('driver', 'updateDeliveryStatus', { deliveryId, status: 'in_transit' });
    await eventually(async () => (await order(placed.orderId)).status === 'out_for_delivery');
    await call('driver', 'updateDeliveryStatus', { deliveryId, status: 'arrived' });

    // The shopper's hand-off code is on their tracking page.
    const tracking = await eventually(async () => {
      const snapshot = await db.doc(`tracking/${placed.trackingToken}`).get();
      return snapshot.get('status') === 'arrived' ? snapshot : null;
    });
    await call('driver', 'completeDelivery', {
      deliveryId,
      recipientName: 'Test Shopper',
      handoffCode: tracking.get('handoffCode'),
      codCollected: 600,
    });
    const delivered = await eventually(async () => {
      const current = await order(placed.orderId);
      return current.status === 'delivered' ? current : null;
    });
    assert.equal(delivered.paymentStatus, 'collected');

    const notes = await eventually(async () => {
      const snapshot = await db.collection('notifications').where('userId', '==', people.shopper.uid).get();
      const types = snapshot.docs.map((doc) => doc.get('title') as string);
      return types.includes('Delivered!') ? types : null;
    });
    for (const title of [
      'Order placed',
      'Order confirmed',
      'Order packed',
      'Out for delivery',
      'Delivered!',
    ]) {
      assert.ok(notes.includes(title), `missing notification "${title}" in ${JSON.stringify(notes)}`);
    }
  });

  it('lets shoppers cancel before pickup and returns the stock', async () => {
    const before = await stockOf(MANGO);
    const placed = await call<PlaceOrderResponse>('shopper', 'placeOrder', {
      items: [{ productId: MANGO, quantity: 2 }],
      addressId,
      paymentMethod: 'cod',
    });
    orderIds.push(placed.orderId);
    assert.equal(await stockOf(MANGO), before - 2);
    await assert.rejects(call('other', 'cancelOrder', { orderId: placed.orderId }), /NOT_FOUND/);
    await call('shopper', 'cancelOrder', { orderId: placed.orderId, reason: 'Ordered by mistake' });

    const cancelled = await order(placed.orderId);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal((await db.doc(`deliveries/${cancelled.deliveryId}`).get()).get('status'), 'cancelled');
    assert.equal(await stockOf(MANGO), before);
  });

  it('returns the stock when the store cancels the delivery', async () => {
    const before = await stockOf(MANGO);
    const placed = await call<PlaceOrderResponse>('shopper', 'placeOrder', {
      items: [{ productId: MANGO, quantity: 1 }],
      addressId,
      paymentMethod: 'cod',
    });
    orderIds.push(placed.orderId);
    assert.equal(await stockOf(MANGO), before - 1);
    const { deliveryId } = await order(placed.orderId);
    await call('staff', 'updateDeliveryStatus', {
      deliveryId,
      status: 'cancelled',
      note: 'Out of delivery range',
    });

    const cancelled = await eventually(async () => {
      const current = await order(placed.orderId);
      return current.status === 'cancelled' ? current : null;
    });
    assert.equal(cancelled.cancelReason, 'Cancelled by the store');
    await eventually(async () => (await stockOf(MANGO)) === before);
  });

  it('refuses cancellation once the driver has picked the order up', async () => {
    const placed = await call<PlaceOrderResponse>('shopper', 'placeOrder', {
      items: [{ productId: MILK, quantity: 1 }],
      addressId,
      paymentMethod: 'cod',
    });
    orderIds.push(placed.orderId);
    const { deliveryId } = await order(placed.orderId);
    await call('staff', 'assignDelivery', { deliveryId, driverId: people.driver.uid });
    await call('driver', 'updateDeliveryStatus', { deliveryId, status: 'accepted' });
    await call('driver', 'updateDeliveryStatus', { deliveryId, status: 'picked_up' });
    await assert.rejects(
      call('shopper', 'cancelOrder', { orderId: placed.orderId }),
      /can no longer be cancelled/,
    );
  });
});

describe('reviews', () => {
  it('aggregates ratings onto the product', async () => {
    await db.doc(`products/${MANGO}/reviews/${people.shopper.uid}`).set({
      productId: MANGO,
      userId: people.shopper.uid,
      userName: 'Test Shopper',
      rating: 5,
      text: 'Great',
    });
    await db.doc(`products/${MANGO}/reviews/${people.other.uid}`).set({
      productId: MANGO,
      userId: people.other.uid,
      userName: 'Other Shopper',
      rating: 4,
      text: 'Good',
    });
    const product = await eventually(async () => {
      const snapshot = await db.doc(`products/${MANGO}`).get();
      return snapshot.get('ratingCount') === 2 ? snapshot : null;
    });
    assert.equal(product.get('rating'), 4.5);
  });
});
