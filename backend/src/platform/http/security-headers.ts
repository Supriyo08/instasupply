/** Headers on every response (docs/PLATFORM.md §4.8). The API serves JSON, never a page. */
import type { FastifyHelmetOptions } from '@fastify/helmet';
import type { Config } from '../../config/env';

export function helmetOptions(config: Pick<Config, 'NODE_ENV'>): FastifyHelmetOptions {
  return {
    global: true,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    },
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    noSniff: true,
    // The console is on another origin and loads media from here.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
    originAgentCluster: false,
    xDnsPrefetchControl: false,
    xDownloadOptions: false,
    xPermittedCrossDomainPolicies: false,
    xXssProtection: false,
    hsts:
      config.NODE_ENV === 'production'
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
        : false,
  };
}
