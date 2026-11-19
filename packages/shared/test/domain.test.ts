/**
 * The names, reason lists and notification rules every app and function shares (§1.2, §2.3, §5.8), the
 * error codes (§5.9), manual deliveries, and the display helpers that are not about money or Toronto
 * time.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CALLABLES,
  COLLECTIONS,
  COUNTERS,
  DECLINE_REASONS,
  ERROR_CODES,
  ERROR_CODE_STATUS,
  FAILURE_REASONS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DATA_KEYS,
  NOTIFICATION_TYPES,
  PUSH_PREFERENCE_DEFAULTS,
  QUICK_REPLIES,
  STORAGE_FOLDERS,
  channelFor,
  declineReasonLabel,
  decodePolyline,
  encodePolyline,
  failureReasonLabel,
  firstName,
  formatAddressLine,
  formatClock,
  formatDate,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatEta,
  formatRelativeTime,
  haversineMeters,
  initials,
  isErrorCode,
  isPushAllowed,
  isSiteCausedFailure,
  normalizePhone,
  pluralize,
  pushPreferenceFor,
  randomToken,
  startOfDay,
  validateDeliveryInput,
  type ErrorCode,
  type ErrorCodeStatus,
  type NotificationChannel,
  type NotificationType,
  type PushPreference,
} from '../src';

describe('names shared by clients and functions', () => {
  it('uses every collection, callable, counter and storage folder name as its own value', () => {
    for (const table of [COLLECTIONS, CALLABLES, COUNTERS, STORAGE_FOLDERS]) {
      for (const [key, value] of Object.entries(table)) assert.equal(value, key);
    }
  });

  it('has the marketplace collections and no saved addresses', () => {
    assert.ok(!('addresses' in COLLECTIONS));
    for (const name of [
      'jobsites',
      'storeOrders',
      'jobOffers',
      'quotes',
      'issues',
      'ledgerEntries',
      'reviews',
    ]) {
      assert.ok(name in COLLECTIONS, name);
    }
  });

  it('names every callable of the marketplace, including the test-only job runner', () => {
    for (const name of ['placeOrder', 'acceptStoreOrder', 'completePickup', 'claimJob', 'runJobNow']) {
      assert.ok(name in CALLABLES, name);
    }
    assert.equal(CALLABLES.boostJobPayout, 'boostJobPayout');
  });
});

describe('delivery reasons', () => {
  it('knows which failures the site caused', () => {
    const siteCaused = FAILURE_REASONS.filter((reason) => reason.siteCaused).map((reason) => reason.id);
    assert.deepEqual(siteCaused, [
      'no_one_on_site',
      'site_closed',
      'access_issue',
      'wrong_address',
      'refused',
      'unsafe_to_unload',
    ]);
    assert.equal(isSiteCausedFailure('no_one_on_site'), true);
    assert.equal(isSiteCausedFailure('damaged'), false);
    assert.equal(isSiteCausedFailure('vehicle_issue'), false);
    assert.equal(isSiteCausedFailure('other'), false);
  });

  it('treats a missing or unknown reason like "other"', () => {
    assert.equal(isSiteCausedFailure(null), false);
    assert.equal(isSiteCausedFailure('customer_unavailable'), false);
    assert.equal(failureReasonLabel('nope'), 'Other');
    assert.equal(declineReasonLabel(undefined), 'Other');
  });

  it('labels the reasons a driver picks from', () => {
    assert.equal(failureReasonLabel('no_one_on_site'), 'Nobody on site');
    assert.equal(declineReasonLabel('too_far'), 'Too far from my area');
    assert.deepEqual(
      DECLINE_REASONS.map((reason) => reason.id),
      ['too_far', 'load_too_large', 'vehicle_issue', 'schedule_conflict', 'store_delay', 'other'],
    );
    assert.equal(QUICK_REPLIES.length, 7);
    assert.ok(QUICK_REPLIES.includes('Arrived — nobody on site'));
  });
});

describe('notifications', () => {
  // Every type, listed once; the compiler refuses this object when a type is missing or misspelled.
  const EVERY_TYPE: Record<NotificationType, true> = {
    delivery_assigned: true,
    delivery_unassigned: true,
    delivery_cancelled: true,
    delivery_updated: true,
    delivery_declined: true,
    delivery_failed: true,
    delivery_delivered: true,
    chat_message: true,
    driver_signup: true,
    account_approved: true,
    account_suspended: true,
    order_placed: true,
    order_update: true,
    order_delivered: true,
    order_cancelled: true,
    order_store_update: true,
    pickup_ready: true,
    refund_issued: true,
    quote_update: true,
    issue_update: true,
    support_reply: true,
    store_order_new: true,
    store_order_reminder: true,
    store_order_update: true,
    store_issue: true,
    job_offer: true,
    job_update: true,
    payout_sent: true,
    vehicle_review: true,
    store_order_late: true,
    job_unclaimed: true,
    quote_new: true,
    issue_new: true,
    support_message: true,
    store_suggestion: true,
    capture_failed: true,
    test: true,
    system: true,
  };
  const types = Object.keys(EVERY_TYPE) as NotificationType[];

  /** The channel rule as §5.8 words it, by prefix; the shared table spells out every type instead. */
  const channelByRule = (type: NotificationType): NotificationChannel => {
    if (type.startsWith('job_')) return 'jobs';
    if (['delivery_assigned', 'delivery_unassigned', 'delivery_cancelled'].includes(type))
      return 'assignments';
    if (type.startsWith('order_')) return 'orders';
    if (['pickup_ready', 'refund_issued', 'quote_update', 'issue_update'].includes(type)) return 'orders';
    if (type.startsWith('store_order_') || type === 'store_issue') return 'store';
    if (type === 'chat_message' || type.startsWith('support_')) return 'chat';
    return 'updates';
  };

  /** The preference rule as §5.8 words it. */
  const preferenceByRule = (type: NotificationType): PushPreference | null => {
    if (type.startsWith('job_')) return 'jobPush';
    if (type.startsWith('store_')) return 'storeOrderPush';
    if (channelByRule(type) === 'orders') return 'orderPush';
    if (channelByRule(type) === 'chat') return 'chatPush';
    if (type.startsWith('delivery_')) return 'deliveryPush';
    return null;
  };

  it('posts every type to the channel the rule gives', () => {
    assert.equal(types.length, 38);
    assert.deepEqual([...NOTIFICATION_TYPES].sort(), [...types].sort());
    for (const type of types) assert.equal(channelFor(type), channelByRule(type), type);
    assert.deepEqual([...new Set(types.map(channelFor))].sort(), [...NOTIFICATION_CHANNELS].sort());
  });

  it('gates every type with the preference the rule gives', () => {
    for (const type of types)
      assert.equal(pushPreferenceFor(type, 'dispatcher'), preferenceByRule(type), type);
    assert.equal(pushPreferenceFor('order_placed'), 'orderPush');
    assert.equal(pushPreferenceFor('pickup_ready', 'customer'), 'orderPush');
    assert.equal(pushPreferenceFor('support_reply', 'supplier'), 'chatPush');
    assert.equal(pushPreferenceFor('payout_sent', 'driver'), null);
  });

  it('never lets a driver mute the pushes that hand them work', () => {
    for (const type of types.filter((name) => name.startsWith('delivery_'))) {
      assert.equal(pushPreferenceFor(type, 'driver'), null, type);
      assert.equal(isPushAllowed(type, { deliveryPush: false }, 'driver'), true, type);
      assert.equal(isPushAllowed(type, { deliveryPush: false }, 'admin'), false, type);
    }
    assert.equal(pushPreferenceFor('job_offer', 'driver'), 'jobPush');
    assert.equal(isPushAllowed('job_offer', { jobPush: false }, 'driver'), false);
  });

  it('pushes by default, and mutes only the group that was switched off', () => {
    assert.equal(isPushAllowed('order_update', undefined, 'customer'), true);
    assert.equal(isPushAllowed('order_update', null, 'customer'), true);
    assert.equal(isPushAllowed('order_update', {}, 'customer'), true);
    assert.equal(isPushAllowed('order_update', { orderPush: false }, 'customer'), false);
    assert.equal(isPushAllowed('support_reply', { orderPush: false }, 'customer'), true);
    assert.equal(isPushAllowed('support_reply', { chatPush: false }, 'customer'), false);
    assert.equal(isPushAllowed('store_order_new', { storeOrderPush: false }, 'supplier'), false);
    assert.equal(isPushAllowed('account_suspended', { chatPush: false, orderPush: false }, 'customer'), true);
  });

  it('keeps promotions off until the customer opts in', () => {
    assert.equal(PUSH_PREFERENCE_DEFAULTS.promoPush, false);
    const others = Object.entries(PUSH_PREFERENCE_DEFAULTS).filter(([name]) => name !== 'promoPush');
    assert.equal(others.length, 5);
    for (const [name, value] of others) assert.equal(value, true, name);
  });

  it('does not crash on a type written by a newer build', () => {
    const unknown = 'brand_new_type' as NotificationType;
    assert.equal(channelFor(unknown), 'updates');
    assert.equal(pushPreferenceFor(unknown), null);
    assert.equal(isPushAllowed(unknown, { orderPush: false }), true);
    assert.equal(channelFor('constructor' as NotificationType), 'updates');
  });

  it('lists the seven deep-link keys', () => {
    assert.deepEqual(
      [...NOTIFICATION_DATA_KEYS],
      ['customerOrderId', 'storeOrderId', 'deliveryId', 'quoteId', 'issueId', 'threadId', 'payoutId'],
    );
  });
});

describe('error codes', () => {
  // The table of §5.9, in its order.
  const TABLE: [status: ErrorCodeStatus, codes: ErrorCode[]][] = [
    [
      'failed-precondition',
      ['PRICE_CHANGED', 'WINDOW_UNAVAILABLE', 'OUT_OF_STOCK', 'STORE_UNAVAILABLE', 'STORE_PAUSED'],
    ],
    ['failed-precondition', ['OUT_OF_RANGE', 'TOO_LARGE', 'JOBSITE_VEHICLE_LIMIT']],
    [
      'failed-precondition',
      ['EMPTY', 'TOO_MANY_STORES', 'NO_DROPOFF', 'DELIVERY_UNAVAILABLE', 'PICKUP_UNAVAILABLE'],
    ],
    ['failed-precondition', ['OUTSIDE_SERVICE_AREA', 'PHONE_UNVERIFIED', 'PAYMENTS_DISABLED']],
    ['failed-precondition', ['CARD_DECLINED', 'VERSION_CONFLICT', 'STORE_NOT_READY', 'DRIVER_NOT_ASSIGNED']],
    ['invalid-argument', ['CODE_INCORRECT']],
    ['resource-exhausted', ['CODE_LOCKED', 'RATE_LIMITED', 'TOO_MANY_JOBS']],
    ['invalid-argument', ['PHOTO_REQUIRED']],
    ['failed-precondition', ['OFFER_TAKEN', 'VEHICLE_TOO_SMALL', 'DRIVER_OFFLINE', 'RELEASED_RECENTLY']],
    ['failed-precondition', ['QUOTE_EXPIRED', 'QUOTE_VERSION']],
    ['failed-precondition', ['ISSUE_WINDOW_CLOSED', 'ISSUE_ALREADY_OPEN', 'REFUND_LIMIT']],
  ];

  it('has the 34 codes of the table, each under its own name', () => {
    const codes = TABLE.flatMap(([, list]) => list);
    assert.equal(codes.length, 34);
    assert.deepEqual(Object.keys(ERROR_CODES), codes);
    for (const [name, value] of Object.entries(ERROR_CODES)) assert.equal(value, name);
  });

  it('sends each code with the status of the table', () => {
    for (const [status, codes] of TABLE) {
      for (const code of codes) assert.equal(ERROR_CODE_STATUS[code], status, code);
    }
  });

  it('recognises a code that arrives untyped', () => {
    assert.equal(isErrorCode('PRICE_CHANGED'), true);
    assert.equal(isErrorCode('REFUND_LIMIT'), true);
    assert.equal(isErrorCode('price_changed'), false);
    assert.equal(isErrorCode('PRICE_CHANGED '), false);
    assert.equal(isErrorCode('NOT_A_CODE'), false);
    // Names every object has must not pass for codes.
    assert.equal(isErrorCode('constructor'), false);
    assert.equal(isErrorCode('toString'), false);
    assert.equal(isErrorCode(''), false);
    assert.equal(isErrorCode(undefined), false);
    assert.equal(isErrorCode(404), false);
  });
});

describe('manual deliveries', () => {
  const DELIVERY = {
    customerName: 'Dana Whitfield',
    address: 'Pape Ave & Dundas St E, Toronto',
  };

  it('normalizes Canadian phone numbers to E.164', () => {
    assert.equal(normalizePhone('4165550101'), '+14165550101');
    assert.equal(normalizePhone('1-416-555-0101'), '+14165550101');
    assert.equal(normalizePhone('+1 (647) 555-0199'), '+16475550199');
    assert.equal(normalizePhone('0165550101'), null);
    assert.equal(normalizePhone('+442079460958'), null);
    assert.equal(normalizePhone('12'), null);
  });

  it('reports each invalid field of a manual delivery', () => {
    const bad = validateDeliveryInput({ customerName: ' ', address: '', packageCount: 0 });
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.deepEqual(Object.keys(bad.errors).sort(), ['address', 'customerName', 'packageCount']);
      assert.equal(bad.errors.customerName, 'Customer name is required.');
      assert.equal(bad.errors.address, 'Address is required.');
      assert.equal(bad.errors.packageCount, 'Packages must be a whole number between 1 and 99.');
    }
  });

  it('cleans up a valid manual delivery', () => {
    const good = validateDeliveryInput({
      customerName: '  Dana   Whitfield ',
      address: 'Pape Ave & Dundas St E, Toronto',
      customerPhone: '(416) 555-0110',
      customerEmail: ' Dana@Whitfield.TEST ',
      location: { lat: '43.6648', lng: -79.3405 },
      addressNotes: ' Laneway access off Pape. ',
      priority: 'URGENT',
      requireCode: 'yes',
      driverId: ' driver-marco ',
      windowStart: '1795107600000',
      windowEnd: 1795114800000,
    });
    assert.equal(good.ok, true);
    if (good.ok) {
      assert.deepEqual(good.value, {
        customerName: 'Dana Whitfield',
        customerPhone: '+14165550110',
        customerEmail: 'dana@whitfield.test',
        address: 'Pape Ave & Dundas St E, Toronto',
        location: { lat: 43.6648, lng: -79.3405 },
        addressNotes: 'Laneway access off Pape.',
        notes: null,
        packageCount: 1,
        priority: 'urgent',
        requireCode: true,
        driverId: 'driver-marco',
        windowStart: 1795107600000,
        windowEnd: 1795114800000,
      });
    }
  });

  it('fills in what a short form leaves out', () => {
    const good = validateDeliveryInput(DELIVERY);
    assert.equal(good.ok, true);
    if (good.ok) {
      assert.deepEqual(good.value, {
        customerName: 'Dana Whitfield',
        customerPhone: null,
        customerEmail: null,
        address: 'Pape Ave & Dundas St E, Toronto',
        location: null,
        addressNotes: null,
        notes: null,
        packageCount: 1,
        priority: 'normal',
        requireCode: false,
        driverId: null,
        windowStart: null,
        windowEnd: null,
      });
    }
  });

  it('refuses a phone from another country, a broken email, a pin off the map and a window that ends first', () => {
    const errorsOf = (change: Record<string, unknown>): string[] => {
      const result = validateDeliveryInput({ ...DELIVERY, ...change });
      return result.ok ? [] : Object.keys(result.errors);
    };
    assert.deepEqual(errorsOf({ customerPhone: '+442079460958' }), ['customerPhone']);
    assert.deepEqual(errorsOf({ customerPhone: '0165550101' }), ['customerPhone']);
    assert.deepEqual(errorsOf({ customerPhone: '   ' }), []);
    assert.deepEqual(errorsOf({ customerEmail: 'dana@' }), ['customerEmail']);
    assert.deepEqual(errorsOf({ location: { lat: 91, lng: -79.3405 } }), ['location']);
    assert.deepEqual(errorsOf({ location: { lat: 'north', lng: 'west' } }), ['location']);
    assert.deepEqual(errorsOf({ priority: 'asap' }), ['priority']);
    assert.deepEqual(errorsOf({ windowStart: 2000, windowEnd: 2000 }), ['windowEnd']);
    assert.deepEqual(errorsOf({ windowStart: 2000, windowEnd: 1000 }), ['windowEnd']);
    assert.deepEqual(errorsOf({ windowStart: 1000, windowEnd: 2000 }), []);
  });

  it('takes 1 to 99 whole packages', () => {
    const packages = (packageCount: unknown) => validateDeliveryInput({ ...DELIVERY, packageCount }).ok;
    assert.equal(packages(1), true);
    assert.equal(packages(99), true);
    assert.equal(packages('12'), true);
    assert.equal(packages(0), false);
    assert.equal(packages(100), false);
    assert.equal(packages(2.5), false);
  });

  it('asks for the hand-off code only when the row clearly says yes', () => {
    const requireCode = (value: unknown) => {
      const result = validateDeliveryInput({ ...DELIVERY, requireCode: value });
      return result.ok ? result.value.requireCode : null;
    };
    for (const yes of [true, 'true', 'yes', 'Y', '1']) assert.equal(requireCode(yes), true, String(yes));
    for (const no of [false, 'false', 'no', '0', '', 'maybe', undefined, null, 1]) {
      assert.equal(requireCode(no), false, String(no));
    }
  });

  it('never throws on input that is not a delivery', () => {
    for (const junk of [undefined, null, 42, 'text', [], true]) {
      assert.equal(validateDeliveryInput(junk).ok, false);
    }
  });

  it('generates tokens of the requested length from the safe alphabet', () => {
    let seed = 7;
    const fakeRandom = (size: number) =>
      Uint8Array.from({ length: size }, () => (seed = (seed * 1103515245 + 12345) % 256));
    const token = randomToken(24, fakeRandom);
    assert.equal(token.length, 24);
    assert.match(token, /^[A-HJ-NP-Za-km-z2-9]+$/);
  });
});

describe('distances and polylines', () => {
  it('measures the seed trips the fee vectors are built on', () => {
    const leslieville = { lat: 43.6648, lng: -79.3405 };
    // Kestrel Lumber Yard → Leslieville: 19.2 km in a straight line, 26.0 km by road (§11.3).
    const fromKestrel = haversineMeters({ lat: 43.6966, lng: -79.5752 }, leslieville);
    assert.equal(Math.round(fromKestrel), 19_202);
    assert.equal(Math.ceil((fromKestrel * 1.35) / 100 - 1e-6), 260);
    // Glassmoor Glass & Mirror → Leslieville: 7.2 km by road.
    const fromGlassmoor = haversineMeters({ lat: 43.7102, lng: -79.3615 }, leslieville);
    assert.equal(Math.round(fromGlassmoor), 5_323);
    assert.equal(Math.ceil((fromGlassmoor * 1.35) / 100 - 1e-6), 72);
    assert.equal(haversineMeters(leslieville, leslieville), 0);
  });

  it('round-trips polylines', () => {
    const points = [
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ];
    const encoded = encodePolyline(points);
    assert.equal(encoded, '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    assert.deepEqual(decodePolyline(encoded), points);
  });
});

describe('display helpers', () => {
  it('formats durations and distances', () => {
    assert.equal(formatDuration(30), '< 1 min');
    assert.equal(formatDuration(25 * 60), '25 min');
    assert.equal(formatDuration(60 * 60), '1 h');
    assert.equal(formatDuration(65 * 60), '1 h 05 min');
    assert.equal(formatDistance(842), '840 m');
    assert.equal(formatDistance(4230), '4.2 km');
    assert.equal(formatDistance(26_000), '26 km');
  });

  it('formats names and counts', () => {
    assert.equal(initials('Dana Whitfield'), 'DW');
    assert.equal(initials('luis de la ortega'), 'LO');
    assert.equal(initials('Marco'), 'M');
    assert.equal(initials(''), '?');
    assert.equal(initials(null), '?');
    assert.equal(firstName('  Dana Whitfield'), 'Dana');
    assert.equal(firstName(''), 'Customer');
    assert.equal(firstName(undefined), 'Customer');
    assert.equal(pluralize(1, 'store'), '1 store');
    assert.equal(pluralize(4, 'store'), '4 stores');
    assert.equal(pluralize(0, 'item'), '0 items');
    assert.equal(pluralize(2, 'box', 'boxes'), '2 boxes');
  });

  it('writes an address on one line', () => {
    const pape = {
      line1: 'Pape Ave & Dundas St E',
      line2: null,
      city: 'Toronto',
      province: 'ON' as const,
      postalCode: 'M4M 2E3',
    };
    assert.equal(formatAddressLine(pape), 'Pape Ave & Dundas St E, Toronto ON M4M 2E3');
    assert.equal(
      formatAddressLine({ ...pape, line2: 'Unit 4' }),
      'Pape Ave & Dundas St E, Unit 4, Toronto ON M4M 2E3',
    );
    // A new build that only has a pin: no postal code yet.
    assert.equal(
      formatAddressLine({ ...pape, line1: 'Lot 14, Phase 3', postalCode: null }),
      'Lot 14, Phase 3, Toronto ON',
    );
    assert.equal(
      formatAddressLine({
        line1: ' Dixon Rd & Martin Grove Rd ',
        line2: '  ',
        city: 'Toronto',
        province: 'ON',
        postalCode: 'M9W 5L4',
      }),
      'Dixon Rd & Martin Grove Rd, Toronto ON M9W 5L4',
    );
  });

  it('tells how long ago something happened, from the given now', () => {
    const now = Date.UTC(2026, 10, 19, 17, 25);
    const minute = 60_000;
    assert.equal(formatRelativeTime(now, now), 'just now');
    assert.equal(formatRelativeTime(now - 44_000, now), 'just now');
    assert.equal(formatRelativeTime(now - 45_000, now), '1 min ago');
    assert.equal(formatRelativeTime(now - 10 * minute, now), '10 min ago');
    assert.equal(formatRelativeTime(now - 59 * minute, now), '59 min ago');
    assert.equal(formatRelativeTime(now - 60 * minute, now), '1 h ago');
    assert.equal(formatRelativeTime(now - 23 * 60 * minute, now), '23 h ago');
    assert.equal(formatRelativeTime(now - 30 * 60 * minute, now), 'yesterday');
    // A server clock that runs a little ahead of the phone is still "just now".
    assert.equal(formatRelativeTime(now + 30_000, now), 'just now');
    assert.equal(formatRelativeTime(now + 119_000, now), 'just now');
    assert.equal(formatRelativeTime(now + 2 * minute, now), 'in 2 min');
    assert.equal(formatRelativeTime(now + 10 * minute, now), 'in 10 min');
    assert.equal(formatRelativeTime(now + 65 * minute, now), 'in 1 h 05 min');
    assert.equal(formatRelativeTime(new Date(now - 10 * minute), now), '10 min ago');
  });

  it('writes the year of a date only when it is not the year of now', () => {
    // The wording belongs to the device's locale, so only what the rule decides is compared.
    const june = Date.UTC(2026, 5, 15, 16);
    const thisYear = formatDate(june, Date.UTC(2026, 10, 19));
    const nextYear = formatDate(june, Date.UTC(2027, 1, 1));
    assert.notEqual(thisYear, nextYear);
    assert.ok(nextYear.length > thisYear.length, `${nextYear} / ${thisYear}`);
    assert.equal(formatDate(june, Date.UTC(2026, 0, 20)), thisYear);
    assert.equal(formatDateTime(june, Date.UTC(2026, 10, 19)), `${thisYear}, ${formatClock(june)}`);
    assert.equal(formatDateTime(june, Date.UTC(2027, 1, 1)), `${nextYear}, ${formatClock(june)}`);
    assert.equal(formatEta(600, june), formatClock(june + 600_000));
  });

  it('shows a dash for a missing value', () => {
    assert.equal(formatDuration(null), '—');
    assert.equal(formatDuration(Number.NaN), '—');
    assert.equal(formatDistance(undefined), '—');
    assert.equal(formatRelativeTime(null, 0), '—');
    assert.equal(formatClock(undefined), '—');
    assert.equal(formatDate(null, 0), '—');
    assert.equal(formatDateTime(null, 0), '—');
    assert.equal(formatEta(null, 0), '—');
    assert.equal(formatEta(Number.POSITIVE_INFINITY, 0), '—');
    assert.equal(
      formatAddressLine({ line1: '', line2: null, city: '', province: 'ON', postalCode: null }),
      'ON',
    );
  });

  it('shows a dash, and does not crash, for a value that is not a time', () => {
    // What an older build or a hand-written document may still hold: a timestamp object, or text.
    const timestampObject = { toMillis: () => 1_795_000_000_000 } as unknown as number;
    const text = '2026-11-19T17:25:00Z' as unknown as number;
    for (const value of [timestampObject, text, Number.NaN, new Date(Number.NaN)]) {
      assert.equal(formatRelativeTime(value, 1_795_000_000_000), '—');
      assert.equal(formatClock(value), '—');
      assert.equal(formatDate(value, 1_795_000_000_000), '—');
      assert.equal(formatDateTime(value, 1_795_000_000_000), '—');
    }
    assert.equal(initials(42 as unknown as string), '?');
    assert.equal(firstName({} as unknown as string), 'Customer');
    assert.equal(formatAddressLine(null as unknown as Parameters<typeof formatAddressLine>[0]), '—');
  });

  it('finds the start of the day on the device clock', () => {
    const moment = Date.UTC(2026, 10, 19, 17, 25);
    const start = startOfDay(moment);
    assert.ok(start <= moment && moment - start < 24 * 3_600_000);
    assert.equal(new Date(start).getHours(), 0);
    assert.equal(new Date(start).getMinutes(), 0);
    assert.equal(start % 1000, 0);
    assert.equal(startOfDay(start), start);
  });
});
