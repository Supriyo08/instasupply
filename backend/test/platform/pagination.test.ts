import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ApiError } from '../../src/platform/http/errors';
import { decodeCursor, encodeCursor, readPage } from '../../src/platform/http/pagination';
import { accountWithRole, createTestContext, get, type ErrorBody, type TestContext } from './context';

describe('keyset pagination (§4.4)', () => {
  test('cursors round-trip and garbage is invalid-argument', () => {
    assert.deepEqual(decodeCursor(encodeCursor(1795109100000, 'abc')), [1795109100000, 'abc']);
    assert.throws(
      () => decodeCursor('%%%'),
      (error) => error instanceof ApiError && error.status === 'invalid-argument',
    );
    assert.throws(() => decodeCursor(Buffer.from('[1,2]').toString('base64url')), ApiError);
  });

  test('readPage reads limit + 1 rows to decide on a next page', () => {
    const rows = [1, 2, 3].map((n) => ({ id: `id${n}`, at: n }));
    const page = readPage(
      rows,
      2,
      (row) => row.id,
      (row) => [row.at, row.id],
    );
    assert.deepEqual(page.items, ['id1', 'id2']);
    assert.deepEqual(decodeCursor(page.nextCursor!), [2, 'id2']);
    assert.equal(
      readPage(
        rows,
        3,
        (row) => row.id,
        (row) => [row.at, row.id],
      ).nextCursor,
      null,
    );
  });

  describe('GET /users pages', () => {
    let ctx: TestContext;
    let token: string;
    before(async () => {
      ctx = await createTestContext();
      token = (await accountWithRole(ctx, 'admin@example.com', 'admin')).accessToken;
      for (let i = 0; i < 7; i += 1) {
        ctx.clock.advance(1000);
        await accountWithRole(ctx, `c${i}@example.com`, 'customer');
      }
    });
    after(() => ctx.close());

    test('pages neither skip nor repeat while rows are inserted', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      let inserted = false;
      do {
        const url: string = `/users?role=customer&limit=3${cursor ? `&cursor=${cursor}` : ''}`;
        const page = await get<{ items: { uid: string }[]; nextCursor: string | null }>(ctx, url, token);
        assert.equal(page.status, 200);
        seen.push(...page.body.items.map((item) => item.uid));
        cursor = page.body.nextCursor;
        if (!inserted) {
          // A newer row appears between pages; newest-first pagination must not repeat or skip older rows.
          ctx.clock.advance(1000);
          await accountWithRole(ctx, 'late@example.com', 'customer');
          inserted = true;
        }
      } while (cursor);
      assert.equal(seen.length, 7);
      assert.equal(new Set(seen).size, 7);
    });

    test('limit bounds and a bad cursor', async () => {
      assert.equal((await get<ErrorBody>(ctx, '/users?limit=0', token)).status, 400);
      assert.equal((await get<ErrorBody>(ctx, '/users?limit=501', token)).status, 400);
      assert.equal((await get<ErrorBody>(ctx, '/users?cursor=zzz', token)).status, 400);
    });
  });
});
