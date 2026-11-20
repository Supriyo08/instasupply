/// <reference types="node" />
/**
 * The checkout draft (features/checkout/checkout-draft.ts): it belongs to one account, and the windows
 * of a `WINDOW_UNAVAILABLE` answer only stand in for the computed ones while they describe the same
 * checkout and are recent.
 */
import type { WindowOption } from '@instasupply/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SERVER_WINDOWS_TTL_MS,
  claimCheckoutDraft,
  currentCheckoutDraft,
  resetCheckoutDraft,
  updateCheckoutDraft,
  usableServerWindows,
  windowsKeyOf,
} from '../src/features/checkout/checkout-draft';

const WINDOWS = [{ id: 'asap', available: true }] as unknown as WindowOption[];

describe('claimCheckoutDraft', () => {
  it("drops one account's instructions and receiving when another account (or nobody) takes over", () => {
    claimCheckoutDraft('customer-a');
    updateCheckoutDraft({ instructions: 'Lockbox 4821', receiving: 'unattended', cardId: 'card-a' });
    claimCheckoutDraft('customer-a');
    assert.equal(currentCheckoutDraft().instructions, 'Lockbox 4821', 'same uid keeps the draft');

    claimCheckoutDraft(null);
    assert.equal(currentCheckoutDraft().instructions, null, 'sign-out or an ended session clears it');
    assert.equal(currentCheckoutDraft().receiving, null);
    assert.equal(currentCheckoutDraft().cardId, null);

    claimCheckoutDraft('customer-a');
    updateCheckoutDraft({ instructions: 'Gate code 1234', serverWindows: WINDOWS });
    claimCheckoutDraft('customer-b');
    assert.equal(currentCheckoutDraft().instructions, null, 'a different account starts empty');
    assert.equal(currentCheckoutDraft().serverWindows, null);
    resetCheckoutDraft();
  });
});

describe('usableServerWindows', () => {
  const key = windowsKeyOf(['store-b', 'store-a'], 'jobsite-1', 'attended');
  const saved = { serverWindows: WINDOWS, serverWindowsKey: key, serverWindowsAt: 1_000 };

  it('uses them for the same checkout while they are recent', () => {
    assert.equal(usableServerWindows(saved, key, 1_000 + SERVER_WINDOWS_TTL_MS - 1), WINDOWS);
    assert.equal(
      usableServerWindows(saved, windowsKeyOf(['store-a', 'store-b'], 'jobsite-1', 'attended'), 2_000),
      WINDOWS,
      'store order does not matter',
    );
  });

  it('ignores them once they are old', () => {
    assert.equal(usableServerWindows(saved, key, 1_000 + SERVER_WINDOWS_TTL_MS), null);
  });

  it('ignores them after the stores, jobsite or receiving change', () => {
    assert.equal(usableServerWindows(saved, windowsKeyOf(['store-a'], 'jobsite-1', 'attended'), 2_000), null);
    assert.equal(
      usableServerWindows(saved, windowsKeyOf(['store-a', 'store-b'], 'jobsite-2', 'attended'), 2_000),
      null,
    );
    assert.equal(
      usableServerWindows(saved, windowsKeyOf(['store-a', 'store-b'], 'jobsite-1', 'unattended'), 2_000),
      null,
    );
  });

  it('has nothing to use without windows or a key', () => {
    assert.equal(usableServerWindows({ ...saved, serverWindows: null }, key, 2_000), null);
    assert.equal(usableServerWindows({ ...saved, serverWindowsKey: null }, key, 2_000), null);
    assert.equal(usableServerWindows({ ...saved, serverWindowsAt: null }, key, 2_000), null);
  });
});
