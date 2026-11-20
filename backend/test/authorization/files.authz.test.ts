import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  accountWithRole,
  createTestContext,
  get,
  insertStore,
  post,
  type SessionBody,
  type TestContext,
} from '../platform/context';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);
const DELIVERY = '0f1c2b8e-7d1a-4c3b-9a5e-1f2d3c4b5a70';

describe('the Storage rules of MARKETPLACE §6.4 (PLATFORM §10.1)', () => {
  let ctx: TestContext;
  let admin: SessionBody;
  let driver: SessionBody;
  let otherDriver: SessionBody;
  let customer: SessionBody;
  let otherCustomer: SessionBody;
  let ownerX: SessionBody;
  let staffX: SessionBody;
  let supplierY: SessionBody;

  before(async () => {
    ctx = await createTestContext();
    await insertStore(ctx, 'store-x');
    await insertStore(ctx, 'store-y');
    admin = await accountWithRole(ctx, 'admin@example.com', 'admin');
    driver = await accountWithRole(ctx, 'marco@example.com', 'driver');
    otherDriver = await accountWithRole(ctx, 'devon@example.com', 'driver');
    customer = await accountWithRole(ctx, 'dana@example.com', 'customer');
    otherCustomer = await accountWithRole(ctx, 'sam@example.com', 'customer');
    ownerX = await accountWithRole(ctx, 'ox@example.com', 'supplier', {
      storeId: 'store-x',
      storeRole: 'owner',
    });
    staffX = await accountWithRole(ctx, 'sx@example.com', 'supplier', {
      storeId: 'store-x',
      storeRole: 'staff',
    });
    supplierY = await accountWithRole(ctx, 'sy@example.com', 'supplier', {
      storeId: 'store-y',
      storeRole: 'owner',
    });
    // A manual delivery assigned to Marco for Dana (the deliveries workstream writes these through commands).
    await ctx.pool.query(
      `INSERT INTO deliveries (id, doc, meta, created_at, updated_at) VALUES ($1, $2::jsonb, $3::jsonb, now(), now())`,
      [
        DELIVERY,
        JSON.stringify({
          orderId: 'IS-10043',
          kind: 'manual',
          status: 'picked_up',
          driverId: driver.me.account.uid,
          customerId: customer.me.account.uid,
        }),
        JSON.stringify({ trackingToken: 'tok-files-authz' }),
      ],
    );
  });
  after(() => ctx.close());

  const presign = (
    token: string,
    purpose: string,
    ownerId: string,
    contentType = 'image/png',
    sizeBytes = PNG.length,
  ) => post(ctx, '/files/presign', { purpose, ownerId, fileName: 'f.png', contentType, sizeBytes }, token);

  async function uploadProof(): Promise<string> {
    const ticket = await presign(driver.accessToken, 'proof', DELIVERY);
    assert.equal(ticket.status, 200);
    const { uploadId, path } = ticket.body as { uploadId: string; path: string };
    await ctx.deps.storage.put(`uploads/${uploadId}`, PNG, 'image/png');
    assert.equal((await post(ctx, '/files/confirm', { uploadId }, driver.accessToken)).status, 200);
    return path;
  }

  test('proof: only the assigned active driver uploads', async () => {
    assert.equal((await presign(otherDriver.accessToken, 'proof', DELIVERY)).status, 403);
    assert.equal((await presign(customer.accessToken, 'proof', DELIVERY)).status, 403);
    assert.equal((await presign(admin.accessToken, 'proof', DELIVERY)).status, 403);
    assert.equal(
      (await presign(driver.accessToken, 'proof', '00000000-0000-4000-8000-000000000000')).status,
      404,
    );
  });

  test('proof: staff, the assigned driver and the delivery’s customer read; nobody else', async () => {
    const path = await uploadProof();
    const read = (token: string) => get(ctx, `/files/url?path=${encodeURIComponent(path)}`, token);
    assert.equal((await read(admin.accessToken)).status, 200);
    assert.equal((await read(driver.accessToken)).status, 200);
    assert.equal((await read(customer.accessToken)).status, 200);
    assert.equal((await read(otherCustomer.accessToken)).status, 403);
    assert.equal((await read(otherDriver.accessToken)).status, 403);
    assert.equal((await read(ownerX.accessToken)).status, 403);
    assert.equal((await ctx.app.inject({ method: 'GET', url: `/api/v1/media/${path}` })).statusCode, 404);
  });

  test('quote uploads: customers only, with the accepted types and size', async () => {
    const requestId = '6f1c2b8e-7d1a-4c3b-9a5e-1f2d3c4b5a69';
    assert.equal(
      (await presign(customer.accessToken, 'quote_upload', requestId, 'application/pdf', 1000)).status,
      200,
    );
    assert.equal(
      (await presign(customer.accessToken, 'quote_upload', requestId, 'text/csv', 1000)).status,
      200,
    );
    assert.equal(
      (await presign(customer.accessToken, 'quote_upload', requestId, 'application/zip', 1000)).status,
      400,
    );
    assert.equal(
      (await presign(customer.accessToken, 'quote_upload', requestId, 'application/pdf', 16 * 1024 * 1024))
        .status,
      400,
    );
    assert.equal((await presign(driver.accessToken, 'quote_upload', requestId)).status, 403);
  });

  test('issue photos: customer role only', async () => {
    const issueId = '7f1c2b8e-7d1a-4c3b-9a5e-1f2d3c4b5a71';
    assert.equal((await presign(customer.accessToken, 'issue_photo', issueId)).status, 200);
    assert.equal((await presign(ownerX.accessToken, 'issue_photo', issueId)).status, 403);
  });

  test('store photos: staff and the owner; product photos: staff and members of that store', async () => {
    assert.equal((await presign(ownerX.accessToken, 'store_photo', 'store-x')).status, 200);
    assert.equal((await presign(staffX.accessToken, 'store_photo', 'store-x')).status, 403);
    assert.equal((await presign(admin.accessToken, 'store_photo', 'store-x')).status, 200);
    assert.equal((await presign(staffX.accessToken, 'product_photo', 'store-x')).status, 200);
    assert.equal((await presign(supplierY.accessToken, 'product_photo', 'store-x')).status, 403);
    assert.equal((await presign(supplierY.accessToken, 'store_photo', 'store-x')).status, 403);
    assert.equal((await presign(customer.accessToken, 'product_photo', 'store-x')).status, 403);
  });

  test('confirm is the uploader’s only', async () => {
    const ticket = await presign(customer.accessToken, 'avatar', customer.me.account.uid);
    const { uploadId } = ticket.body as { uploadId: string };
    assert.equal((await post(ctx, '/files/confirm', { uploadId }, otherCustomer.accessToken)).status, 403);
  });
});
