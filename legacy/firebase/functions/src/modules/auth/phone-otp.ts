/**
 * Phone verification with one-time codes.
 *
 * Codes are 6 digits, stored only as an HMAC (keyed with OTP_PEPPER), expire after 5 minutes,
 * allow 5 attempts, have a 30-second resend cooldown and an hourly send cap. On success the
 * verified number is written to the Auth user and the profile.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import {
  APP_NAME,
  COLLECTIONS,
  normalizePhone,
  type RequestPhoneOtpRequest,
  type RequestPhoneOtpResponse,
  type VerifyPhoneOtpRequest,
  type VerifyPhoneOtpResponse,
} from '@instasupply/shared';
import type { Timestamp as AdminTimestamp } from 'firebase-admin/firestore';

import { isEmulator, settings } from '../../config/runtime';
import { auth, db, serverTimestamp, Timestamp } from '../../lib/admin';
import { errorCode, fail, failedPrecondition, invalidArgument } from '../../lib/errors';
import { callable } from '../../lib/functions';
import { requireAuth } from '../../lib/guards';
import { userRef } from '../../lib/users';
import { sendSms } from '../sms/sms';

const CODE_TTL_SECONDS = 5 * 60;
const RESEND_COOLDOWN_SECONDS = 30;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;

interface OtpChallenge {
  phoneNumber: string;
  codeHash: string;
  attempts: number;
  expiresAt: AdminTimestamp;
  lastSentAt: AdminTimestamp;
  windowStartedAt: AdminTimestamp;
  sendCount: number;
}

const challengeRef = (uid: string) => db.collection(COLLECTIONS.otpChallenges).doc(uid);

const hashCode = (uid: string, phoneNumber: string, code: string) =>
  createHmac('sha256', settings.otpPepper).update(`${uid}:${phoneNumber}:${code}`).digest('hex');

async function assertNumberAvailable(uid: string, phoneNumber: string) {
  try {
    const owner = await auth.getUserByPhoneNumber(phoneNumber);
    if (owner.uid !== uid) fail('already-exists', 'This mobile number is already linked to another account.');
  } catch (error) {
    if (errorCode(error) !== 'auth/user-not-found') throw error;
  }
}

export const requestPhoneOtp = callable<RequestPhoneOtpRequest, RequestPhoneOtpResponse>(
  'requestPhoneOtp',
  async (request) => {
    const actor = requireAuth(request);
    const phoneNumber = normalizePhone(request.data?.phoneNumber);
    if (!phoneNumber) invalidArgument('Enter a valid mobile number, including the country code.');

    const profile = await userRef(actor.uid).get();
    if (!profile.exists) failedPrecondition('Finish creating your profile first.');
    await assertNumberAvailable(actor.uid, phoneNumber);

    const testCode = settings.otpTestNumbers.get(phoneNumber);
    const code = testCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    const now = Date.now();

    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(challengeRef(actor.uid));
      const current = snapshot.exists ? (snapshot.data() as OtpChallenge) : null;

      if (current) {
        const sinceLast = (now - current.lastSentAt.toMillis()) / 1000;
        if (sinceLast < RESEND_COOLDOWN_SECONDS) {
          fail(
            'resource-exhausted',
            `Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - sinceLast)} seconds before requesting another code.`,
          );
        }
      }
      let sendCount = 1;
      let windowStartedAt = Timestamp.fromMillis(now);
      if (current && now - current.windowStartedAt.toMillis() < 60 * 60 * 1000) {
        sendCount = current.sendCount + 1;
        windowStartedAt = current.windowStartedAt;
      }
      if (sendCount > MAX_SENDS_PER_HOUR) {
        fail('resource-exhausted', 'Too many codes requested. Please try again in an hour.');
      }

      tx.set(challengeRef(actor.uid), {
        phoneNumber,
        codeHash: hashCode(actor.uid, phoneNumber, code),
        attempts: 0,
        expiresAt: Timestamp.fromMillis(now + CODE_TTL_SECONDS * 1000),
        lastSentAt: Timestamp.fromMillis(now),
        windowStartedAt,
        sendCount,
      });
    });

    if (!testCode) {
      await sendSms({
        to: phoneNumber,
        purpose: 'otp',
        body: `${code} is your ${APP_NAME} verification code. It expires in 5 minutes. Never share it.`,
      });
    }

    return {
      phoneNumber,
      expiresInSeconds: CODE_TTL_SECONDS,
      resendInSeconds: RESEND_COOLDOWN_SECONDS,
      ...(isEmulator ? { devCode: code } : {}),
    };
  },
);

export const verifyPhoneOtp = callable<VerifyPhoneOtpRequest, VerifyPhoneOtpResponse>(
  'verifyPhoneOtp',
  async (request) => {
    const actor = requireAuth(request);
    const code = String(request.data?.code ?? '').replace(/\D/g, '');
    if (code.length !== 6) invalidArgument('Enter the 6-digit code.');

    const result = await db.runTransaction(async (tx) => {
      const ref = challengeRef(actor.uid);
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return { outcome: 'missing' as const };
      const challenge = snapshot.data() as OtpChallenge;
      if (challenge.expiresAt.toMillis() < Date.now()) return { outcome: 'expired' as const };
      if (challenge.attempts >= MAX_ATTEMPTS) return { outcome: 'locked' as const };

      const expected = Buffer.from(challenge.codeHash, 'hex');
      const actual = Buffer.from(hashCode(actor.uid, challenge.phoneNumber, code), 'hex');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        // Count the failed attempt (the transaction must commit, so we return instead of throwing).
        tx.update(ref, { attempts: challenge.attempts + 1 });
        return { outcome: 'wrong' as const, remaining: MAX_ATTEMPTS - challenge.attempts - 1 };
      }
      tx.delete(ref);
      return { outcome: 'ok' as const, phoneNumber: challenge.phoneNumber };
    });

    switch (result.outcome) {
      case 'missing':
        return failedPrecondition('Request a verification code first.');
      case 'expired':
        return fail('deadline-exceeded', 'This code has expired. Request a new one.');
      case 'locked':
        return fail('resource-exhausted', 'Too many incorrect attempts. Request a new code.');
      case 'wrong':
        return invalidArgument(
          result.remaining > 0
            ? `That code is incorrect. ${result.remaining} attempt${result.remaining === 1 ? '' : 's'} left.`
            : 'That code is incorrect. Request a new code.',
        );
      case 'ok':
        break;
    }

    try {
      await auth.updateUser(actor.uid, { phoneNumber: result.phoneNumber });
    } catch (error) {
      if (errorCode(error) === 'auth/phone-number-already-exists') {
        fail('already-exists', 'This mobile number is already linked to another account.');
      }
      throw error;
    }
    await userRef(actor.uid).update({
      phoneNumber: result.phoneNumber,
      phoneVerified: true,
      updatedAt: serverTimestamp(),
    });
    return { phoneNumber: result.phoneNumber };
  },
);
