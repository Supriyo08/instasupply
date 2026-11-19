import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ERROR_CODES } from '@instasupply/shared';

import {
  ApiError,
  describeError,
  detailsFor,
  errorCodeOf,
  errorFromResponse,
  isNetworkError,
  statusForHttp,
  toApiError,
} from '../src/errors';
import { createTestClient } from '../src/testing';

const base = { requestId: 'req_1', method: 'POST', path: '/call/placeOrder' };

test('envelope: status from the body is the truth, the HTTP code is only recorded', () => {
  const error = errorFromResponse({
    ...base,
    httpStatus: 400,
    body: {
      error: {
        status: 'failed-precondition',
        code: 'PRICE_CHANGED',
        message: 'Prices changed. Review the new total.',
        details: { pricing: { total: 1 } },
      },
    },
  });
  assert.equal(error.status, 'failed-precondition');
  assert.equal(error.httpStatus, 400);
  assert.equal(error.code, ERROR_CODES.PRICE_CHANGED);
  assert.equal(error.message, 'Prices changed. Review the new total.');
  assert.deepEqual(error.details, { pricing: { total: 1 } });
  assert.equal(error.requestId, 'req_1');
  assert.equal(error.path, '/call/placeOrder');
  assert.equal(errorCodeOf(error), 'PRICE_CHANGED');
});

test('code is read from error.code, then from error.details.code', () => {
  const fromTop = errorFromResponse({
    ...base,
    httpStatus: 412,
    body: { error: { status: 'failed-precondition', code: 'OUT_OF_STOCK', message: 'x', details: {} } },
  });
  assert.equal(fromTop.code, 'OUT_OF_STOCK');
  const fromDetails = errorFromResponse({
    ...base,
    httpStatus: 412,
    body: { error: { status: 'failed-precondition', message: 'x', details: { code: 'STORE_PAUSED' } } },
  });
  assert.equal(fromDetails.code, 'STORE_PAUSED');
  const unknown = errorFromResponse({
    ...base,
    httpStatus: 412,
    body: { error: { status: 'failed-precondition', code: 'NOT_A_CODE', message: 'x', details: {} } },
  });
  assert.equal(unknown.code, null);
});

test('without an envelope the status comes from the HTTP code', () => {
  const table: [number, string][] = [
    [400, 'invalid-argument'],
    [422, 'invalid-argument'],
    [401, 'unauthenticated'],
    [403, 'permission-denied'],
    [404, 'not-found'],
    [409, 'already-exists'],
    [412, 'failed-precondition'],
    [429, 'resource-exhausted'],
    [502, 'unavailable'],
    [503, 'unavailable'],
    [504, 'unavailable'],
    [500, 'internal'],
    [507, 'internal'],
  ];
  for (const [http, status] of table) {
    assert.equal(statusForHttp(http), status, `HTTP ${http}`);
    const error = errorFromResponse({ ...base, httpStatus: http, body: '<html>proxy</html>' });
    assert.equal(error.status, status);
    assert.equal(error.fromServer, false, 'a proxy page has no message for the user');
  }
  const gateway = errorFromResponse({ ...base, httpStatus: 502, body: undefined });
  assert.equal(gateway.retryable, true);
  assert.equal(errorFromResponse({ ...base, httpStatus: 500, body: undefined }).retryable, false);
});

test('transport errors: TypeError is unavailable, AbortError cancelled; through the pipeline a timeout is deadline-exceeded', async () => {
  assert.equal(toApiError(new TypeError('fetch failed')).status, 'unavailable');
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  assert.equal(toApiError(abort).status, 'cancelled');
  assert.equal(toApiError('boom').status, 'internal');

  const { client, server, clock } = createTestClient();
  server.on('GET', '/thing', () => ({ body: { ok: true } }));
  server.failNext(3, 'timeout');
  const pending = client.get('/thing', { auth: 'none' }).catch((e: unknown) => e);
  await clock.advance(15_000 + 300 + 15_000 + 900 + 15_000);
  const error = (await pending) as ApiError;
  assert.equal(error.status, 'deadline-exceeded');
  assert.equal(isNetworkError(error), true);

  server.failNext(1, 'network');
  await assert.rejects(client.post('/thing', {}, { auth: 'none' }), (e: unknown) => {
    assert.equal((e as ApiError).status, 'unavailable');
    return true;
  });

  const controller = new AbortController();
  server.failNext(1, 'timeout');
  const cancelled = client.post('/thing', {}, { auth: 'none', signal: controller.signal }).catch((e: unknown) => e);
  controller.abort();
  assert.equal(((await cancelled) as ApiError).status, 'cancelled');
});

test('the envelope travels through the client with its code and request id', async () => {
  const { client, server } = createTestClient();
  server.on('POST', '/call/geocodeAddress', () => ({
    status: 'invalid-argument',
    code: 'CODE_INCORRECT',
    message: 'That code is incorrect.',
    details: { remaining: 2 },
  }));
  await assert.rejects(client.call('geocodeAddress', { query: 'x' }), (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 'invalid-argument');
    assert.equal(e.code, 'CODE_INCORRECT');
    assert.equal(e.httpStatus, 400);
    assert.match(e.requestId ?? '', /^req_/);
    assert.equal(detailsFor(e, 'CODE_INCORRECT')?.remaining, 2);
    return true;
  });
});

test('describeError table', () => {
  const make = (status: ApiError['status'], extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) =>
    new ApiError({ status, message: 'Server says hi.', httpStatus: 400, ...extra });
  assert.equal(describeError(make('unavailable', { httpStatus: null })), "Can't reach the server. Check your connection and try again.");
  assert.equal(
    describeError(make('deadline-exceeded', { httpStatus: null })),
    'This is taking longer than usual. Check your connection and try again.',
  );
  assert.equal(describeError(make('cancelled', { httpStatus: null })), 'The request was interrupted. Please try again.');
  assert.equal(
    describeError(make('unauthenticated', { details: { reason: 'credentials' } })),
    'That email and password combination is incorrect.',
  );
  assert.equal(
    describeError(make('unauthenticated', { details: { reason: 'session_revoked' } })),
    'Your session has ended. Please sign in again.',
  );
  assert.equal(
    describeError(make('permission-denied', { details: { reason: 'account_suspended' } })),
    'Your account is suspended. Contact InstaSupply support.',
  );
  assert.equal(describeError(make('permission-denied')), 'Server says hi.');
  assert.equal(describeError(make('permission-denied', { message: '' })), "You don't have access to this.");
  assert.equal(
    describeError(make('resource-exhausted', { message: '' })),
    'Too many requests right now. Please wait a moment and try again.',
  );
  assert.equal(describeError(make('not-found', { message: '' })), "That isn't available right now. Please try again later.");
  assert.equal(describeError(make('failed-precondition')), 'Server says hi.');
  assert.equal(describeError(make('internal')), 'Something went wrong. Please try again.');
  assert.equal(describeError(make('internal'), 'Could not save.'), 'Could not save.');
  assert.equal(describeError(new Error('raw')), 'Something went wrong. Please try again.');
  // A non-envelope 404 must not show "HTTP 404".
  assert.equal(
    describeError(errorFromResponse({ ...base, httpStatus: 404, body: undefined })),
    "That isn't available right now. Please try again later.",
  );
});

test('detailsFor gives typed details only for the matching code', () => {
  const error = new ApiError({
    status: 'failed-precondition',
    code: 'OUT_OF_STOCK',
    message: 'x',
    details: { productId: 'kestrel-lumber--2x4', available: 3 },
  });
  assert.equal(detailsFor(error, 'OUT_OF_STOCK')?.available, 3);
  assert.equal(detailsFor(error, 'VERSION_CONFLICT'), null);
  assert.equal(detailsFor(new Error('x'), 'OUT_OF_STOCK'), null);
});
