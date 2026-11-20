/** The Dispatch tab marks a thread state read once; a failed try is not repeated in a loop. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createMarkReadGate } from '../src/features/chat/mark-read-gate';

describe('mark-read gate', () => {
  it('does not retry the same thread state after a rollback brings the unread count back', () => {
    const gate = createMarkReadGate();
    assert.equal(gate.shouldMark({ visible: true, unread: 3, updatedAt: 100 }), true);
    // Optimistic patch: 0 unread, then the failed request rolls back to 3 with the same updatedAt.
    assert.equal(gate.shouldMark({ visible: true, unread: 0, updatedAt: 100 }), false);
    for (let i = 0; i < 10; i += 1) {
      assert.equal(gate.shouldMark({ visible: true, unread: 3, updatedAt: 100 }), false);
    }
  });

  it('tries again for a new message, even with the same unread count', () => {
    const gate = createMarkReadGate();
    assert.equal(gate.shouldMark({ visible: true, unread: 1, updatedAt: 100 }), true);
    assert.equal(gate.shouldMark({ visible: true, unread: 0, updatedAt: 101 }), false);
    assert.equal(gate.shouldMark({ visible: true, unread: 1, updatedAt: 102 }), true);
  });

  it('tries again after the tab is left or the app goes to the background', () => {
    const gate = createMarkReadGate();
    assert.equal(gate.shouldMark({ visible: true, unread: 2, updatedAt: 5 }), true);
    assert.equal(gate.shouldMark({ visible: false, unread: 2, updatedAt: 5 }), false);
    assert.equal(gate.shouldMark({ visible: true, unread: 2, updatedAt: 5 }), true);
  });

  it('never marks while hidden or with nothing unread', () => {
    const gate = createMarkReadGate();
    assert.equal(gate.shouldMark({ visible: false, unread: 4, updatedAt: 1 }), false);
    assert.equal(gate.shouldMark({ visible: true, unread: 0, updatedAt: 1 }), false);
    assert.equal(gate.shouldMark({ visible: true, unread: 0, updatedAt: null }), false);
  });
});
