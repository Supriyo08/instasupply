import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parsePriceText, priceText } from '../src/features/quotes/builder/price-text';

test('parsePriceText reads dollars and cents with integer arithmetic', () => {
  assert.deepEqual(parsePriceText('12.50'), { ok: true, cents: 1250 });
  assert.deepEqual(parsePriceText('12.5'), { ok: true, cents: 1250 });
  assert.deepEqual(parsePriceText('12.'), { ok: true, cents: 1200 });
  assert.deepEqual(parsePriceText('.5'), { ok: true, cents: 50 });
  assert.deepEqual(parsePriceText(' $1,200.07 '), { ok: true, cents: 120007 });
  assert.deepEqual(parsePriceText('0.29'), { ok: true, cents: 29 });
  assert.deepEqual(parsePriceText('45'), { ok: true, cents: 4500 });
});

test('parsePriceText: empty is the list price, bad text is an error, never a silent null', () => {
  assert.deepEqual(parsePriceText(''), { ok: true, cents: null });
  assert.deepEqual(parsePriceText('   '), { ok: true, cents: null });
  for (const bad of ['1.00.', '1.002', 'abc', '.', '$.', '-5', '1e3', '0', '0.00', '100000.01']) {
    assert.equal(parsePriceText(bad).ok, false, bad);
  }
  assert.deepEqual(parsePriceText('100000'), { ok: true, cents: 10_000_000 });
});

test('priceText formats cents for the idle field', () => {
  assert.equal(priceText(null), '');
  assert.equal(priceText(1250), '12.50');
  assert.equal(priceText(5), '0.05');
});
