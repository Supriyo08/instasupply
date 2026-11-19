/**
 * Typed runtime configuration. Values come from `.env.<project>` files or, for anything listed in
 * MANAGED_SECRETS, from Google Secret Manager. Both surface as `process.env` at runtime.
 */
import { DEFAULT_FUNCTIONS_REGION, normalizePhone } from '@instasupply/shared';
import { defineSecret } from 'firebase-functions/params';

const read = (name: string, fallback = ''): string => process.env[name]?.trim() || fallback;

export const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';

export const region = read('FUNCTIONS_REGION', DEFAULT_FUNCTIONS_REGION);

/** Secrets bound to every function so `process.env` exposes them at runtime. */
export const managedSecrets = read('MANAGED_SECRETS')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)
  .map((name) => defineSecret(name));

export type RoutingProviderSetting = 'auto' | 'google' | 'osrm' | 'estimate';
export type GeocoderSetting = 'auto' | 'google' | 'nominatim' | 'none';

const parseTestNumbers = (raw: string): Map<string, string> => {
  const map = new Map<string, string>();
  for (const entry of raw.split(',')) {
    const [phone, code] = entry.split(':').map((part) => part.trim());
    const normalized = normalizePhone(phone);
    if (normalized && code && /^\d{6}$/.test(code)) map.set(normalized, code);
  }
  return map;
};

/** Read lazily so secrets injected at runtime are always picked up. */
export const settings = {
  get googleMapsApiKey() {
    return read('GOOGLE_MAPS_API_KEY');
  },
  get routingProvider(): RoutingProviderSetting {
    const value = read('ROUTING_PROVIDER', 'auto');
    return (['auto', 'google', 'osrm', 'estimate'] as const).includes(value as RoutingProviderSetting)
      ? (value as RoutingProviderSetting)
      : 'auto';
  },
  get osrmUrl() {
    return read('OSRM_URL', 'https://router.project-osrm.org').replace(/\/$/, '');
  },
  get geocoder(): GeocoderSetting {
    const value = read('GEOCODER', 'auto');
    return (['auto', 'google', 'nominatim', 'none'] as const).includes(value as GeocoderSetting)
      ? (value as GeocoderSetting)
      : 'auto';
  },
  get twilio() {
    const accountSid = read('TWILIO_ACCOUNT_SID');
    const authToken = read('TWILIO_AUTH_TOKEN');
    const from = read('TWILIO_FROM');
    return accountSid && authToken && from ? { accountSid, authToken, from } : null;
  },
  get otpPepper() {
    const pepper = read('OTP_PEPPER');
    if (pepper) return pepper;
    if (isEmulator) return 'local-emulator-pepper';
    throw new Error('OTP_PEPPER is not configured.');
  },
  get otpTestNumbers() {
    return parseTestNumbers(read('OTP_TEST_NUMBERS'));
  },
  get trackingBaseUrl() {
    return read('TRACKING_BASE_URL', 'http://localhost:5173').replace(/\/$/, '');
  },
  get expoAccessToken() {
    return read('EXPO_ACCESS_TOKEN');
  },
  /**
   * Card payments. "test" simulates a successful charge (emulator default; never moves money).
   * "disabled" (production default) only allows cash on delivery until a real payment gateway is
   * integrated - see docs/DEPLOYMENT.md.
   */
  get paymentsMode(): 'test' | 'disabled' {
    const value = read('PAYMENTS_MODE', isEmulator ? 'test' : 'disabled');
    return value === 'test' ? 'test' : 'disabled';
  },
};

export const enforceAppCheck = read('ENFORCE_APP_CHECK') === 'true';
export const minInstances = Number(read('MIN_INSTANCES', '0')) || 0;
