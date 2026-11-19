/**
 * Push-token ownership against the emulators: when one phone signs into another account and the
 * old sign-out never reached the server, `onDeviceWritten` takes the token away from the previous
 * account. Other tokens stay put and refreshing a registration changes nothing. Run-scoped users,
 * cleaned up afterwards.
 */
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

import { PROJECT_ID, sleep } from '../../scripts/lib/emulator';

const RUN = `dt${Date.now().toString(36)}`;
const app = getApps()[0] ?? initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(app);

const users = { anna: `${RUN}-anna`, ben: `${RUN}-ben`, cara: `${RUN}-cara` };
/** One app install. Its installation id names the device document under whoever is signed in. */
const PHONE = `${RUN}-phone`;
const TABLET = `${RUN}-tablet`;
const PHONE_TOKEN = `ExponentPushToken[${RUN}-phone]`;
const TABLET_TOKEN = `ExponentPushToken[${RUN}-tablet]`;
const EXPIRED_TOKEN = `ExponentPushToken[${RUN}-expired]`;

const device = (who: keyof typeof users, deviceId: string) =>
  db.doc(`users/${users[who]}/devices/${deviceId}`);
const registered = async (who: keyof typeof users, deviceId: string) =>
  (await device(who, deviceId).get()).exists;

/** The write the apps make when they register for push (and repeat on every launch). */
const register = (who: keyof typeof users, deviceId: string, token: string) =>
  device(who, deviceId).set(
    {
      token,
      provider: 'expo',
      platform: 'ios',
      appVersion: '1.0.0',
      deviceName: 'Test phone',
      createdAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

async function eventually<T>(
  check: () => Promise<T | null | undefined | false>,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting for a background trigger.');
    await sleep(300);
  }
}

/** Long enough for a trigger that should change nothing to have run. */
const settle = () => sleep(2500);

after(async () => {
  for (const uid of Object.values(users)) await db.recursiveDelete(db.doc(`users/${uid}`));
});

describe('push token ownership', () => {
  it('moves a token to the account that registered it last', async () => {
    await register('anna', PHONE, PHONE_TOKEN);
    await register('anna', TABLET, TABLET_TOKEN);
    // Cara used this phone long ago; her registration still carries a token from back then.
    await register('cara', PHONE, EXPIRED_TOKEN);
    // Anna's sign-out never reached the server, then Ben signs in on her phone.
    await register('ben', PHONE, PHONE_TOKEN);

    await eventually(async () => !(await registered('anna', PHONE)));
    assert.equal((await device('ben', PHONE).get()).get('token'), PHONE_TOKEN);
  });

  it('leaves registrations with a different token alone', async () => {
    await settle();
    assert.ok(await registered('anna', TABLET), "Anna's other device keeps its own token");
    assert.ok(await registered('cara', PHONE), 'same device id, different token');
    assert.ok(await registered('ben', PHONE), 'the new owner keeps the token');
  });

  it('does not act again when the same registration is rewritten', async () => {
    const refresh = await register('ben', PHONE, PHONE_TOKEN);
    await settle();
    const current = await device('ben', PHONE).get();
    assert.ok(current.updateTime?.isEqual(refresh.writeTime), 'nothing wrote to it after the refresh');
    assert.ok(await registered('anna', TABLET));
    assert.ok(await registered('cara', PHONE));
  });

  it('follows the phone when an existing registration takes over the token', async () => {
    // Cara signs in on the phone again: her old registration now reports the phone's current token.
    await register('cara', PHONE, PHONE_TOKEN);

    await eventually(async () => !(await registered('ben', PHONE)));
    await settle();
    assert.equal((await device('cara', PHONE).get()).get('token'), PHONE_TOKEN, 'no eviction loop');
    assert.ok(await registered('anna', TABLET));
  });
});
