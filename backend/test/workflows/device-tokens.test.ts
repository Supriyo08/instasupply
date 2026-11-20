/**
 * Push-token ownership (docs/PLATFORM.md §12.4, port of legacy/firebase/tests/device-tokens.test.ts): when one
 * phone signs into another account and the old sign-out never reached the server, registering the token takes
 * it away from the previous account (`onDeviceWritten` became the same statement). Other tokens stay put, and
 * re-registering the same token changes nothing else. Plus the request rules of `PUT /me/devices` (§5.3.3):
 * the installation must be the session's, `app` comes from the session, `provider` must be `expo`, unknown
 * keys are refused.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { signIn, type ActorClient } from '../support/actors';
import { createTestContext, type TestContext } from '../support/database';
import { createAccount, type Account } from '../support/fixtures';
import { expectError, expectOk, put } from '../support/http';
import { race } from '../support/race';

const run = randomBytes(4).toString('hex');
/** One app install each. Its installation id is the device row's key under whoever is signed in on it. */
const PHONE = `phone-${run}`;
const TABLET = `tablet-${run}`;
const PHONE_TOKEN = `ExponentPushToken[${run}-phone]`;
const TABLET_TOKEN = `ExponentPushToken[${run}-tablet]`;
const EXPIRED_TOKEN = `ExponentPushToken[${run}-expired]`;

const device = (token: string) => ({
  token,
  provider: 'expo',
  platform: 'ios',
  appVersion: '1.0.0',
  deviceName: 'Test phone',
});

interface DeviceRow {
  user_id: string;
  installation_id: string;
  token: string;
  app: string;
  last_seen_at: number;
  created_at: number;
}

describe('push token ownership', () => {
  let ctx: TestContext;
  let anna: Account;
  let ben: Account;
  let cara: Account;
  /** Sessions per account and install: the apps register the token of the install they are signed in on. */
  const sessions = new Map<string, ActorClient>();
  const on = async (account: Account, installationId: string): Promise<ActorClient> => {
    const key = `${account.uid}:${installationId}`;
    let actor = sessions.get(key);
    if (!actor) {
      actor = await signIn(ctx, account, { installationId, app: 'customer' });
      sessions.set(key, actor);
    }
    return actor;
  };
  const register = async (account: Account, installationId: string, token: string) =>
    expectOk((await on(account, installationId)).put(`/me/devices/${installationId}`, device(token)), 204);
  const rows = async (): Promise<DeviceRow[]> => {
    const { rows: found } = await ctx.pool.query<DeviceRow>(
      `SELECT user_id, installation_id, token, app, last_seen_at, created_at FROM devices
        ORDER BY user_id, installation_id`,
    );
    return found;
  };
  const registered = async (account: Account, installationId: string): Promise<DeviceRow | undefined> =>
    (await rows()).find((r) => r.user_id === account.uid && r.installation_id === installationId);

  before(async () => {
    ctx = await createTestContext();
    anna = await createAccount(ctx, { role: 'customer', displayName: 'Anna' });
    ben = await createAccount(ctx, { role: 'customer', displayName: 'Ben' });
    cara = await createAccount(ctx, { role: 'customer', displayName: 'Cara' });
  });
  after(() => ctx.close());

  test('moves a token to the account that registered it last', async () => {
    await register(anna, PHONE, PHONE_TOKEN);
    await register(anna, TABLET, TABLET_TOKEN);
    // Cara used this phone long ago; her registration still carries a token from back then.
    await register(cara, PHONE, EXPIRED_TOKEN);
    // Anna's sign-out never reached the server, then Ben signs in on her phone.
    await register(ben, PHONE, PHONE_TOKEN);

    assert.equal(await registered(anna, PHONE), undefined);
    assert.equal((await registered(ben, PHONE))?.token, PHONE_TOKEN);
  });

  test('leaves registrations with a different token alone', async () => {
    assert.ok(await registered(anna, TABLET), "Anna's other device keeps its own token");
    assert.equal((await registered(cara, PHONE))?.token, EXPIRED_TOKEN, 'same device id, different token');
    assert.ok(await registered(ben, PHONE), 'the new owner keeps the token');
  });

  test('re-registering the same token changes nothing else', async () => {
    const before = await rows();
    ctx.clock.advance(60_000);
    await register(ben, PHONE, PHONE_TOKEN);
    const after = await rows();
    assert.equal(after.length, before.length);
    const strip = (list: DeviceRow[]) => list.map(({ last_seen_at: _seen, ...rest }) => rest);
    assert.deepEqual(strip(after), strip(before));
    assert.equal((await registered(ben, PHONE))?.last_seen_at, ctx.clock.now(), 'only last_seen_at moves');
  });

  test('follows the phone when an existing registration takes over the token', async () => {
    // Cara signs in on the phone again: her old registration now reports the phone's current token.
    await register(cara, PHONE, PHONE_TOKEN);
    assert.equal(await registered(ben, PHONE), undefined);
    assert.equal((await registered(cara, PHONE))?.token, PHONE_TOKEN, 'no eviction loop');
    assert.ok(await registered(anna, TABLET));
    const owners = (await rows()).filter((r) => r.token === PHONE_TOKEN);
    assert.equal(owners.length, 1);
  });

  test('two accounts registering one token at once: exactly one keeps it, no error', async () => {
    let round = 0;
    await race({
      times: 10,
      setup: async () => {
        round += 1;
        const token = `ExponentPushToken[${run}-race-${round}]`;
        const installA = `race-a-${run}-${round}`;
        const installB = `race-b-${run}-${round}`;
        return { token, a: await on(anna, installA), b: await on(ben, installB), installA, installB };
      },
      run: (s) => [
        () => s.a.put(`/me/devices/${s.installA}`, device(s.token)),
        () => s.b.put(`/me/devices/${s.installB}`, device(s.token)),
      ],
      check: async (results, s) => {
        assert.deepEqual(
          results.map((r) => r.status),
          [204, 204],
        );
        const owners = (await rows()).filter((r) => r.token === s.token);
        assert.equal(owners.length, 1);
      },
    });
  });

  test('the request rules: own installation only, app from the session, expo only, strict body', async () => {
    const annaPhone = await on(anna, `rules-${run}`);
    await expectError(annaPhone.put(`/me/devices/${TABLET}`, device(TABLET_TOKEN)), 'permission-denied');
    await expectError(
      annaPhone.put(`/me/devices/rules-${run}`, { ...device(`ExponentPushToken[${run}-x]`), app: 'driver' }),
      'invalid-argument',
    );
    await expectError(
      annaPhone.put(`/me/devices/rules-${run}`, {
        ...device(`ExponentPushToken[${run}-x]`),
        provider: 'fcm',
      }),
      'invalid-argument',
    );
    await expectError(
      put(ctx, `/me/devices/rules-${run}`, device(`ExponentPushToken[${run}-x]`)),
      'unauthenticated',
    );

    const driverAccount = await createAccount(ctx, {
      role: 'driver',
      cityId: 'toronto',
      vehicle: { capacityClass: 'car' },
    });
    const driverPhone = await signIn(ctx, driverAccount, { installationId: `driver-${run}`, app: 'driver' });
    await expectOk(
      driverPhone.put(`/me/devices/driver-${run}`, device(`ExponentPushToken[${run}-driver]`)),
      204,
    );
    assert.equal((await registered(driverAccount, `driver-${run}`))?.app, 'driver');

    await expectOk(driverPhone.del(`/me/devices/driver-${run}`), 204);
    assert.equal(await registered(driverAccount, `driver-${run}`), undefined);
  });
});
