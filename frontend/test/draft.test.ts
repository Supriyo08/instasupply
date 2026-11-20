import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Quote, QuoteOffer } from '@instasupply/shared';

import {
  initialDraft,
  isFirstOrderOf,
  newerOfferVersion,
  parseDraft,
  sendRequestOf,
} from '../src/features/quotes/builder/draft';

const quoteWith = (offer: QuoteOffer | null): Quote => ({
  id: 'Q1',
  number: 'Q-10001',
  customerId: 'C1',
  customerName: 'Dana Builder',
  companyName: null,
  customerPhone: null,
  customerEmail: null,
  request: {
    lines: [{ text: '2x4 studs', quantity: 40 }],
    attachments: [],
    neededBy: { kind: 'asap', date: null },
    fulfilment: 'pickup',
    jobsite: null,
    contact: { preferred: 'call', phone: null, email: null },
    notes: null,
  },
  status: offer ? 'quoted' : 'in_review',
  statusAt: {},
  respondBy: 0,
  assignedTo: null,
  assignedName: null,
  offer,
  offerValidUntil: null,
  offerHistory: [],
  orderId: null,
  closeReason: null,
  createdAt: 0,
  updatedAt: 0,
});

const offerV = (version: number) =>
  ({
    version,
    lines: [],
    unmatched: [],
    fulfilment: 'pickup',
    receiving: null,
    windowId: null,
    unloadHelpStoreIds: [],
    message: null,
  }) as unknown as QuoteOffer;

test('sendQuote carries the version the draft was built on, not the live one', () => {
  const draft = initialDraft(quoteWith(offerV(1)));
  assert.equal(draft.baseVersion, 1);
  // A colleague sent version 2; the live quote moved, the draft did not.
  const live = quoteWith(offerV(2));
  assert.equal(sendRequestOf(draft, live, new Map()).expectedVersion, 1);
  assert.equal(newerOfferVersion(draft, live), 2);
  assert.equal(newerOfferVersion(draft, quoteWith(offerV(1))), null);
});

test('a first draft is built on version 0', () => {
  const draft = initialDraft(quoteWith(null));
  assert.equal(draft.baseVersion, 0);
  assert.equal(sendRequestOf(draft, quoteWith(null), new Map()).expectedVersion, 0);
  assert.equal(newerOfferVersion(draft, quoteWith(offerV(1))), 1);
});

test('parseDraft keeps a saved base version and falls back for older drafts', () => {
  const saved = JSON.parse(JSON.stringify(initialDraft(quoteWith(offerV(3))))) as Record<string, unknown>;
  assert.equal(parseDraft(saved, 5)?.baseVersion, 3);
  delete saved.baseVersion;
  assert.equal(parseDraft(saved, 5)?.baseVersion, 5);
  assert.equal(parseDraft({ ...saved, baseVersion: -1 }, 2)?.baseVersion, 2);
});

test('first-order default matches the server: missing stats price as a first order', () => {
  assert.equal(isFirstOrderOf(null), true);
  assert.equal(isFirstOrderOf({}), true);
  assert.equal(isFirstOrderOf({ stats: { nonCancelledOrders: 0 } }), true);
  assert.equal(isFirstOrderOf({ stats: { nonCancelledOrders: 2 } }), false);
});
