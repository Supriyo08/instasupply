/**
 * Seeds the local emulators with a realistic Bengaluru demo: staff, drivers, deliveries in every
 * state, a planned route, a chat thread, notifications, the grocery catalogue and a shopper with
 * real orders placed through checkout.
 *
 * Deliveries are created and progressed through the real callables, so seeding also smoke-tests
 * the backend end to end.
 *
 *   npm run emulators   # terminal 1
 *   npm run seed        # terminal 2 (wipes emulator data first)
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

import {
  buildSearchTerms,
  type CreateDeliveriesResponse,
  type DeliveryInput,
  type PlaceOrderResponse,
  type Role,
} from '@instasupply/shared';

import { CATEGORIES, PRODUCTS, REVIEWS } from './data/catalog';
import {
  assertEmulatorsRunning,
  callFunction,
  PROJECT_ID,
  resetEmulators,
  signIn,
  sleep,
} from './lib/emulator';
import { SEED_PASSWORD } from './seed-constants';

interface SeedUser {
  key: string;
  email: string;
  displayName: string;
  role: Role;
  status: 'active' | 'pending';
  phoneNumber?: string;
  vehicle?: { type: 'scooter' | 'bike' | 'car' | 'van'; plate: string; model: string };
  location?: { lat: number; lng: number; online: boolean };
}

const USERS: SeedUser[] = [
  {
    key: 'admin',
    email: 'admin@instasupply.test',
    displayName: 'Ananya Admin',
    role: 'admin',
    status: 'active',
  },
  {
    key: 'dispatch',
    email: 'dispatch@instasupply.test',
    displayName: 'Dev Dispatcher',
    role: 'dispatcher',
    status: 'active',
  },
  {
    key: 'ravi',
    email: 'ravi@instasupply.test',
    displayName: 'Ravi Kumar',
    role: 'driver',
    status: 'active',
    phoneNumber: '+919900000001',
    vehicle: { type: 'scooter', plate: 'KA01AB1234', model: 'Honda Activa' },
    location: { lat: 12.9345, lng: 77.6101, online: true },
  },
  {
    key: 'meera',
    email: 'meera@instasupply.test',
    displayName: 'Meera Shah',
    role: 'driver',
    status: 'active',
    phoneNumber: '+919900000002',
    vehicle: { type: 'car', plate: 'KA03MN5678', model: 'Maruti Swift' },
    location: { lat: 12.9784, lng: 77.6408, online: true },
  },
  {
    key: 'arjun',
    email: 'arjun@instasupply.test',
    displayName: 'Arjun Das',
    role: 'driver',
    status: 'active',
    phoneNumber: '+919900000003',
    vehicle: { type: 'bike', plate: 'KA05XY9012', model: 'Bajaj Pulsar' },
    location: { lat: 12.9279, lng: 77.5837, online: false },
  },
  {
    key: 'pending',
    email: 'new.driver@instasupply.test',
    displayName: 'Kiran Gowda',
    role: 'driver',
    status: 'pending',
    vehicle: { type: 'van', plate: 'KA51VN4321', model: 'Tata Ace' },
  },
  {
    key: 'customer',
    email: 'customer@instasupply.test',
    displayName: 'Priya Sharma',
    role: 'customer',
    status: 'active',
    phoneNumber: '+919900000010',
  },
];

type Seeded = Partial<DeliveryInput> & { key: string; driver?: string };

const DELIVERIES: Seeded[] = [
  // Ravi — a full active route around Koramangala / HSR / BTM.
  {
    key: 'r1',
    driver: 'ravi',
    customerName: 'Asha Rao',
    customerPhone: '+919811000001',
    address: '12, 80 Feet Rd, Koramangala 4th Block, Bengaluru',
    location: { lat: 12.9352, lng: 77.6245 },
    addressNotes: 'Blue gate, 2nd floor',
    packageCount: 2,
    requireCode: true,
  },
  {
    key: 'r2',
    driver: 'ravi',
    customerName: 'Vikram Shetty',
    customerPhone: '+919811000002',
    address: '27th Main Rd, HSR Layout Sector 1, Bengaluru',
    location: { lat: 12.9116, lng: 77.6474 },
    codAmount: 1299,
    priority: 'high',
  },
  {
    key: 'r3',
    driver: 'ravi',
    customerName: 'Priya Nair',
    customerPhone: '+919811000003',
    address: 'BTM Layout 2nd Stage, Bengaluru',
    location: { lat: 12.9166, lng: 77.6101 },
  },
  {
    key: 'r4',
    driver: 'ravi',
    customerName: 'Karthik Iyer',
    customerPhone: '+919811000004',
    address: 'Domlur Layout, Bengaluru',
    location: { lat: 12.961, lng: 77.6387 },
    notes: 'Fragile — glassware',
  },
  {
    key: 'r5',
    driver: 'ravi',
    customerName: 'Fatima Khan',
    customerPhone: '+919811000005',
    address: '1st Cross, Ejipura, Bengaluru',
    location: { lat: 12.9456, lng: 77.6261 },
  },
  // Meera — Indiranagar / central.
  {
    key: 'm1',
    driver: 'meera',
    customerName: 'Rahul Menon',
    customerPhone: '+919811000006',
    address: '100 Feet Rd, Indiranagar, Bengaluru',
    location: { lat: 12.9719, lng: 77.6412 },
    requireCode: true,
  },
  {
    key: 'm2',
    driver: 'meera',
    customerName: 'Sneha Kulkarni',
    customerPhone: '+919811000007',
    address: 'Church St, Shanthala Nagar, Bengaluru',
    location: { lat: 12.9752, lng: 77.6046 },
    priority: 'urgent',
  },
  {
    key: 'm3',
    driver: 'meera',
    customerName: 'Arun Prakash',
    customerPhone: '+919811000008',
    address: 'Ulsoor Lake Rd, Halasuru, Bengaluru',
    location: { lat: 12.9822, lng: 77.62 },
    codAmount: 450,
  },
  // History for today.
  {
    key: 'd1',
    driver: 'meera',
    customerName: 'Divya Reddy',
    customerPhone: '+919811000009',
    address: 'MG Road, Bengaluru',
    location: { lat: 12.9756, lng: 77.6066 },
  },
  {
    key: 'f1',
    driver: 'ravi',
    customerName: 'Mohammed Irfan',
    customerPhone: '+919811000010',
    address: '4th Block, Jayanagar, Bengaluru',
    location: { lat: 12.925, lng: 77.5938 },
  },
  // Unassigned queue for dispatch.
  {
    key: 'u1',
    customerName: 'Lakshmi Narayan',
    customerPhone: '+919811000011',
    address: 'Malleshwaram 8th Cross, Bengaluru',
    location: { lat: 13.0035, lng: 77.571 },
    priority: 'high',
  },
  {
    key: 'u2',
    customerName: 'Neha Gupta',
    customerPhone: '+919811000012',
    address: 'Whitefield Main Rd, Whitefield, Bengaluru',
    location: { lat: 12.9698, lng: 77.75 },
    packageCount: 3,
  },
  {
    key: 'u3',
    customerName: 'Sanjay Patil',
    customerPhone: '+919811000013',
    address: 'Bannerghatta Rd, JP Nagar, Bengaluru',
    location: { lat: 12.8916, lng: 77.597 },
    codAmount: 2100,
  },
  {
    key: 'u4',
    customerName: 'Ananya Bhat',
    customerPhone: '+919811000014',
    address: 'Outer Ring Rd, Marathahalli, Bengaluru',
    location: { lat: 12.9591, lng: 77.6974 },
    requireCode: true,
  },
];

async function main() {
  await assertEmulatorsRunning();
  console.log(`Seeding emulator project ${PROJECT_ID}…`);
  await resetEmulators();

  const app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID });
  const auth = getAuth(app);
  const db = getFirestore(app);

  // 1. Accounts, claims and profiles.
  const uid: Record<string, string> = {};
  for (const user of USERS) {
    const record = await auth.createUser({
      email: user.email,
      password: SEED_PASSWORD,
      displayName: user.displayName,
      emailVerified: true,
      phoneNumber: user.phoneNumber,
    });
    uid[user.key] = record.uid;
    await auth.setCustomUserClaims(record.uid, { role: user.role, active: user.status === 'active' });
    await db.doc(`users/${record.uid}`).set({
      uid: record.uid,
      role: user.role,
      status: user.status,
      displayName: user.displayName,
      email: user.email,
      phoneNumber: user.phoneNumber ?? null,
      phoneVerified: !!user.phoneNumber,
      vehicle: user.vehicle ?? null,
      photoURL: null,
      preferences:
        user.role === 'customer'
          ? { orderPush: true, promoPush: true, chatPush: true }
          : { chatPush: true, deliveryPush: true },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (user.location) {
      await db.doc(`driverLocations/${record.uid}`).set({
        lat: user.location.lat,
        lng: user.location.lng,
        heading: 45,
        speed: user.location.online ? 6 : 0,
        accuracy: 8,
        online: user.location.online,
        battery: 0.82,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
  console.log(`  ✓ ${USERS.length} accounts`);

  // 2. Deliveries through the real callable (as the admin).
  const adminToken = await signIn('admin@instasupply.test', SEED_PASSWORD);
  const payload = DELIVERIES.map(({ key: _key, driver, ...input }) => ({
    ...input,
    driverId: driver ? uid[driver] : null,
  }));
  const created = await callFunction<CreateDeliveriesResponse>('createDeliveries', adminToken, {
    deliveries: payload,
  });
  if (created.errors.length) throw new Error(`createDeliveries errors: ${JSON.stringify(created.errors)}`);
  const id: Record<string, string> = {};
  created.created.forEach((item) => (id[DELIVERIES[item.index]!.key] = item.id));
  console.log(`  ✓ ${created.created.length} deliveries`);

  // 3. Progress deliveries as the drivers would.
  const raviToken = await signIn('ravi@instasupply.test', SEED_PASSWORD);
  const meeraToken = await signIn('meera@instasupply.test', SEED_PASSWORD);
  const status = (token: string, deliveryId: string, next: string, extra: object = {}) =>
    callFunction('updateDeliveryStatus', token, { deliveryId, status: next, ...extra });

  for (const key of ['r1', 'r2', 'r3', 'f1']) await status(raviToken, id[key]!, 'accepted');
  for (const key of ['r1', 'r2', 'f1']) await status(raviToken, id[key]!, 'picked_up');
  await status(raviToken, id.f1!, 'in_transit');
  await status(raviToken, id.f1!, 'arrived');
  await status(raviToken, id.f1!, 'failed', {
    failureReason: 'customer_unavailable',
    note: 'No answer after 3 calls',
  });
  await status(raviToken, id.r1!, 'in_transit');

  for (const key of ['m1', 'm2', 'd1']) await status(meeraToken, id[key]!, 'accepted');
  for (const key of ['m1', 'm2', 'd1']) await status(meeraToken, id[key]!, 'picked_up');
  await status(meeraToken, id.d1!, 'in_transit');
  await status(meeraToken, id.d1!, 'arrived');
  await callFunction('completeDelivery', meeraToken, { deliveryId: id.d1, recipientName: 'Divya (self)' });
  console.log('  ✓ statuses progressed through callables');

  // 4. A chat thread between dispatch and Ravi (the trigger maintains the thread summary).
  const thread = db.collection(`threads/${uid.ravi}/messages`);
  await thread.add({
    text: 'Morning Ravi! Asha asked for delivery before 1 pm if possible.',
    senderId: uid.dispatch,
    senderName: 'Dev Dispatcher',
    senderRole: 'staff',
    deliveryId: id.r1,
    kind: 'text',
    createdAt: FieldValue.serverTimestamp(),
  });
  await sleep(300);
  await thread.add({
    text: 'On my way',
    senderId: uid.ravi,
    senderName: 'Ravi Kumar',
    senderRole: 'driver',
    deliveryId: id.r1,
    kind: 'quick_reply',
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log('  ✓ chat thread');

  // 5. Grocery catalogue (public), seed reviews (a trigger aggregates ratings), and a shopper.
  const catalog = db.batch();
  for (const { id: categoryId, ...category } of CATEGORIES) {
    catalog.set(db.doc(`categories/${categoryId}`), category);
  }
  for (const { id: productId, ...product } of PRODUCTS) {
    const category = CATEGORIES.find((item) => item.id === product.categoryId)!;
    catalog.set(db.doc(`products/${productId}`), {
      ...product,
      imageUrl: null,
      rating: 0,
      ratingCount: 0,
      active: true,
      searchTerms: buildSearchTerms(product.name, [category.name, product.unit]),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await catalog.commit();
  for (const [index, review] of REVIEWS.entries()) {
    await db.doc(`products/${review.productId}/reviews/seed-reviewer-${index}`).set({
      ...review,
      userId: `seed-reviewer-${index}`,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  const addresses = db.collection(`users/${uid.customer}/addresses`);
  const home = await addresses.add({
    label: 'Home',
    name: 'Priya Sharma',
    phone: '+919900000010',
    line1: '12, 5th Cross, HSR Layout Sector 2',
    line2: null,
    landmark: 'Opposite Agara Lake park',
    city: 'Bengaluru',
    zip: '560102',
    location: { lat: 12.9121, lng: 77.6446 },
    isDefault: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await addresses.add({
    label: 'Work',
    name: 'Priya Sharma',
    phone: '+919900000010',
    line1: 'Prestige Tech Park, Kadubeesanahalli',
    line2: 'Tower B, 4th floor',
    landmark: null,
    city: 'Bengaluru',
    zip: '560103',
    location: { lat: 12.9393, lng: 77.6965 },
    isDefault: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  for (const productId of ['alphonso-mango', 'hass-avocado']) {
    await db.doc(`users/${uid.customer}/favorites/${productId}`).set({
      productId,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  // Two orders through the real checkout: one already delivered, one waiting for dispatch.
  const customerToken = await signIn('customer@instasupply.test', SEED_PASSWORD);
  const pastOrder = await callFunction<PlaceOrderResponse>('placeOrder', customerToken, {
    items: [
      { productId: 'hass-avocado', quantity: 1 },
      { productId: 'alphonso-mango', quantity: 1 },
      { productId: 'farm-eggs', quantity: 1 },
    ],
    addressId: home.id,
    paymentMethod: 'cod',
    promoCode: 'FIRST20',
  });
  const pastDeliveryId = (await db.doc(`orders/${pastOrder.orderId}`).get()).get('deliveryId') as string;
  await callFunction('assignDelivery', adminToken, { deliveryId: pastDeliveryId, driverId: uid.arjun });
  const arjunToken = await signIn('arjun@instasupply.test', SEED_PASSWORD);
  for (const next of ['accepted', 'picked_up', 'in_transit', 'arrived']) {
    await status(arjunToken, pastDeliveryId, next);
  }
  const pastCode = (await db.doc(`deliveries/${pastDeliveryId}/private/meta`).get()).get('handoffCode');
  await callFunction('completeDelivery', arjunToken, {
    deliveryId: pastDeliveryId,
    recipientName: 'Priya Sharma',
    handoffCode: pastCode,
    codCollected: pastOrder.total,
  });
  const openOrder = await callFunction<PlaceOrderResponse>('placeOrder', customerToken, {
    items: [
      { productId: 'strawberry', quantity: 2 },
      { productId: 'fresh-broccoli', quantity: 1 },
      { productId: 'fresh-lime', quantity: 2 },
      { productId: 'toned-milk', quantity: 2 },
    ],
    addressId: home.id,
    paymentMethod: 'cod',
  });
  console.log(`  ✓ catalogue (${PRODUCTS.length} products), shopper and orders ${pastOrder.number} + ${openOrder.number}`);

  // Give triggers a moment to plan routes and sync tracking pages.
  await sleep(4000);
  const tracking = created.created.find((item) => DELIVERIES[item.index]!.key === 'r1')!.trackingToken;

  console.log(`
Done. Sign in with password ${SEED_PASSWORD}:
  Back office  admin@instasupply.test · dispatch@instasupply.test
  Driver app   ravi@instasupply.test · meera@instasupply.test · arjun@instasupply.test
               new.driver@instasupply.test (pending approval)
  Customer app customer@instasupply.test (order ${openOrder.number} is waiting for a driver)
  Test phone numbers for OTP: +91 99999 99999 / 88888 88888 / 77777 77777, code 123456

Customer tracking page for ${created.created.find((item) => DELIVERIES[item.index]!.key === 'r1')!.orderId}:
  http://localhost:5173/track/${tracking}

Make Ravi drive his route:  npm run simulate -- --driver ravi@instasupply.test
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
