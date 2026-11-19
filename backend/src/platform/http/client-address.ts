/**
 * The only readers of the caller's address and of the server's own public origin (docs/PLATFORM.md §4.6,
 * §11.1). Railway's edge sets X-Real-IP and adds no X-Forwarded-For, so any X-Forwarded-For was written by
 * the client; Fastify's trustProxy stays off and request.ip is never read.
 */
import type { IncomingHttpHeaders } from 'node:http';
import type { Config } from '../../config/env';

type AddressConfig = Pick<Config, 'TRUST_PROXY'>;
type OriginConfig = Pick<Config, 'API_URL' | 'RAILWAY_PUBLIC_DOMAIN' | 'NODE_ENV'>;

export function clientAddress(
  req: { headers: IncomingHttpHeaders; socket: { remoteAddress?: string } },
  config: AddressConfig,
): string {
  const real = config.TRUST_PROXY ? String(req.headers['x-real-ip'] ?? '').trim() : '';
  return real || req.socket.remoteAddress || 'unknown';
}

/** The origin outside a request (outbox handlers, the CLI). */
export function configuredOrigin(config: OriginConfig): string {
  if (config.API_URL) return config.API_URL;
  if (config.RAILWAY_PUBLIC_DOMAIN) return `https://${config.RAILWAY_PUBLIC_DOMAIN}`;
  return 'http://localhost:4000';
}

/**
 * API_URL when set; in production https:// + RAILWAY_PUBLIC_DOMAIN; otherwise the request's own origin, so
 * a phone on the LAN or an Android emulator receives URLs it can reach.
 */
export function publicOrigin(req: { headers: IncomingHttpHeaders }, config: OriginConfig): string {
  if (config.API_URL) return config.API_URL;
  if (config.NODE_ENV === 'production' && config.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${config.RAILWAY_PUBLIC_DOMAIN}`;
  }
  const host = String(req.headers.host ?? '').trim();
  // A Host header is client input: accept only host[:port] characters before echoing it into URLs.
  return /^[A-Za-z0-9.\-[\]:]+$/.test(host) ? `http://${host}` : configuredOrigin(config);
}
