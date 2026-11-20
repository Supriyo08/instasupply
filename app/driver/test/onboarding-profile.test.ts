/** The onboarding profile step (MARKETPLACE §10): the name rule matches `registerDriver`, a city is required. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkProfileStep, cleanDisplayName, DISPLAY_NAME_MAX } from '../src/features/auth/profile-step';

describe('onboarding profile step', () => {
  it('accepts a name and a city', () => {
    assert.deepEqual(checkProfileStep('Lena Kowalski', 'mississauga'), {});
  });

  it('cleans the name like the server does', () => {
    assert.equal(cleanDisplayName('  Lena \n  Kowalski '), 'Lena Kowalski');
  });

  it('asks for a name and a city when both are missing', () => {
    const errors = checkProfileStep('   ', null);
    assert.equal(errors.name, 'Enter your full name.');
    assert.equal(errors.city, 'Pick the city you drive in.');
  });

  it('refuses a name longer than the server accepts, after cleaning', () => {
    assert.ok(checkProfileStep('a'.repeat(DISPLAY_NAME_MAX + 1), 'toronto').name);
    assert.deepEqual(checkProfileStep(` ${'a'.repeat(DISPLAY_NAME_MAX)}   `, 'toronto'), {});
  });
});
