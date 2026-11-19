import { DEFAULT_COUNTRY_CODE, normalizePhone } from '@instasupply/shared';

import { requestPhoneCode } from '@/features/session/auth-service';

export interface CodeRequest {
  phone: string;
  /** Only returned by the local emulator. */
  devCode: string | null;
  sentAt: number;
  resendInSeconds: number;
}

let lastRequest: CodeRequest | null = null;

/** Text a verification code and remember when, so the resend countdown survives navigation. */
export async function sendPhoneCode(phone: string): Promise<CodeRequest> {
  const result = await requestPhoneCode(phone);
  lastRequest = {
    phone: result.phoneNumber,
    devCode: result.devCode ?? null,
    sentAt: Date.now(),
    resendInSeconds: result.resendInSeconds,
  };
  return lastRequest;
}

/** The code sent to `phone` that is still inside its resend cooldown, if any. */
export function pendingCodeRequest(phone: string | null): CodeRequest | null {
  if (!lastRequest || !phone || lastRequest.phone !== phone) return null;
  return Date.now() < resendAt(lastRequest) ? lastRequest : null;
}

export const resendAt = (request: CodeRequest) => request.sentAt + request.resendInSeconds * 1000;

/** The backend's resend cooldown, assumed when this session has no record of the last send. */
const DEFAULT_RESEND_SECONDS = 30;

/** When another code may be requested for `phone` (epoch ms). Assumes a fresh code after a reload. */
export function nextResendAt(phone: string | null): number {
  if (!phone) return 0;
  if (lastRequest?.phone === phone) return resendAt(lastRequest);
  return Date.now() + DEFAULT_RESEND_SECONDS * 1000;
}

export function forgetCodeRequest() {
  lastRequest = null;
}

const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/** Validate the number typed next to the +91 chip. Returns E.164 or a message for the user. */
export function parsePhoneInput(
  raw: string,
): { phone: string; error?: undefined } | { phone?: undefined; error: string } {
  const value = raw.trim();
  if (!value) return { error: 'Enter your mobile number.' };
  // People often type the country code without "+" ("91 98765 43210").
  const digits = value.replace(/[^\d+]/g, '');
  const candidate = /^91[6-9]\d{9}$/.test(digits) ? `+${digits}` : value;
  const phone = normalizePhone(candidate);
  if (!phone) return { error: 'Enter a valid mobile number.' };
  if (
    phone.startsWith(DEFAULT_COUNTRY_CODE) &&
    !INDIAN_MOBILE.test(phone.slice(DEFAULT_COUNTRY_CODE.length))
  ) {
    return { error: 'Enter a valid 10-digit mobile number.' };
  }
  return { phone };
}

/** "+919876543210" → "98765 43210", for the field next to the +91 chip. */
export function toNationalInput(phone: string | null | undefined): string {
  if (!phone) return '';
  if (!phone.startsWith(DEFAULT_COUNTRY_CODE)) return phone;
  const national = phone.slice(DEFAULT_COUNTRY_CODE.length);
  return national.length === 10 ? `${national.slice(0, 5)} ${national.slice(5)}` : national;
}

/** "+919876543210" → "+91 98765 43210". */
export function formatPhone(phone: string): string {
  const national = toNationalInput(phone);
  return phone.startsWith(DEFAULT_COUNTRY_CODE) ? `${DEFAULT_COUNTRY_CODE} ${national}` : phone;
}
