/** GET /api/v1/config (docs/PLATFORM.md §11.2). Nothing secret may ever appear here. */
import type { PublicConfig } from '@instasupply/shared';
import type { Config } from './env';

export function publicConfig(config: Config, now: number): PublicConfig {
  return {
    environment: config.NODE_ENV === 'production' ? 'production' : 'development',
    paymentsMode: config.PAYMENTS_MODE,
    phoneVerification: config.PHONE_VERIFICATION,
    supportPhone: config.SUPPORT_PHONE,
    supportEmail: config.SUPPORT_EMAIL,
    hstNumber: config.HST_NUMBER,
    map: { tileUrl: config.MAP_TILE_URL, attribution: config.MAP_ATTRIBUTION, maxZoom: config.MAP_MAX_ZOOM },
    trackingBaseUrl: `${config.WEB_URL}/track`,
    smsDriver: config.SMS_DRIVER,
    emailDriver: config.EMAIL_DRIVER,
    allowTestJobs: config.ALLOW_TEST_JOBS,
    serverTime: now,
  };
}
