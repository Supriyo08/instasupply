import { formatPhone as formatNanp, normalizePhone } from '@instasupply/shared';

import { requestPhoneCode } from '@/features/session/auth-service';

export interface CodeRequest {
  phone: string;
  /** Only returned by a development server (`EXPOSE_DEV_CODES`). */
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

/** The country chip beside the number: codes go to Canadian (NANP) numbers only (docs/CLIENTS.md §2.2). */
export const COUNTRY_CODE = '+1';

/** Validate the number typed next to the +1 chip. Returns E.164 or a message for the user. */
export function parsePhoneInput(
  raw: string,
): { phone: string; error?: undefined } | { phone?: undefined; error: string } {
  const value = raw.trim();
  if (!value) return { error: 'Enter your mobile number.' };
  const phone = normalizePhone(value);
  if (!phone) return { error: 'Enter a valid 10-digit Canadian number, like (416) 555-0110.' };
  return { phone };
}

/** "+14165550110" → "(416) 555-0110", for the field next to the +1 chip. */
export function toNationalInput(phone: string | null | undefined): string {
  if (!phone) return '';
  return normalizePhone(phone) ? formatNanp(phone) : phone;
}

/** "+14165550110" → "+1 (416) 555-0110". */
export function formatPhone(phone: string): string {
  return normalizePhone(phone) ? `${COUNTRY_CODE} ${formatNanp(phone)}` : phone;
}
