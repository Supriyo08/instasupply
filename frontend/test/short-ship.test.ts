import assert from 'node:assert/strict';
import { test } from 'node:test';

import { actionSendsAdjustments } from '../src/portal/components/short-ship';

test('only Accept, Mark ready and Confirm collection carry the short-ship quantities', () => {
  assert.equal(actionSendsAdjustments({ kind: 'accept' }), true);
  assert.equal(actionSendsAdjustments({ kind: 'pickup' }), true);
  assert.equal(actionSendsAdjustments({ kind: 'status', status: 'ready' }), true);
  // These keep the typed quantities for the next action that sends them.
  assert.equal(actionSendsAdjustments({ kind: 'status', status: 'preparing' }), false);
  assert.equal(actionSendsAdjustments({ kind: 'reject' }), false);
});
