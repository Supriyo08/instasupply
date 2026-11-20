import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  ConfigError,
  DEV_JWT_SECRET,
  DEV_OTP_PEPPER,
  developmentDefaults,
  loadConfig,
} from '../../src/config/env';
import { createTestContext, get, type TestContext } from './context';

const SECRET = 'p'.repeat(48);
const PRODUCTION = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://db.internal:5432/railway',
  JWT_SECRET: SECRET,
  OTP_PEPPER: 'q'.repeat(48),
  WEB_URL: 'https://console.instasupply.ca',
  CORS_ORIGINS: 'https://console.instasupply.ca',
  RAILWAY_PUBLIC_DOMAIN: 'api.up.railway.app',
  S3_ENDPOINT: 'https://storage.railway.app',
  S3_REGION: 'auto',
  S3_BUCKET: 'bucket',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
};

const refuses = (env: Record<string, string>, pattern: RegExp) =>
  assert.throws(
    () => loadConfig(env),
    (error) => error instanceof ConfigError && pattern.test(error.message),
  );

describe('configuration (§11)', () => {
  test('development defaults load without any variable', () => {
    const config = loadConfig({});
    assert.equal(config.NODE_ENV, 'development');
    assert.equal(config.PORT, 4000);
    assert.equal(config.DATABASE_URL, 'postgres://localhost:5432/instasupply_dev');
    assert.equal(config.PHONE_VERIFICATION, 'required');
    assert.equal(config.OTP_TEST_NUMBERS.get('+14165550199'), '123456');
    assert.ok(config.STORAGE_LOCAL_DIR.endsWith('backend/.data/files'));
    assert.equal(Object.keys(developmentDefaults()).length > 60, true);
  });

  test('a safe production configuration loads with production defaults', () => {
    const config = loadConfig(PRODUCTION);
    assert.equal(config.PAYMENTS_MODE, 'disabled');
    assert.equal(config.PHONE_VERIFICATION, 'optional');
    assert.equal(config.TRUST_PROXY, true);
    assert.equal(config.MIGRATE_ON_START, false);
    assert.equal(config.ALLOW_TEST_JOBS, false);
    assert.equal(config.STORAGE_DRIVER, 's3');
    assert.equal(config.OTP_TEST_NUMBERS.size, 0);
    assert.equal(config.HST_NUMBER, null);
  });

  test('every production refusal of §11.1', () => {
    refuses({ ...PRODUCTION, JWT_SECRET: 'short' }, /JWT_SECRET must be at least 32/);
    refuses({ ...PRODUCTION, JWT_SECRET: DEV_JWT_SECRET }, /development default/);
    refuses({ ...PRODUCTION, OTP_PEPPER: DEV_OTP_PEPPER }, /development default/);
    refuses({ ...PRODUCTION, EXPOSE_DEV_CODES: 'true' }, /EXPOSE_DEV_CODES/);
    refuses({ ...PRODUCTION, RATE_LIMITS_DISABLED: 'true' }, /RATE_LIMITS_DISABLED/);
    refuses({ ...PRODUCTION, DATABASE_AUTO_CREATE: 'true' }, /DATABASE_AUTO_CREATE/);
    refuses({ ...PRODUCTION, STORAGE_DRIVER: 'local' }, /STORAGE_DRIVER=local/);
    refuses({ ...PRODUCTION, CORS_ORIGINS: '' }, /CORS_ORIGINS must list/);
    refuses({ ...PRODUCTION, CORS_ORIGINS: '*' }, /may not contain \*/);
    refuses({ ...PRODUCTION, PHONE_VERIFICATION: 'required' }, /PHONE_VERIFICATION=required/);
    refuses({ ...PRODUCTION, PAYMENTS_MODE: 'stripe' }, /stripe/);
    const { RAILWAY_PUBLIC_DOMAIN: _domain, ...noOrigin } = PRODUCTION;
    refuses(noOrigin, /API_URL/);
    refuses({ ...PRODUCTION, SMS_DRIVER: 'twilio' }, /TWILIO_ACCOUNT_SID/);
    refuses({ ...PRODUCTION, EMAIL_DRIVER: 'resend' }, /RESEND_API_KEY/);
    refuses({ ...PRODUCTION, EMAIL_DRIVER: 'smtp' }, /SMTP_URL/);
    refuses({ ...PRODUCTION, S3_BUCKET: '' }, /STORAGE_DRIVER=s3 needs/);
    refuses({ ...PRODUCTION, PORT: 'eighty' }, /PORT/);
    refuses({ ...PRODUCTION, JWT_SECRET_PREVIOUS: 'short' }, /JWT_SECRET_PREVIOUS must be at least 32/);
    refuses(
      { ...PRODUCTION, JWT_SECRET_PREVIOUS: DEV_JWT_SECRET },
      /JWT_SECRET_PREVIOUS is a development default/,
    );
    refuses(
      { ...PRODUCTION, JWT_SECRET_PREVIOUS: DEV_OTP_PEPPER },
      /JWT_SECRET_PREVIOUS is a development default/,
    );
    refuses({ ...PRODUCTION, JWT_SECRET_PREVIOUS: SECRET }, /JWT_SECRET_PREVIOUS must differ/);
    assert.equal(
      loadConfig({ ...PRODUCTION, JWT_SECRET_PREVIOUS: 'r'.repeat(48) }).JWT_SECRET_PREVIOUS,
      'r'.repeat(48),
    );
  });

  test('production warns, but starts, on ALLOW_TEST_JOBS and OTP_TEST_NUMBERS', () => {
    const config = loadConfig({
      ...PRODUCTION,
      ALLOW_TEST_JOBS: 'true',
      OTP_TEST_NUMBERS: '+14165550199:123456',
    });
    assert.equal(config.warnings.length, 2);
  });

  describe('GET /config', () => {
    let ctx: TestContext;
    before(async () => {
      ctx = await createTestContext();
    });
    after(() => ctx.close());

    test('contains no secret', async () => {
      const answer = await get(ctx, '/config');
      assert.equal(answer.status, 200);
      const text = JSON.stringify(answer.body);
      for (const secret of [ctx.config.JWT_SECRET, ctx.config.OTP_PEPPER, ctx.config.DATABASE_URL]) {
        assert.ok(!text.includes(secret));
      }
      assert.equal(
        (answer.body as { trackingBaseUrl: string }).trackingBaseUrl,
        'http://localhost:5173/track',
      );
      assert.equal(answer.headers['cache-control'], 'no-store');
    });
  });
});
