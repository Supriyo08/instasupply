import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PresignedUpload } from '../src/contract';
import type { ApiError } from '../src/errors';
import type { FakeRequest } from '../src/testing';
import { UPLOAD_LIMITS, validateUpload, type UploadSource } from '../src/uploads';

import { requestsTo, signedIn } from './support';

const photo = (bytes = 1_000, type = 'image/jpeg'): UploadSource => ({
  kind: 'blob',
  blob: new Blob([new Uint8Array(bytes)], { type }),
  name: 'proof.jpg',
  contentType: type,
});

async function withPresign(presigned: Partial<PresignedUpload>) {
  const kit = await signedIn();
  kit.server.on('POST', '/files/presign', (request) => ({
    body: {
      uploadId: 'up1',
      path: `proofs/${(request.body as { ownerId: string }).ownerId}/up1.jpg`,
      method: 'POST',
      url: 'https://storage.test/bucket',
      fields: {},
      headers: {},
      expiresAt: kit.clock.now() + 600_000,
      ...presigned,
    },
  }));
  kit.server.on('POST', '/files/confirm', () => ({
    body: { path: 'proofs/d1/up1.jpg', name: 'proof.jpg', contentType: 'image/jpeg', sizeBytes: 1_000 },
  }));
  return kit;
}

function formEntries(request: FakeRequest | undefined): [string, string][] {
  assert.ok(request?.body instanceof FormData, 'a multipart form was sent');
  return [...request.body.entries()].map(([name, value]) => [name, typeof value === 'string' ? value : `file:${value.name}`]);
}

test('S3 presigned POST: every field in order, then the file last, without our headers', async () => {
  const kit = await withPresign({
    fields: { key: 'uploads/up1', 'Content-Type': 'image/jpeg', Policy: 'p', 'X-Amz-Signature': 's' },
  });
  let target: FakeRequest | undefined;
  kit.server.on('POST', 'https://storage.test/bucket', (request) => {
    target = request;
    return { status: 204 };
  });
  const file = await kit.client.upload({ purpose: 'proof', ownerId: 'd1', source: photo() });
  assert.equal(file.path, 'proofs/d1/up1.jpg');
  assert.deepEqual(formEntries(target), [
    ['key', 'uploads/up1'],
    ['Content-Type', 'image/jpeg'],
    ['Policy', 'p'],
    ['X-Amz-Signature', 's'],
    ['file', 'file:proof.jpg'],
  ]);
  assert.equal(target?.headers.get('authorization'), null);
  assert.equal(target?.headers.get('content-type'), null, 'the runtime sets the multipart boundary');
  const presign = requestsTo(kit, 'POST', '/files/presign')[0]?.body;
  assert.deepEqual(presign, {
    purpose: 'proof',
    ownerId: 'd1',
    fileName: 'proof.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 1_000,
  });
  assert.deepEqual(requestsTo(kit, 'POST', '/files/confirm')[0]?.body, { uploadId: 'up1' });
});

test("the local driver's form: a token field, POST /files/local/{uploadId}", async () => {
  const kit = await withPresign({ url: 'https://api.test/api/v1/files/local/up1', fields: { token: 'tok_1' } });
  let target: FakeRequest | undefined;
  kit.server.on('POST', '/files/local/:uploadId', (request) => {
    target = request;
    return { status: 204 };
  });
  await kit.client.upload({ purpose: 'proof', ownerId: 'd1', source: photo() });
  assert.deepEqual(formEntries(target), [
    ['token', 'tok_1'],
    ['file', 'file:proof.jpg'],
  ]);
  assert.equal(target?.headers.get('authorization'), null);
});

test('PUT with the presigned headers (forward compatibility only)', async () => {
  const kit = await withPresign({ method: 'PUT', url: 'https://storage.test/put', headers: { 'Content-Type': 'image/jpeg' } });
  let target: FakeRequest | undefined;
  kit.server.on('PUT', 'https://storage.test/put', (request) => {
    target = request;
    return { status: 200, body: {} };
  });
  await kit.client.upload({ purpose: 'proof', ownerId: 'd1', source: photo() });
  assert.equal(target?.headers.get('content-type'), 'image/jpeg');
  assert.ok(target?.body instanceof Blob);
  assert.equal((target.body as Blob).size, 1_000);
});

test('local validation against UPLOAD_LIMITS, before any request', async () => {
  assert.equal(validateUpload('proof', photo()), null);
  assert.match(validateUpload('proof', photo(UPLOAD_LIMITS.proof.maxBytes + 1)) ?? '', /too large.*10 MB/);
  assert.match(validateUpload('proof', photo(10, 'application/pdf')) ?? '', /photo/);
  assert.match(validateUpload('avatar', photo(10, 'image/svg+xml')) ?? '', /photo/);
  assert.equal(validateUpload('quote_upload', { ...photo(10, 'application/pdf'), name: 'list.pdf' }), null);
  assert.match(validateUpload('quote_upload', photo(UPLOAD_LIMITS.quote_upload.maxBytes + 1)) ?? '', /15 MB/);
  assert.match(validateUpload('proof', photo(0)) ?? '', /empty/);

  const kit = await withPresign({});
  await assert.rejects(
    kit.client.upload({ purpose: 'avatar', ownerId: kit.uid, source: photo(6 * 1024 * 1024) }),
    (e: unknown) => (e as ApiError).status === 'invalid-argument',
  );
  assert.equal(requestsTo(kit, 'POST', '/files/presign').length, 0);
});

test('a failure at each step rejects', async () => {
  const presignFails = await withPresign({});
  presignFails.server.on('POST', '/files/presign', () => ({ status: 'permission-denied', message: 'Not your delivery.' }));
  await assert.rejects(
    presignFails.client.upload({ purpose: 'proof', ownerId: 'd1', source: photo() }),
    (e: unknown) => (e as ApiError).status === 'permission-denied',
  );

  const storageFails = await withPresign({});
  storageFails.server.on('POST', 'https://storage.test/bucket', () => ({ status: 500, body: {} }));
  await assert.rejects(
    storageFails.client.upload({ purpose: 'proof', ownerId: 'd1', source: photo() }),
    (e: unknown) => (e as ApiError).httpStatus === 500,
  );
  assert.equal(requestsTo(storageFails, 'POST', '/files/confirm').length, 0);

  const confirmFails = await withPresign({});
  confirmFails.server.on('POST', 'https://storage.test/bucket', () => ({ status: 204 }));
  confirmFails.server.on('POST', '/files/confirm', () => ({ status: 'failed-precondition', message: 'File missing.' }));
  await assert.rejects(
    confirmFails.client.upload({ purpose: 'proof', ownerId: 'd1', source: photo() }),
    (e: unknown) => (e as ApiError).status === 'failed-precondition',
  );
});
