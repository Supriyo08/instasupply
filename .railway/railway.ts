/**
 * InstaSupply on Railway: the whole production environment.
 *
 *   railway config plan     # read-only: what would change
 *   railway config apply    # shows the plan, asks, then applies
 *
 * - This file owns everything it declares. A service, bucket or variable that exists on Railway but is
 *   missing here is planned for DELETION. Read every plan before applying it.
 * - Secrets are never written here. They are set once with `railway variable set NAME --stdin` and are
 *   listed below as preserve() ("keep whatever Railway has").
 * - Railway-provided domains are managed with `railway domain`; custom domains are declared below (§4.9).
 * - After every apply: `railway tcp-proxy list --service Postgres` must be empty (§4.2).
 *
 * Evaluated by the Railway CLI with Node's type stripping: plain TypeScript only. See docs/DEPLOYMENT.md §2.2.
 */
import { bucket, database, defineRailway, preserve, project, ref, service } from 'railway/iac';

/** US East (Virginia), the Railway region closest to Toronto. Railway has no Canadian region. */
const REGION = 'us-east4-eqdc4a';

/** Buckets have their own region codes. A bucket's region can never be changed. */
const BUCKET_REGION = 'iad';

/**
 * PostgreSQL major version. NEVER change this tag to upgrade: a new image does not run pg_upgrade and the
 * database will not start. Upgrade in the dashboard (Postgres → Database → Config → Major Version Upgrade),
 * then change the tag here to match what is running.
 */
const POSTGRES_IMAGE = 'ghcr.io/railwayapp-templates/postgres-ssl:17';

/**
 * Public host names, without a scheme. They start as references to the Railway-provided domains. Before a
 * custom domain is added they are replaced with literals: first the Railway host names, then
 * 'api.instasupply.ca' and 'app.instasupply.ca' (§4.9).
 */
const API_HOST = '${{backend.RAILWAY_PUBLIC_DOMAIN}}';
const WEB_HOST = '${{frontend.RAILWAY_PUBLIC_DOMAIN}}';

/**
 * The API's own public origin, which the server puts into media URLs. On its Railway-provided domain the
 * server derives it from RAILWAY_PUBLIC_DOMAIN, a variable Railway injects, so nothing is set. With a custom
 * domain it has to be told: this adds API_URL as soon as API_HOST is a literal.
 */
const API_URL_OVERRIDE: Record<string, string> = API_HOST.includes('${{')
  ? {}
  : { API_URL: 'https://' + API_HOST };

/** More browser origins that may call the API, for example the old console URL during a domain change. */
const EXTRA_WEB_ORIGINS: string[] = [];

/**
 * Custom domains (§4.9). Empty until DNS access exists. Every APK and console build made against a custom
 * domain depends on it: never remove an entry once a build uses it.
 */
const API_CUSTOM_DOMAINS: string[] = []; // later: ['api.instasupply.ca']
const WEB_CUSTOM_DOMAINS: string[] = []; // later: ['app.instasupply.ca']

/**
 * 'test'     pilot: card payments are simulated and no money moves (MARKETPLACE §3.8). Team and demo use only.
 * 'disabled' checkout is closed.
 * 'stripe'   real payments. The server refuses to start with this value until the gateway is built.
 */
const PAYMENTS_MODE = 'test';

/** Number of API instances. Read §4.8 before changing it. */
const BACKEND_REPLICAS = 1;

export default defineRailway(() => {
  const db = database('Postgres', 'postgres', {
    image: POSTGRES_IMAGE,
    output: 'DATABASE_URL',
    defaultMountPath: '/var/lib/postgresql/data',
    region: REGION,
  });

  const uploads = bucket('uploads', { region: BUCKET_REGION });

  const backend = service('backend', {
    build: {
      builder: 'DOCKERFILE',
      dockerfilePath: 'backend/Dockerfile',
      // Only used once the service deploys from GitHub: `railway up` always builds.
      watchPatterns: ['/backend/**', '/packages/shared/**', '/package.json', '/package-lock.json'],
    },
    domains: API_CUSTOM_DOMAINS.map((domain) => ({ domain, port: 8080 })),
    // Runs in a separate container of the new image, before the new version starts. A failure stops the
    // deployment and the previous version keeps serving.
    preDeploy: 'node dist/cli.js migrate',
    healthcheck: '/api/v1/health',
    healthcheckTimeout: 120,
    replicas: { [REGION]: BACKEND_REPLICAS },
    deploy: {
      preDeployTimeoutSeconds: 600,
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 10,
      // Time between SIGTERM and SIGKILL for the old version: WebSockets close, requests finish.
      drainingSeconds: 30,
      // Never let the API sleep: it runs the scheduled jobs and holds WebSocket connections.
      sleepApplication: false,
    },
    env: {
      // --- process ---------------------------------------------------------------------------------
      NODE_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'info',
      TRUST_PROXY: 'true',

      // --- database (private network; no TLS on this hop) --------------------------------------------
      DATABASE_URL: db.env.DATABASE_URL,
      DATABASE_POOL_MAX: '10',

      // --- public addresses ----------------------------------------------------------------------------
      // Links in SMS and email (tracking page, set-password, password reset) start with WEB_URL.
      WEB_URL: 'https://' + WEB_HOST,
      CORS_ORIGINS: ['https://' + WEB_HOST, ...EXTRA_WEB_ORIGINS].join(','),
      ...API_URL_OVERRIDE,

      // --- files ---------------------------------------------------------------------------------------
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: ref(uploads, 'ENDPOINT'),
      S3_REGION: ref(uploads, 'REGION'),
      S3_BUCKET: ref(uploads, 'BUCKET'),
      S3_ACCESS_KEY_ID: ref(uploads, 'ACCESS_KEY_ID'),
      S3_SECRET_ACCESS_KEY: ref(uploads, 'SECRET_ACCESS_KEY'),

      // --- product switches ----------------------------------------------------------------------------
      PAYMENTS_MODE,
      PHONE_VERIFICATION: 'optional', // 'required' once SMS_DRIVER is 'twilio'
      SMS_DRIVER: 'outbox', // 'twilio' once the three TWILIO_* variables are set
      EMAIL_DRIVER: 'outbox', // 'resend' once RESEND_API_KEY and EMAIL_FROM are set
      ALLOW_TEST_JOBS: 'false',

      // --- maps ----------------------------------------------------------------------------------------
      GEOCODER: 'nominatim',
      ROUTING_PROVIDER: 'osrm',
      GEO_USER_AGENT: 'InstaSupply/1.0 (+https://instasupply.ca)',
      MAP_TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      MAP_ATTRIBUTION: '© OpenStreetMap contributors',

      // --- set with `railway variable set NAME --stdin --service backend` (§3.7, §8.3) ------------------
      JWT_SECRET: preserve(),
      JWT_SECRET_PREVIOUS: preserve(), // only during a rotation (§4.7)
      OTP_PEPPER: preserve(),
      SUPPORT_PHONE: preserve(),
      SUPPORT_EMAIL: preserve(),
      HST_NUMBER: preserve(),
      TWILIO_ACCOUNT_SID: preserve(),
      TWILIO_AUTH_TOKEN: preserve(),
      TWILIO_FROM: preserve(),
      RESEND_API_KEY: preserve(),
      SMTP_URL: preserve(),
      EMAIL_FROM: preserve(),
      GOOGLE_MAPS_API_KEY: preserve(),
      EXPO_ACCESS_TOKEN: preserve(),
    },
  });

  const frontend = service('frontend', {
    build: {
      builder: 'DOCKERFILE',
      dockerfilePath: 'frontend/Dockerfile',
      watchPatterns: [
        '/frontend/**',
        '/packages/shared/**',
        '/packages/art/**',
        '/packages/api-client/**',
        '/package.json',
        '/package-lock.json',
      ],
    },
    domains: WEB_CUSTOM_DOMAINS.map((domain) => ({ domain, port: 8080 })),
    healthcheck: '/healthz',
    healthcheckTimeout: 60,
    replicas: { [REGION]: 1 },
    deploy: {
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 10,
      drainingSeconds: 5,
      sleepApplication: false,
    },
    env: {
      PORT: '8080',
      // Build time: Railway passes it to the Dockerfile as a build argument and Vite writes it into the
      // bundle. After changing it, run `railway up --service frontend` (a redeploy may reuse the image).
      VITE_API_URL: 'https://' + API_HOST,
      // Run time: the Caddyfile puts it in the Content-Security-Policy.
      API_HOST,
    },
  });

  return project('instasupply', { resources: [db, uploads, backend, frontend] });
});
