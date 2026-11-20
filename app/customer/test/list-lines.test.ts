/// <reference types="node" />
/**
 * The material-list form's first lines (features/quotes/list-lines.ts `initialDraftLines`): the cart's
 * "Send as a material list" hands over `?items=` in `materialListText`'s format, one item per line.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { initialDraftLines, requestLines } from '../src/features/quotes/list-lines';

const keys = () => {
  let next = 0;
  return () => `line-${(next += 1)}`;
};

describe('initialDraftLines', () => {
  it('splits the cart text into items with their quantities', () => {
    const lines = initialDraftLines(
      '24 × 2x4x8 SPF stud (2 in × 4 in × 8 ft)\n6 × Drywall 1/2 in (4 ft × 8 ft)\n\n1 × Rebar 10M',
      keys(),
    );
    assert.deepEqual(lines, [
      { key: 'line-1', text: '2x4x8 SPF stud (2 in × 4 in × 8 ft)', quantity: '24' },
      { key: 'line-2', text: 'Drywall 1/2 in (4 ft × 8 ft)', quantity: '6' },
      { key: 'line-3', text: 'Rebar 10M', quantity: '1' },
    ]);
    assert.deepEqual(requestLines(lines)[0], { text: '2x4x8 SPF stud (2 in × 4 in × 8 ft)', quantity: 24 });
  });

  it('starts with one empty row when nothing is handed over', () => {
    for (const raw of [undefined, null, '', '  \n ']) {
      assert.deepEqual(initialDraftLines(raw, keys()), [{ key: 'line-1', text: '', quantity: '' }]);
    }
  });

  it('gives every row its own key', () => {
    const newKey = keys();
    const lines = initialDraftLines('2 × A\n3 × B', newKey);
    assert.deepEqual(
      lines.map((line) => line.key),
      ['line-1', 'line-2'],
    );
    assert.equal(newKey(), 'line-3', 'the next "+ Add item" key does not collide');
  });
});
