import type { LoggerOptions } from 'pino';
import type { Config } from '../config/env';

/**
 * Paths pino replaces with "[redacted]". Bodies are never logged (§4.3); this list catches the places where
 * a secret could still slip into a log object by accident.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'headers.authorization',
  'authorization',
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'refreshToken',
  'accessToken',
  'code',
  '*.password',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
];

/**
 * pino-pretty is a devDependency, so the production image (npm ci --omit=dev) does not have it. An image
 * started with NODE_ENV=development (or LOG_PRETTY=true) would otherwise crash when pino cannot load the
 * transport; it falls back to JSON lines instead.
 */
export function prettyAvailable(resolve: (specifier: string) => string = import.meta.resolve): boolean {
  try {
    resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/** pino options with the shape Railway's log explorer reads: a string `level` and the text in `message`. */
export function loggerOptions(
  config: Config,
  pretty = config.LOG_PRETTY && prettyAvailable(),
): LoggerOptions {
  return {
    level: config.LOG_LEVEL,
    messageKey: 'message',
    formatters: { level: (label: string) => ({ level: label }) },
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    // The default serializers put req.url and remoteAddress on every line; ours keep nothing that names a
    // person or carries a secret (§4.3).
    serializers: {
      req: (req: { method?: string; routeOptions?: { url?: string } }) => ({
        method: req.method,
        route: req.routeOptions?.url,
      }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { messageKey: 'message', colorize: true } } }
      : {}),
  };
}
