/**
 * Checkout. In one transaction: re-price the cart from catalogue prices, check and decrement
 * stock, apply the promo (first-order rules checked server-side), take payment (cash on delivery,
 * or a simulated card charge in test mode), and create the order together with the delivery that
 * dispatch will assign. The client never sends prices.
 */
import {
  COLLECTIONS,
  CURRENCY,
  MAX_CART_LINES,
  MAX_QUANTITY_PER_LINE,
  cleanText,
  formatAddress,
  formatCurrency,
  priceCart,
  type Address,
  type CartLine,
  type OrderItem,
  type PaymentMethod,
  type PlaceOrderRequest,
  type PlaceOrderResponse,
  type Product,
  type SavedCard,
  type UserProfile,
} from '@instasupply/shared';
import * as logger from 'firebase-functions/logger';

import { settings } from '../../config/runtime';
import { db, FieldValue, serverTimestamp } from '../../lib/admin';
import { failedPrecondition, invalidArgument, notFound } from '../../lib/errors';
import { callable, settleAll } from '../../lib/functions';
import { requireCustomer, requireString } from '../../lib/guards';
import { peekOrderIdInTx } from '../../lib/ids';
import { userRef } from '../../lib/users';
import { stageNewDelivery } from '../deliveries/delivery-writer';
import { geocodeFirst } from '../geocoding/geocoder';
import { notifyStaff, notifyUser } from '../notifications/notify';

/** Merge duplicate lines and validate quantities. */
function normalizeLines(raw: unknown): CartLine[] {
  if (!Array.isArray(raw) || raw.length === 0) invalidArgument('Your cart is empty.');
  const merged = new Map<string, number>();
  for (const line of raw as Partial<CartLine>[]) {
    const productId = typeof line?.productId === 'string' ? line.productId.trim() : '';
    const quantity = Number(line?.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity < 1) invalidArgument('Your cart has an invalid item.');
    merged.set(productId, (merged.get(productId) ?? 0) + quantity);
  }
  if (merged.size > MAX_CART_LINES) invalidArgument(`You can order up to ${MAX_CART_LINES} different products at once.`);
  for (const quantity of merged.values()) {
    if (quantity > MAX_QUANTITY_PER_LINE) invalidArgument(`You can order up to ${MAX_QUANTITY_PER_LINE} of each product.`);
  }
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
}

function parsePaymentMethod(value: unknown): PaymentMethod {
  if (value === 'cod' || value === 'card') return value;
  return invalidArgument('Choose a payment method.');
}

export const placeOrder = callable<PlaceOrderRequest, PlaceOrderResponse>('placeOrder', async (request) => {
  const actor = requireCustomer(request);
  const uid = actor.uid;
  const lines = normalizeLines(request.data?.items);
  const addressId = requireString(request.data?.addressId, 'Delivery address');
  const paymentMethod = parsePaymentMethod(request.data?.paymentMethod);
  const notes = cleanText(request.data?.notes, 300);
  const promoCode =
    typeof request.data?.promoCode === 'string' && request.data.promoCode.trim()
      ? request.data.promoCode.trim().toUpperCase()
      : null;
  if (paymentMethod === 'card' && settings.paymentsMode !== 'test') {
    failedPrecondition('Card payments are not available yet. Please choose cash on delivery.');
  }

  // Resolve the drop-off location before the transaction (geocoding is a network call).
  const addressRef = userRef(uid).collection(COLLECTIONS.addresses).doc(addressId);
  const addressSnap = await addressRef.get();
  if (!addressSnap.exists) notFound('That address no longer exists. Choose another one.');
  const savedAddress = addressSnap.data() as Address;
  let location = savedAddress.location;
  if (!location) {
    location = await geocodeFirst(formatAddress(savedAddress));
    if (!location) failedPrecondition("We couldn't locate this address. Edit it and drop a pin on the map.");
    await addressRef.update({ location });
  }

  const productRefs = lines.map((line) => db.collection(COLLECTIONS.products).doc(line.productId));
  const cardId = typeof request.data?.cardId === 'string' ? request.data.cardId : null;

  const placed = await db.runTransaction(async (tx) => {
    // ---- reads ----
    const profileSnap = await tx.get(userRef(uid));
    const productSnaps = await tx.getAll(...productRefs);
    const cardSnap =
      paymentMethod === 'card' && cardId ? await tx.get(userRef(uid).collection(COLLECTIONS.cards).doc(cardId)) : null;
    const previousOrders = await tx.get(db.collection(COLLECTIONS.orders).where('customerId', '==', uid).limit(20));
    const counter = await peekOrderIdInTx(tx);

    // ---- validation ----
    const profile = profileSnap.data() as UserProfile | undefined;
    if (!profile || profile.role !== 'customer') failedPrecondition('Finish setting up your account first.');
    if (!profile.phoneVerified) failedPrecondition('Verify your mobile number before placing an order.');

    const items: OrderItem[] = lines.map((line, index) => {
      const snapshot = productSnaps[index]!;
      const product = snapshot.data() as Product | undefined;
      if (!snapshot.exists || !product || !product.active) {
        return failedPrecondition('An item in your cart is no longer available. Please review your cart.');
      }
      if (product.stock < line.quantity) {
        return failedPrecondition(
          product.stock > 0
            ? `Only ${product.stock} × ${product.name} left. Please update your cart.`
            : `${product.name} just sold out. Please remove it from your cart.`,
        );
      }
      return {
        productId: snapshot.id,
        name: product.name,
        unit: product.unit,
        price: product.price,
        quantity: line.quantity,
        imageKey: product.imageKey ?? null,
        imageUrl: product.imageUrl ?? null,
        lineTotal: Math.round(product.price * line.quantity * 100) / 100,
      };
    });

    const isFirstOrder = previousOrders.docs.every((doc) => doc.get('status') === 'cancelled');
    const priced = priceCart(items, { promoCode, isFirstOrder });
    if (promoCode && priced.promoError) invalidArgument(priced.promoError);

    let card: { brand: SavedCard['brand']; last4: string } | null = null;
    if (paymentMethod === 'card') {
      const saved = cardSnap?.exists ? (cardSnap.data() as SavedCard) : null;
      if (!saved) invalidArgument('Choose a saved card or add a new one.');
      card = { brand: saved.brand, last4: saved.last4 };
    }

    // ---- writes ----
    counter.stage();
    const orderRef = db.collection(COLLECTIONS.orders).doc();
    lines.forEach((line, index) => {
      tx.update(productRefs[index]!, { stock: FieldValue.increment(-line.quantity), updatedAt: serverTimestamp() });
    });

    const addressFields = {
      label: savedAddress.label,
      name: savedAddress.name,
      phone: savedAddress.phone,
      line1: savedAddress.line1,
      line2: savedAddress.line2 ?? null,
      landmark: savedAddress.landmark ?? null,
      city: savedAddress.city,
      zip: savedAddress.zip,
      location,
    };
    const delivery = stageNewDelivery(tx, {
      input: {
        customerName: savedAddress.name,
        customerPhone: savedAddress.phone,
        customerEmail: profile.email,
        address: formatAddress(savedAddress),
        location,
        addressNotes: savedAddress.landmark ? `Landmark: ${savedAddress.landmark}` : null,
        notes,
        packageCount: Math.max(1, Math.ceil(priced.itemCount / 8)),
        priority: 'normal',
        codAmount: paymentMethod === 'cod' ? priced.total : null,
        requireCode: true,
        driverId: null,
        windowStart: null,
        windowEnd: null,
      },
      location,
      orderId: counter.orderId,
      driver: null,
      actor: { id: uid, name: profile.displayName, role: 'customer' },
      sourceOrderId: orderRef.id,
      customerId: uid,
    });

    tx.set(orderRef, {
      number: counter.orderId,
      customerId: uid,
      customerName: profile.displayName,
      items,
      itemCount: priced.itemCount,
      subtotal: priced.subtotal,
      deliveryFee: priced.deliveryFee,
      discount: priced.discount,
      total: priced.total,
      currency: CURRENCY,
      promoCode: priced.promo?.code ?? null,
      paymentMethod,
      // Test mode: the card "charge" always succeeds and no money moves.
      paymentStatus: paymentMethod === 'card' ? 'paid' : 'cod_pending',
      paymentRef: paymentMethod === 'card' ? `test_${orderRef.id}` : null,
      card,
      address: addressFields,
      notes,
      status: 'placed',
      statusAt: { placed: serverTimestamp() },
      deliveryId: delivery.id,
      trackingToken: delivery.trackingToken,
      cancelReason: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return {
      orderId: orderRef.id,
      number: counter.orderId,
      total: priced.total,
      itemCount: priced.itemCount,
      trackingToken: delivery.trackingToken,
      deliveryId: delivery.id,
      city: savedAddress.city,
    };
  });

  logger.info('Order placed', { uid, orderId: placed.orderId, total: placed.total, paymentMethod });
  await settleAll('placeOrder', [
    notifyUser(uid, {
      type: 'order_placed',
      title: 'Order placed',
      body: `${placed.number} · ${formatCurrency(placed.total)}. We'll let you know as soon as a driver is assigned.`,
      data: { customerOrderId: placed.orderId, number: placed.number },
      key: `order-placed-${placed.orderId}`,
    }),
    notifyStaff({
      type: 'order_placed',
      title: `New order ${placed.number}`,
      body: `${placed.itemCount} items · ${formatCurrency(placed.total)} · ${placed.city}. Assign a driver.`,
      data: { deliveryId: placed.deliveryId, orderId: placed.number, customerOrderId: placed.orderId },
      key: `order-placed-staff-${placed.orderId}`,
    }),
  ]);

  return {
    orderId: placed.orderId,
    number: placed.number,
    total: placed.total,
    trackingToken: placed.trackingToken,
  };
});
