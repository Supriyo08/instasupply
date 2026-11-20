import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, before, describe, test } from 'node:test';
import {
  accountWithRole,
  command,
  createTestContext,
  get,
  insertStore,
  post,
  type ErrorBody,
  type SessionBody,
  type TestContext,
} from '../platform/context';
import { migrationsDir } from '../../src/platform/paths';

const run = promisify(execFile);
const tokenOf = (link: string): string => new URL(link).hash.replace(/^#token=/, '');

describe('invites and set-password links (§6.3.8)', () => {
  let ctx: TestContext;
  let admin: SessionBody;
  before(async () => {
    ctx = await createTestContext();
    admin = await accountWithRole(ctx, 'admin@example.com', 'admin');
    await insertStore(ctx, 'kestrel-lumber');
    await insertStore(ctx, 'bluestone-supply');
  });
  after(() => ctx.close());

  test('createStaffUser: the link carries the token in the fragment; a repeat reuses the account', async () => {
    const first = await command<{ uid: string; passwordSetupLink: string }>(
      ctx,
      'createStaffUser',
      { email: 'Disp@Example.com', displayName: 'Dispatch One', role: 'dispatcher' },
      admin.accessToken,
    );
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const link = new URL(first.body.passwordSetupLink);
    assert.equal(link.origin + link.pathname, 'http://localhost:5173/set-password');
    assert.equal(link.search, '');
    assert.match(link.hash, /^#token=isp_/);
    const repeat = await command<{ uid: string; passwordSetupLink: string }>(
      ctx,
      'createStaffUser',
      { email: 'disp@example.com', displayName: 'Dispatch One', role: 'dispatcher' },
      admin.accessToken,
    );
    assert.equal(repeat.body.uid, first.body.uid);
    // Only the newest link works.
    const old = await post<ErrorBody>(ctx, '/auth/invites/inspect', {
      token: tokenOf(first.body.passwordSetupLink),
    });
    assert.equal(old.status, 404);
    const fresh = await post<{ email: string; role: string }>(ctx, '/auth/invites/inspect', {
      token: tokenOf(repeat.body.passwordSetupLink),
    });
    assert.deepEqual([fresh.body.email, fresh.body.role], ['disp@example.com', 'dispatcher']);
  });

  test('password/setup works once and signs the user in', async () => {
    const invite = await command<{ passwordSetupLink: string }>(
      ctx,
      'createStaffUser',
      { email: 'setup@example.com', displayName: 'Setup', role: 'dispatcher' },
      admin.accessToken,
    );
    const token = tokenOf(invite.body.passwordSetupLink);
    const body = { token, password: 'Dispatch2026', installationId: 'console-browser-1', app: 'console' };
    const ok = await post<SessionBody>(ctx, '/auth/password/setup', body);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.me.profile?.role, 'dispatcher');
    assert.equal((await get(ctx, '/me', ok.body.accessToken)).status, 200);
    const twice = await post<ErrorBody>(ctx, '/auth/password/setup', body);
    assert.equal(twice.status, 404);
    // An invited account with a password is no longer reusable by a new invite.
    const reinvite = await command<ErrorBody>(
      ctx,
      'createStaffUser',
      { email: 'setup@example.com', displayName: 'Setup', role: 'dispatcher' },
      admin.accessToken,
    );
    assert.equal(reinvite.status, 409);
  });

  test('an expired link is not-found', async () => {
    const invite = await command<{ passwordSetupLink: string }>(
      ctx,
      'createStaffUser',
      { email: 'late@example.com', displayName: 'Late', role: 'admin' },
      admin.accessToken,
    );
    const start = ctx.clock.now();
    ctx.clock.advance(73 * 3_600_000);
    const answer = await post(ctx, '/auth/invites/inspect', {
      token: tokenOf(invite.body.passwordSetupLink),
    });
    assert.equal(answer.status, 404);
    // Back to the start, so the other tests' access tokens are still fresh.
    ctx.clock.set(start);
  });

  test('createStaffUser is admin-only; the invite mail is a sensitive outbox row', async () => {
    const dispatcher = await accountWithRole(ctx, 'd2@example.com', 'dispatcher');
    const denied = await command<ErrorBody>(
      ctx,
      'createStaffUser',
      { email: 'x@example.com', displayName: 'X', role: 'admin' },
      dispatcher.accessToken,
    );
    assert.equal(denied.status, 403);
    await ctx.drainOutbox();
    const { rows } = await ctx.pool.query<{ sensitive: boolean; purpose: string }>(
      `SELECT sensitive, purpose FROM dev_outbox WHERE to_address = 'setup@example.com'`,
    );
    assert.ok(rows.length > 0);
    assert.ok(rows.every((row) => row.sensitive && row.purpose === 'invite'));
  });

  test('inviteSupplierUser: an owner may invite staff of their own store only', async () => {
    const owner = await accountWithRole(ctx, 'owner@example.com', 'supplier', {
      storeId: 'kestrel-lumber',
      storeRole: 'owner',
    });
    const ok = await command(
      ctx,
      'inviteSupplierUser',
      { storeId: 'kestrel-lumber', email: 'yard@example.com', displayName: 'Yard', storeRole: 'staff' },
      owner.accessToken,
    );
    assert.equal(ok.status, 200);
    const ownerRole = await command<ErrorBody>(
      ctx,
      'inviteSupplierUser',
      { storeId: 'kestrel-lumber', email: 'co@example.com', displayName: 'Co', storeRole: 'owner' },
      owner.accessToken,
    );
    assert.equal(ownerRole.status, 403);
    const otherStore = await command<ErrorBody>(
      ctx,
      'inviteSupplierUser',
      { storeId: 'bluestone-supply', email: 'b@example.com', displayName: 'B', storeRole: 'staff' },
      owner.accessToken,
    );
    assert.equal(otherStore.status, 403);
    const staffAny = await command(
      ctx,
      'inviteSupplierUser',
      { storeId: 'bluestone-supply', email: 'bo@example.com', displayName: 'Bo', storeRole: 'owner' },
      admin.accessToken,
    );
    assert.equal(staffAny.status, 200);
  });

  test('the create-admin command prints a #token= link and is repeatable', async () => {
    const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: ctx.databaseUrl, LOG_LEVEL: 'silent' };
    const args = [
      '--import',
      'tsx',
      '--import',
      './src/platform/dev/register.mjs',
      'src/cli.ts',
      'create-admin',
    ];
    const cwd = fileURLToPath(new URL('../..', import.meta.url));
    const first = await run(
      process.execPath,
      [...args, '--email', 'root@example.com', '--name', 'Root Admin'],
      { env, cwd },
    );
    assert.match(first.stdout, /\/set-password#token=isp_/);
    const second = await run(
      process.execPath,
      [...args, '--email', 'root@example.com', '--name', 'Root Admin'],
      { env, cwd },
    );
    assert.match(second.stdout, /#token=isp_/);
    const { rows } = await ctx.pool.query(`SELECT role FROM users WHERE email = 'root@example.com'`);
    assert.deepEqual(rows, [{ role: 'admin' }]);
    // Recovery of an admin who has a password and signed-in devices: the devices are signed out.
    const recovering = await accountWithRole(ctx, 'recover@example.com', 'admin');
    assert.equal((await get(ctx, '/me', recovering.accessToken)).status, 200);
    const recovered = await run(
      process.execPath,
      [...args, '--email', 'recover@example.com', '--name', 'Recovering Admin'],
      { env, cwd },
    );
    assert.match(recovered.stdout, /#token=isp_/);
    assert.equal((await get(ctx, '/me', recovering.accessToken)).status, 401);
    assert.ok(migrationsDir());
  });
});
