/** Allowed browser origins (docs/PLATFORM.md §4.8). Native apps send no Origin and are unaffected. */
import type { FastifyCorsOptions } from '@fastify/cors';
import type { Config } from '../../config/env';

type CorsConfig = Pick<Config, 'CORS_ORIGINS' | 'NODE_ENV'>;

/** localhost, 127.0.0.1 and private LAN addresses on any port: Expo web and a phone on the same Wi-Fi. */
const LOCAL =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?$/;

export function isAllowedOrigin(origin: string, config: CorsConfig): boolean {
  if (config.CORS_ORIGINS.includes(origin.replace(/\/+$/, ''))) return true;
  return config.NODE_ENV !== 'production' && LOCAL.test(origin);
}

/** A browser preflight (OPTIONS with Access-Control-Request-Method) from an origin that is not allowed. */
export function isRefusedPreflight(
  method: string,
  headers: { origin?: string | undefined; 'access-control-request-method'?: string | string[] | undefined },
  config: CorsConfig,
): boolean {
  return (
    method === 'OPTIONS' &&
    headers['access-control-request-method'] !== undefined &&
    typeof headers.origin === 'string' &&
    !isAllowedOrigin(headers.origin, config)
  );
}

export function corsOptions(config: CorsConfig): FastifyCorsOptions {
  return {
    origin: (origin, callback) => callback(null, origin === undefined || isAllowedOrigin(origin, config)),
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Client', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 86_400,
  };
}
