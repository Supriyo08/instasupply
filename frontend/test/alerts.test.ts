import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  claimNotificationAlerts,
  freshIds,
  isNotificationAlertClaimed,
} from '../src/features/notifications/alert-state';

test('the first usable answer only fills the seen set', () => {
  const first = freshIds(null, ['a', 'b']);
  assert.deepEqual(first.fresh, []);
  const second = freshIds(first.known, ['a', 'b', 'c']);
  assert.deepEqual(second.fresh, ['c']);
  assert.deepEqual(freshIds(second.known, ['c', 'a']).fresh, []);
});

test('an initial error (never passed) does not turn waiting orders into new ones', () => {
  // The hooks skip loading and error answers, so the first call is the successful retry.
  let known: Set<string> | null = null;
  const retry = freshIds(known, ['waiting-1', 'waiting-2']);
  known = retry.known;
  assert.deepEqual(retry.fresh, []);
  assert.deepEqual(freshIds(known, ['waiting-1', 'waiting-2', 'new-1']).fresh, ['new-1']);
});

test('the board claims store_order_new while mounted, so it is announced once', () => {
  assert.equal(isNotificationAlertClaimed('store_order_new'), false);
  const release = claimNotificationAlerts('store_order_new');
  const second = claimNotificationAlerts('store_order_new');
  assert.equal(isNotificationAlertClaimed('store_order_new'), true);
  release();
  release();
  assert.equal(isNotificationAlertClaimed('store_order_new'), true);
  second();
  assert.equal(isNotificationAlertClaimed('store_order_new'), false);
  assert.equal(isNotificationAlertClaimed('store_order_late'), false);
});
