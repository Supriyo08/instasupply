import { unregisterDom } from './support/dom';

import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { PriceInput } from '../src/features/quotes/builder/PriceInput';

after(unregisterDom);
afterEach(() => cleanup());

/** The builder's wiring: the draft holds cents, the field reports validity. */
function Harness({ log }: { log: { cents: number | null; valid: boolean } }) {
  const [cents, setCents] = useState<number | null>(null);
  return (
    <>
      <PriceInput
        cents={cents}
        label="Agreed price"
        placeholder="45.00"
        onChange={(next) => {
          log.cents = next;
          setCents(next);
        }}
        onValidity={(valid) => {
          log.valid = valid;
        }}
      />
      <output data-testid="cents">{cents === null ? 'list' : String(cents)}</output>
    </>
  );
}

const field = () => screen.getByLabelText('Agreed price') as HTMLInputElement;

/** Types like a user: each key appends to what the field currently shows. */
function typeKeys(text: string) {
  for (const key of text) fireEvent.change(field(), { target: { value: field().value + key } });
}

test('typing 12.50 one key at a time keeps the text and saves 1250 cents', () => {
  const log = { cents: null as number | null, valid: true };
  render(<Harness log={log} />);
  typeKeys('12.50');
  assert.equal(field().value, '12.50');
  assert.equal(log.cents, 1250);
  assert.equal(screen.getByTestId('cents').textContent, '1250');
  assert.equal(log.valid, true);
});

test('typing 45 then a decimal never jumps to 4.00 or clears the price', () => {
  const log = { cents: null as number | null, valid: true };
  render(<Harness log={log} />);
  typeKeys('45.');
  assert.equal(field().value, '45.');
  assert.equal(log.cents, 4500);
  typeKeys('9');
  assert.equal(log.cents, 4590);
});

test('blur tidies the text; invalid text stays visible with an error and keeps the last valid price', () => {
  const log = { cents: null as number | null, valid: true };
  render(<Harness log={log} />);
  typeKeys('12.5');
  fireEvent.blur(field());
  assert.equal(field().value, '12.50');

  fireEvent.change(field(), { target: { value: '12.5.0' } });
  assert.equal(field().value, '12.5.0');
  assert.equal(log.valid, false);
  assert.equal(log.cents, 1250);
  assert.ok(screen.getByRole('alert').textContent);
  fireEvent.blur(field());
  assert.equal(field().value, '12.5.0', 'invalid text is not thrown away on blur');

  fireEvent.change(field(), { target: { value: '' } });
  assert.equal(log.valid, true);
  assert.equal(log.cents, null);
  assert.equal(screen.queryByRole('alert'), null);
});
