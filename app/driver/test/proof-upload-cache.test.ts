/** A retried Complete reuses the uploaded proof photo instead of uploading it again. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createProofUploadCache } from '../src/features/deliveries/proof-upload-cache';

function counter() {
  const calls: string[] = [];
  const upload = async (deliveryId: string, uri: string) => {
    calls.push(`${deliveryId}:${uri}`);
    return `proofs/${deliveryId}/${calls.length}.jpg`;
  };
  return { calls, upload };
}

describe('proof upload cache', () => {
  it('uploads a photo once however often Complete is retried', async () => {
    const { calls, upload } = counter();
    const cache = createProofUploadCache(upload);
    const first = await cache.pathFor('d1', 'file:///a.jpg');
    for (let i = 0; i < 5; i += 1) assert.equal(await cache.pathFor('d1', 'file:///a.jpg'), first);
    assert.equal(calls.length, 1);
  });

  it('uploads again for a new photo, another delivery, or after forget', async () => {
    const { calls, upload } = counter();
    const cache = createProofUploadCache(upload);
    await cache.pathFor('d1', 'file:///a.jpg');
    await cache.pathFor('d1', 'file:///b.jpg');
    await cache.pathFor('d2', 'file:///b.jpg');
    cache.forget('d1');
    await cache.pathFor('d1', 'file:///b.jpg');
    assert.equal(calls.length, 4);
  });

  it('shares one upload between concurrent calls', async () => {
    const { calls, upload } = counter();
    const cache = createProofUploadCache(upload);
    const [a, b] = await Promise.all([cache.pathFor('d1', 'u'), cache.pathFor('d1', 'u')]);
    assert.equal(a, b);
    assert.equal(calls.length, 1);
  });

  it('does not keep a failed upload', async () => {
    let fail = true;
    let uploads = 0;
    const cache = createProofUploadCache(async () => {
      uploads += 1;
      if (fail) throw new Error('offline');
      return 'proofs/d1/ok.jpg';
    });
    await assert.rejects(cache.pathFor('d1', 'u'), /offline/);
    fail = false;
    assert.equal(await cache.pathFor('d1', 'u'), 'proofs/d1/ok.jpg');
    assert.equal(uploads, 2);
  });
});
