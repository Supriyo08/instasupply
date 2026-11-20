/**
 * The only reader of `process.env` (docs/PLATFORM.md §11.1). Every variable has a development default, so
 * development needs no `.env` file. With NODE_ENV=production a variable that is not set takes the production
 * column instead, and unsafe values stop the process with a message that names the variable.
 */
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { backendRoot } from '../platform/paths';

export type NodeEnv = 'development' | 'test' | 'production';
type Env = Record<string, string | undefined>;

export const DEV_JWT_SECRET = 'dev-only-jwt-secret-change-me-0123456789abcdef';
export const DEV_OTP_PEPPER = 'dev-only-pepper-change-me-0123456789abcdef';
export const DEV_SEED_PASSWORD = 'Instasupply@123';

/** Defaults per environment. `undefined` means "no default": the variable stays unset. */
interface Defaults {
  development: string | undefined;
  production: string | undefined;
  /** Tests run without workers, push, limits or real providers (§11.1, last paragraph). */
  test?: string | undefined;
}

const DEFAULTS: Record<string, Defaults> = {
  PORT: { development: '4000', production: '8080' },
  HOST: { development: '::', production: '::' },
  API_URL: { development: undefined, production: undefined },
  RAILWAY_PUBLIC_DOMAIN: { development: undefined, production: undefined },
  WEB_URL: { development: 'http://localhost:5173', production: undefined },
  CORS_ORIGINS: { development: '', production: '' },
  TRUST_PROXY: { development: 'false', production: 'true' },
  LOG_LEVEL: { development: 'debug', production: 'info', test: 'silent' },
  LOG_PRETTY: { development: 'true', production: 'false', test: 'false' },
  DATABASE_URL: { development: 'postgres://localhost:5432/instasupply_dev', production: undefined },
  DATABASE_SSL: { development: 'disable', production: 'disable' },
  DATABASE_POOL_MAX: { development: '10', production: '10' },
  DATABASE_AUTO_CREATE: { development: 'true', production: 'false' },
  MIGRATE_ON_START: { development: 'true', production: 'false' },
  JWT_SECRET: { development: DEV_JWT_SECRET, production: undefined },
  JWT_SECRET_PREVIOUS: { development: '', production: '' },
  ACCESS_TOKEN_TTL_SECONDS: { development: '900', production: '900' },
  REFRESH_TOKEN_TTL_DAYS: { development: '60', production: '60' },
  SESSION_MAX_DAYS: { development: '180', production: '180' },
  INVITE_LINK_TTL_HOURS: { development: '72', production: '72' },
  OTP_PEPPER: { development: DEV_OTP_PEPPER, production: undefined },
  OTP_TEST_NUMBERS: {
    development: '+14165550199:123456,+16475550199:123456,+19055550199:123456',
    production: '',
  },
  PHONE_VERIFICATION: { development: 'required', production: 'optional' },
  EXPOSE_DEV_CODES: { development: 'true', production: 'false' },
  PAYMENTS_MODE: { development: 'test', production: 'disabled' },
  ALLOW_TEST_JOBS: { development: 'true', production: 'false' },
  SEED_PASSWORD: { development: DEV_SEED_PASSWORD, production: undefined },
  HST_NUMBER: { development: '000000000 RT0001', production: '' },
  SUPPORT_PHONE: { development: '+14165550100', production: '' },
  SUPPORT_EMAIL: { development: 'support@instasupply.test', production: '' },
  MAP_TILE_URL: {
    development: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    production: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  },
  MAP_ATTRIBUTION: {
    development: '© OpenStreetMap contributors',
    production: '© OpenStreetMap contributors',
  },
  MAP_MAX_ZOOM: { development: '19', production: '19' },
  STORAGE_DRIVER: { development: 'local', production: 's3', test: 'local' },
  STORAGE_LOCAL_DIR: { development: undefined, production: undefined },
  S3_ENDPOINT: { development: '', production: '' },
  S3_REGION: { development: '', production: '' },
  S3_BUCKET: { development: '', production: '' },
  S3_ACCESS_KEY_ID: { development: '', production: '' },
  S3_SECRET_ACCESS_KEY: { development: '', production: '' },
  S3_FORCE_PATH_STYLE: { development: 'false', production: 'false' },
  FILE_URL_TTL_SECONDS: { development: '300', production: '300' },
  SMS_DRIVER: { development: 'outbox', production: 'outbox', test: 'outbox' },
  TWILIO_ACCOUNT_SID: { development: '', production: '' },
  TWILIO_AUTH_TOKEN: { development: '', production: '' },
  TWILIO_FROM: { development: '', production: '' },
  EMAIL_DRIVER: { development: 'outbox', production: 'outbox', test: 'outbox' },
  EMAIL_FROM: { development: 'InstaSupply <no-reply@instasupply.test>', production: '' },
  RESEND_API_KEY: { development: '', production: '' },
  SMTP_URL: { development: '', production: '' },
  PUSH_ENABLED: { development: 'true', production: 'true', test: 'false' },
  EXPO_ACCESS_TOKEN: { development: '', production: '' },
  GOOGLE_MAPS_API_KEY: { development: '', production: '' },
  ROUTING_PROVIDER: { development: 'auto', production: 'osrm' },
  OSRM_URL: { development: 'https://router.project-osrm.org', production: 'https://router.project-osrm.org' },
  GEOCODER: { development: 'auto', production: 'nominatim' },
  NOMINATIM_URL: {
    development: 'https://nominatim.openstreetmap.org',
    production: 'https://nominatim.openstreetmap.org',
  },
  GEO_USER_AGENT: {
    development: 'InstaSupply-dev/1.0',
    production: 'InstaSupply/1.0 (+https://instasupply.ca)',
  },
  RUN_WORKER: { development: 'true', production: 'true', test: 'false' },
  RUN_SCHEDULER: { development: 'true', production: 'true', test: 'false' },
  OUTBOX_POLL_MS: { development: '1000', production: '1000' },
  OUTBOX_BATCH: { development: '20', production: '20' },
  OUTBOX_CONCURRENCY: { development: '4', production: '4' },
  SHUTDOWN_GRACE_MS: { development: '20000', production: '20000' },
  RATE_LIMIT_PER_MINUTE: { development: '600', production: '600' },
  RATE_LIMITS_DISABLED: { development: 'false', production: 'false', test: 'true' },
};

/** Every variable that configures the server; the test runner's libpq variables are not part of it. */
export const VARIABLE_NAMES = ['NODE_ENV', ...Object.keys(DEFAULTS)] as const;

const bool = z.enum(['true', 'false']).transform((value) => value === 'true');
const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const text = z.string().trim();
/** An empty string means "not set" for optional values. */
const optionalText = text.transform((value) => (value === '' ? null : value));
const origin = z
  .string()
  .trim()
  .url()
  .transform((value) => value.replace(/\/+$/, ''));
const list = text.transform((value) =>
  value
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter((entry) => entry !== ''),
);
const testNumbers = list.transform((pairs, ctx) => {
  const map = new Map<string, string>();
  for (const pair of pairs) {
    const match = /^(\+1\d{10}):(\d{6})$/.exec(pair);
    if (!match) {
      ctx.addIssue({ code: 'custom', message: `"${pair}" is not "+1XXXXXXXXXX:NNNNNN"` });
      return z.NEVER;
    }
    map.set(match[1]!, match[2]!);
  }
  return map;
});

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: int(0, 65535),
  HOST: text.min(1),
  API_URL: z.union([z.literal('').transform(() => null), origin]).nullable(),
  RAILWAY_PUBLIC_DOMAIN: optionalText.nullable(),
  WEB_URL: origin,
  CORS_ORIGINS: list,
  TRUST_PROXY: bool,
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']),
  LOG_PRETTY: bool,
  DATABASE_URL: text.min(1),
  DATABASE_SSL: z.enum(['disable', 'require']),
  DATABASE_POOL_MAX: int(1, 100),
  DATABASE_AUTO_CREATE: bool,
  MIGRATE_ON_START: bool,
  JWT_SECRET: text.min(1),
  JWT_SECRET_PREVIOUS: optionalText,
  ACCESS_TOKEN_TTL_SECONDS: int(60, 86_400),
  REFRESH_TOKEN_TTL_DAYS: int(1, 365),
  SESSION_MAX_DAYS: int(1, 730),
  INVITE_LINK_TTL_HOURS: int(1, 720),
  OTP_PEPPER: text.min(1),
  OTP_TEST_NUMBERS: testNumbers,
  PHONE_VERIFICATION: z.enum(['required', 'optional', 'off']),
  EXPOSE_DEV_CODES: bool,
  PAYMENTS_MODE: z.enum(['test', 'stripe', 'disabled']),
  ALLOW_TEST_JOBS: bool,
  SEED_PASSWORD: optionalText.nullable(),
  HST_NUMBER: optionalText,
  SUPPORT_PHONE: optionalText,
  SUPPORT_EMAIL: optionalText,
  MAP_TILE_URL: text.min(1),
  MAP_ATTRIBUTION: text,
  MAP_MAX_ZOOM: int(1, 24),
  STORAGE_DRIVER: z.enum(['local', 's3']),
  STORAGE_LOCAL_DIR: text.min(1),
  S3_ENDPOINT: optionalText,
  S3_REGION: optionalText,
  S3_BUCKET: optionalText,
  S3_ACCESS_KEY_ID: optionalText,
  S3_SECRET_ACCESS_KEY: optionalText,
  S3_FORCE_PATH_STYLE: bool,
  FILE_URL_TTL_SECONDS: int(30, 86_400),
  SMS_DRIVER: z.enum(['outbox', 'twilio']),
  TWILIO_ACCOUNT_SID: optionalText,
  TWILIO_AUTH_TOKEN: optionalText,
  TWILIO_FROM: optionalText,
  EMAIL_DRIVER: z.enum(['outbox', 'resend', 'smtp']),
  EMAIL_FROM: optionalText,
  RESEND_API_KEY: optionalText,
  SMTP_URL: optionalText,
  PUSH_ENABLED: bool,
  EXPO_ACCESS_TOKEN: optionalText,
  GOOGLE_MAPS_API_KEY: optionalText,
  ROUTING_PROVIDER: z.enum(['auto', 'google', 'osrm', 'estimate']),
  OSRM_URL: origin,
  GEOCODER: z.enum(['auto', 'google', 'nominatim', 'none']),
  NOMINATIM_URL: origin,
  GEO_USER_AGENT: text.min(1),
  RUN_WORKER: bool,
  RUN_SCHEDULER: bool,
  OUTBOX_POLL_MS: int(50, 60_000),
  OUTBOX_BATCH: int(1, 500),
  OUTBOX_CONCURRENCY: int(1, 64),
  SHUTDOWN_GRACE_MS: int(0, 120_000),
  RATE_LIMIT_PER_MINUTE: int(1, 1_000_000),
  RATE_LIMITS_DISABLED: bool,
});

export type Config = z.infer<typeof schema> & { readonly warnings: readonly string[] };

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * Parses and validates the environment. `env` defaults to `process.env`; tests pass their own record (an
 * explicit value always wins over a default).
 */
export function loadConfig(env: Env = process.env): Config {
  const nodeEnv = (env.NODE_ENV ?? 'development') as NodeEnv;
  const raw: Record<string, string | undefined> = { NODE_ENV: nodeEnv };
  for (const [name, defaults] of Object.entries(DEFAULTS)) {
    const given = env[name];
    if (given !== undefined) {
      raw[name] = given;
      continue;
    }
    if (nodeEnv === 'production') raw[name] = defaults.production;
    else if (nodeEnv === 'test' && 'test' in defaults) raw[name] = defaults.test;
    else raw[name] = defaults.development;
  }
  // An empty value (a copied .env.example line) means "use the default folder".
  if (!raw.STORAGE_LOCAL_DIR)
    raw.STORAGE_LOCAL_DIR =
      nodeEnv === 'test'
        ? path.join(tmpdir(), `instasupply-files-${process.pid}`)
        : path.join(backendRoot(), '.data', 'files');
  // Optional values with no default reach zod as null rather than undefined, so "not set" has one spelling.
  for (const name of ['API_URL', 'RAILWAY_PUBLIC_DOMAIN', 'SEED_PASSWORD'] as const) raw[name] ??= '';

  const missing = Object.entries(raw)
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new ConfigError(
      `Missing environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
    );
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError(`Invalid environment: ${problems.join('; ')}`);
  }
  const config = parsed.data;
  if (config.STORAGE_LOCAL_DIR && !path.isAbsolute(config.STORAGE_LOCAL_DIR)) {
    config.STORAGE_LOCAL_DIR = path.resolve(backendRoot(), config.STORAGE_LOCAL_DIR);
  }

  const refusals: string[] = [];
  const warnings: string[] = [];
  if (config.PAYMENTS_MODE === 'stripe') {
    refusals.push('PAYMENTS_MODE=stripe is not implemented yet; use test or disabled');
  }
  if (config.NODE_ENV === 'production') checkProduction(config, refusals, warnings);
  checkDrivers(config, refusals);
  if (refusals.length > 0) throw new ConfigError(`Unsafe configuration: ${refusals.join('; ')}`);
  return { ...config, warnings };
}

function checkProduction(config: z.infer<typeof schema>, refusals: string[], warnings: string[]): void {
  for (const name of ['JWT_SECRET', 'OTP_PEPPER'] as const) {
    const value = config[name];
    if (value.length < 32) refusals.push(`${name} must be at least 32 characters`);
    if (value === DEV_JWT_SECRET || value === DEV_OTP_PEPPER)
      refusals.push(`${name} is a development default`);
  }
  // The previous secret still signs valid tokens during a rotation, so it gets the same refusals.
  const previous = config.JWT_SECRET_PREVIOUS;
  if (previous !== null) {
    if (previous.length < 32) refusals.push('JWT_SECRET_PREVIOUS must be at least 32 characters');
    if (previous === DEV_JWT_SECRET || previous === DEV_OTP_PEPPER)
      refusals.push('JWT_SECRET_PREVIOUS is a development default');
    if (previous === config.JWT_SECRET) refusals.push('JWT_SECRET_PREVIOUS must differ from JWT_SECRET');
  }
  if (config.EXPOSE_DEV_CODES) refusals.push('EXPOSE_DEV_CODES=true is not allowed in production');
  if (config.RATE_LIMITS_DISABLED) refusals.push('RATE_LIMITS_DISABLED=true is not allowed in production');
  if (config.DATABASE_AUTO_CREATE) refusals.push('DATABASE_AUTO_CREATE=true is not allowed in production');
  if (config.STORAGE_DRIVER === 'local') {
    refusals.push('STORAGE_DRIVER=local is not allowed in production (the service has no volume)');
  }
  if (config.CORS_ORIGINS.length === 0) refusals.push('CORS_ORIGINS must list the console origin');
  if (config.CORS_ORIGINS.includes('*')) refusals.push('CORS_ORIGINS may not contain *');
  if (config.PHONE_VERIFICATION === 'required' && config.SMS_DRIVER === 'outbox') {
    refusals.push('PHONE_VERIFICATION=required needs SMS_DRIVER=twilio');
  }
  if (!config.API_URL && !config.RAILWAY_PUBLIC_DOMAIN) {
    refusals.push('set API_URL (or run on Railway, which sets RAILWAY_PUBLIC_DOMAIN)');
  }
  if (config.ALLOW_TEST_JOBS) warnings.push('ALLOW_TEST_JOBS=true in production');
  if (config.OTP_TEST_NUMBERS.size > 0) warnings.push('OTP_TEST_NUMBERS is not empty in production');
}

/** A driver whose credentials are missing would fail at its first use; refuse it at start-up instead. */
function checkDrivers(config: z.infer<typeof schema>, refusals: string[]): void {
  if (
    config.SMS_DRIVER === 'twilio' &&
    !(config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_FROM)
  ) {
    refusals.push('SMS_DRIVER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM');
  }
  if (config.EMAIL_DRIVER === 'resend' && !(config.RESEND_API_KEY && config.EMAIL_FROM)) {
    refusals.push('EMAIL_DRIVER=resend needs RESEND_API_KEY and EMAIL_FROM');
  }
  if (config.EMAIL_DRIVER === 'smtp' && !(config.SMTP_URL && config.EMAIL_FROM)) {
    refusals.push('EMAIL_DRIVER=smtp needs SMTP_URL and EMAIL_FROM');
  }
  if (
    config.STORAGE_DRIVER === 's3' &&
    !(
      config.S3_ENDPOINT &&
      config.S3_REGION &&
      config.S3_BUCKET &&
      config.S3_ACCESS_KEY_ID &&
      config.S3_SECRET_ACCESS_KEY
    )
  ) {
    refusals.push(
      'STORAGE_DRIVER=s3 needs S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY',
    );
  }
}

/** The development defaults, for `.env.example` and the config test. */
export function developmentDefaults(): Record<string, string> {
  const out: Record<string, string> = { NODE_ENV: 'development' };
  for (const [name, defaults] of Object.entries(DEFAULTS)) out[name] = defaults.development ?? '';
  return out;
}

/** The deployed commit when Railway provides it, for GET /health; `dev` elsewhere. */
export function serverVersion(env: Env = process.env): string {
  return env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) || 'dev';
}

/**
 * True inside the test runner. Read here because this file is the only reader of process.env; password
 * hashing uses it to pick the cheap test cost before any configuration is loaded.
 */
export function isTestProcess(env: Env = process.env): boolean {
  return env.NODE_ENV === 'test';
}
