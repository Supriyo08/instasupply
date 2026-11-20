import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  accountWithRole,
  call,
  createTestContext,
  get,
  post,
  type ErrorBody,
  type SessionBody,
  type TestContext,
} from './context';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);

interface Presigned {
  uploadId: string;
  path: string;
  method: string;
  url: string;
  fields: Record<string, string>;
  headers: Record<string, string>;
}

function multipart(fields: Record<string, string>, file: Buffer, contentType: string) {
  const boundary = '----instasupply-test-boundary';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('files and storage (§10.1), local driver', () => {
  let ctx: TestContext;
  let user: SessionBody;
  before(async () => {
    ctx = await createTestContext();
    user = await accountWithRole(ctx, 'dana@example.com', 'customer');
  });
  after(() => ctx.close());

  const presign = (body: Record<string, unknown>, token = user.accessToken) =>
    post<Presigned & ErrorBody>(ctx, '/files/presign', body, token);
  const upload = (ticket: Presigned, file: Buffer, contentType: string) => {
    const form = multipart(ticket.fields, file, contentType);
    return ctx.app.inject({ method: 'POST', url: new URL(ticket.url).pathname, ...form });
  };

  test('presign → upload → confirm → media for an avatar; URLs carry the request origin', async () => {
    const uid = user.me.account.uid;
    const ticket = await call<Presigned>(ctx, {
      method: 'POST',
      url: '/api/v1/files/presign',
      token: user.accessToken,
      headers: { host: '192.168.1.20:4000' },
      payload: {
        purpose: 'avatar',
        ownerId: uid,
        fileName: 'me.png',
        contentType: 'image/png',
        sizeBytes: PNG.length,
      },
    });
    assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
    assert.equal(ticket.body.method, 'POST');
    assert.deepEqual(ticket.body.headers, {});
    assert.ok(ticket.body.url.startsWith('http://192.168.1.20:4000/api/v1/files/local/'));
    assert.match(ticket.body.path, new RegExp(`^avatars/${uid}/[0-9a-f-]{36}\\.png$`));
    assert.equal((await upload(ticket.body, PNG, 'image/png')).statusCode, 204);
    const confirmed = await post<{ path: string; name: string; sizeBytes: number }>(
      ctx,
      '/files/confirm',
      { uploadId: ticket.body.uploadId },
      user.accessToken,
    );
    assert.deepEqual(confirmed.body, {
      path: ticket.body.path,
      name: 'me.png',
      contentType: 'image/png',
      sizeBytes: PNG.length,
    });
    const again = await post(ctx, '/files/confirm', { uploadId: ticket.body.uploadId }, user.accessToken);
    assert.deepEqual(again.body, confirmed.body);
    const media = await ctx.app.inject({ method: 'GET', url: `/api/v1/media/${ticket.body.path}` });
    assert.equal(media.statusCode, 200);
    assert.equal(media.headers['cache-control'], 'public, max-age=3600');
    assert.ok(media.rawPayload.equals(PNG));
    // Re-posting the still-valid form only rewrites uploads/{id}, never the confirmed file.
    await upload(ticket.body, Buffer.concat([PNG, Buffer.from('changed')]), 'image/png');
    const still = await ctx.app.inject({ method: 'GET', url: `/api/v1/media/${ticket.body.path}` });
    assert.ok(still.rawPayload.equals(PNG));
  });

  test('a wrong magic number is refused and the object deleted; wrong type and size are refused', async () => {
    const uid = user.me.account.uid;
    const ticket = await presign({
      purpose: 'avatar',
      ownerId: uid,
      fileName: 'x.png',
      contentType: 'image/png',
      sizeBytes: 10,
    });
    await upload(ticket.body, Buffer.from('<svg onload=alert(1)>'), 'image/png');
    const refused = await post<ErrorBody>(
      ctx,
      '/files/confirm',
      { uploadId: ticket.body.uploadId },
      user.accessToken,
    );
    assert.equal(refused.status, 400);
    assert.equal(await ctx.deps.storage.head(`uploads/${ticket.body.uploadId}`), null);
    const svg = await presign({
      purpose: 'avatar',
      ownerId: uid,
      fileName: 'x.svg',
      contentType: 'image/svg+xml',
      sizeBytes: 10,
    });
    assert.equal(svg.status, 400);
    const huge = await presign({
      purpose: 'avatar',
      ownerId: uid,
      fileName: 'x.png',
      contentType: 'image/png',
      sizeBytes: 6 * 1024 * 1024,
    });
    assert.equal(huge.status, 400);
    const mismatch = await presign({
      purpose: 'avatar',
      ownerId: uid,
      fileName: 'x.png',
      contentType: 'image/png',
      sizeBytes: 10,
    });
    const wrongType = await upload(mismatch.body, PNG, 'image/jpeg');
    assert.equal(wrongType.statusCode, 400);
  });

  test('upload rules: another user’s avatar and a supplier-only purpose are refused', async () => {
    const other = await accountWithRole(ctx, 'sam@example.com', 'customer');
    const theirs = await presign({
      purpose: 'avatar',
      ownerId: other.me.account.uid,
      fileName: 'x.png',
      contentType: 'image/png',
      sizeBytes: 10,
    });
    assert.equal(theirs.status, 403);
    const store = await presign({
      purpose: 'store_photo',
      ownerId: 'kestrel-lumber',
      fileName: 'x.png',
      contentType: 'image/png',
      sizeBytes: 10,
    });
    assert.equal(store.status, 403);
  });

  test('the avatar cap of 5 per day', async () => {
    const capped = await accountWithRole(ctx, 'cap@example.com', 'customer');
    const body = {
      purpose: 'avatar',
      ownerId: capped.me.account.uid,
      fileName: 'x.png',
      contentType: 'image/png',
      sizeBytes: 10,
    };
    for (let i = 0; i < 5; i += 1) assert.equal((await presign(body, capped.accessToken)).status, 200);
    assert.equal((await presign(body, capped.accessToken)).status, 429);
  });

  test('media/* answers not-found, never 500, for a malformed or double-encoded path', async () => {
    for (const url of ['/api/v1/media/%E0%A4%A', '/api/v1/media/avatars/%2525', '/api/v1/media/%']) {
      const answer = await ctx.app.inject({ method: 'GET', url });
      assert.equal(answer.statusCode, 404, `${url} → ${answer.statusCode}`);
      assert.equal((JSON.parse(answer.body) as ErrorBody).error.status, 'not-found');
    }
  });

  test('private files: signed local URLs expire; media/* serves public purposes only', async () => {
    const requestId = '6f1c2b8e-7d1a-4c3b-9a5e-1f2d3c4b5a69';
    const ticket = await presign({
      purpose: 'quote_upload',
      ownerId: requestId,
      fileName: 'list.png',
      contentType: 'image/png',
      sizeBytes: PNG.length,
    });
    assert.equal(ticket.status, 200, JSON.stringify(ticket.body));
    await upload(ticket.body, PNG, 'image/png');
    await post(ctx, '/files/confirm', { uploadId: ticket.body.uploadId }, user.accessToken);
    assert.equal(
      (await ctx.app.inject({ method: 'GET', url: `/api/v1/media/${ticket.body.path}` })).statusCode,
      404,
    );
    const other = await accountWithRole(ctx, 'nosy@example.com', 'customer');
    const denied = await get<ErrorBody>(
      ctx,
      `/files/url?path=${encodeURIComponent(ticket.body.path)}`,
      other.accessToken,
    );
    assert.equal(denied.status, 403);
    const link = await get<{ url: string; expiresAt: number }>(
      ctx,
      `/files/url?path=${encodeURIComponent(ticket.body.path)}`,
      user.accessToken,
    );
    assert.equal(link.status, 200);
    const url = new URL(link.body.url);
    assert.equal((await ctx.app.inject({ method: 'GET', url: url.pathname + url.search })).statusCode, 200);
    ctx.clock.advance(301_000);
    assert.equal((await ctx.app.inject({ method: 'GET', url: url.pathname + url.search })).statusCode, 404);
  });
});
