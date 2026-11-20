#!/usr/bin/env node
/**
 * Smoke test for a running InstaSupply stack. Read-only: it needs no account and writes nothing.
 *
 *   API_URL=https://api.instasupply.ca WEB_URL=https://app.instasupply.ca node scripts/smoke.mjs
 *   API_URL=http://localhost:4000 SMOKE_CORS_ORIGIN=http://localhost:5173 node scripts/smoke.mjs   # API only
 *   WEB_URL=http://localhost:8080 EXPECT_API_URL=https://api.example.invalid node scripts/smoke.mjs  # console only
 *
 * Optional: EXPECT_PAYMENTS_MODE, EXPECT_PHONE_VERIFICATION, SMOKE_PUBLIC_LIST_PATH (default
 * /api/v1/categories), SMOKE_TIMEOUT_MS (default 10000), SMOKE_SKIP (comma-separated check keys, printed in
 * brackets on every line, for an endpoint whose module is not written yet; never set it against production).
 * Exit code 0 when every check that ran passes, otherwise 1. What each check proves: docs/DEPLOYMENT.md §5.1.
 */
const origin = (value) => (value ? value.trim().replace(/\/+$/, '') : '');

const API = origin(process.env.API_URL);
const WEB = origin(process.env.WEB_URL);
const EXPECT_API = origin(process.env.EXPECT_API_URL) || API;
const CORS_ORIGIN = origin(process.env.SMOKE_CORS_ORIGIN) || WEB;
const LIST_PATH = process.env.SMOKE_PUBLIC_LIST_PATH || '/api/v1/categories';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS) || 10_000;
const SKIP = new Set(
  (process.env.SMOKE_SKIP ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean),
);

if (!API && !WEB) {
  console.error('Set API_URL, WEB_URL or both.');
  process.exit(1);
}

let failures = 0;
let skipped = 0;

/** `key` names the check for SMOKE_SKIP; a skipped check is printed, so a report never hides one. */
async function check(key, name, run) {
  if (SKIP.has(key)) {
    skipped += 1;
    console.log(`skip  ${name} [${key}]`);
    return;
  }
  try {
    const note = await run();
    console.log(`ok    ${name} [${key}]${note ? ` (${note})` : ''}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name} [${key}]: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function request(url, init = {}) {
  return fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
}

const header = (response, name) => response.headers.get(name) ?? '';

function preflight(fromOrigin) {
  return request(`${API}/api/v1/me`, {
    method: 'OPTIONS',
    headers: {
      Origin: fromOrigin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type,x-client',
    },
  });
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`no connection within ${TIMEOUT_MS} ms`));
    }, TIMEOUT_MS);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      socket.close(1000);
      resolve();
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('the connection was refused or dropped'));
    });
  });
}

if (API) {
  await check('health', 'API health', async () => {
    const response = await request(`${API}/api/v1/health`);
    expect(response.status === 200, `status ${response.status}`);
    const body = await response.json();
    expect(body.status === 'ok', `body ${JSON.stringify(body)}`);
  });

  await check('config', 'API public configuration', async () => {
    const response = await request(`${API}/api/v1/config`);
    expect(response.status === 200, `status ${response.status}`);
    const { paymentsMode, phoneVerification } = await response.json();
    expect(['test', 'stripe', 'disabled'].includes(paymentsMode), `paymentsMode is ${paymentsMode}`);
    expect(
      ['required', 'optional', 'off'].includes(phoneVerification),
      `phoneVerification is ${phoneVerification}`,
    );
    const wantPayments = process.env.EXPECT_PAYMENTS_MODE;
    const wantPhone = process.env.EXPECT_PHONE_VERIFICATION;
    expect(
      !wantPayments || paymentsMode === wantPayments,
      `paymentsMode is ${paymentsMode}, expected ${wantPayments}`,
    );
    expect(
      !wantPhone || phoneVerification === wantPhone,
      `phoneVerification is ${phoneVerification}, expected ${wantPhone}`,
    );
    return `payments ${paymentsMode}, phone verification ${phoneVerification}`;
  });

  await check('auth', 'API refuses anonymous callers with the error envelope', async () => {
    const response = await request(`${API}/api/v1/me`);
    expect(response.status === 401, `status ${response.status}`);
    const body = await response.json();
    expect(body?.error?.status === 'unauthenticated', `body ${JSON.stringify(body)}`);
    expect(typeof body.error.message === 'string', 'error.message is missing');
  });

  await check('reference-data', `API reference data (${LIST_PATH})`, async () => {
    const response = await request(`${API}${LIST_PATH}`);
    expect(response.status === 200, `status ${response.status}`);
    const body = await response.json();
    const items = Array.isArray(body) ? body : body?.items;
    expect(Array.isArray(items) && items.length > 0, 'the list is empty');
    return `${items.length} items`;
  });

  if (CORS_ORIGIN) {
    await check('cors', `CORS allows ${CORS_ORIGIN}`, async () => {
      const response = await preflight(CORS_ORIGIN);
      expect(response.status < 300, `status ${response.status}`);
      const allowed = header(response, 'access-control-allow-origin');
      expect(allowed === CORS_ORIGIN, `access-control-allow-origin is "${allowed}"`);
    });

    await check('cors-refuse', 'CORS refuses an unknown origin', async () => {
      const stranger = 'https://smoke-test.invalid';
      const allowed = header(await preflight(stranger), 'access-control-allow-origin');
      expect(allowed !== stranger && allowed !== '*', `access-control-allow-origin is "${allowed}"`);
    });
  }

  await check('live', 'Live WebSocket opens', () => openSocket(`${API.replace(/^http/, 'ws')}/api/v1/live`));
}

if (WEB) {
  let indexHtml = '';

  await check('console-health', 'Console health', async () => {
    const response = await request(`${WEB}/healthz`);
    expect(response.status === 200, `status ${response.status}`);
  });

  await check('console-index', 'Console index and security headers', async () => {
    const response = await request(`${WEB}/`);
    expect(response.status === 200, `status ${response.status}`);
    expect(
      header(response, 'content-type').includes('text/html'),
      `content-type ${header(response, 'content-type')}`,
    );
    indexHtml = await response.text();
    expect(indexHtml.includes('id="root"'), 'index.html has no #root element');
    expect(header(response, 'cache-control').includes('no-cache'), 'index.html may be cached');
    expect(header(response, 'x-content-type-options') === 'nosniff', 'x-content-type-options is missing');
    expect(header(response, 'strict-transport-security') !== '', 'strict-transport-security is missing');
    const policy = header(response, 'content-security-policy');
    expect(policy.includes("frame-ancestors 'none'"), 'content-security-policy is missing');
    expect(
      !EXPECT_API || policy.includes(new URL(EXPECT_API).host),
      `the policy does not allow ${EXPECT_API}`,
    );
  });

  for (const path of ['/portal', '/track/smoke-test']) {
    await check('deep-link', `Console deep link ${path}`, async () => {
      const response = await request(`${WEB}${path}`);
      expect(response.status === 200, `status ${response.status}`);
      expect((await response.text()).includes('id="root"'), 'the app shell was not served');
    });
  }

  await check('build-info', 'Console was built for this API', async () => {
    const response = await request(`${WEB}/build-info.json`);
    expect(response.status === 200, `status ${response.status}`);
    const info = await response.json();
    expect(
      !EXPECT_API || origin(info.apiUrl) === EXPECT_API,
      `built for ${info.apiUrl}, expected ${EXPECT_API}`,
    );
    return `built ${info.builtAt} for ${info.apiUrl}`;
  });

  await check('assets', 'Console assets', async () => {
    const asset = indexHtml.match(/["'](\/assets\/[^"']+\.js)["']/)?.[1];
    expect(asset, 'index.html names no /assets/*.js file');
    const response = await request(`${WEB}${asset}`);
    expect(response.status === 200, `${asset} answered ${response.status}`);
    expect(header(response, 'cache-control').includes('immutable'), `${asset} is not cached as immutable`);
    const missing = await request(`${WEB}/assets/smoke-test-missing.js`);
    expect(missing.status === 404, `a missing asset answered ${missing.status}`);
  });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log(skipped > 0 ? `\nAll checks that ran passed (${skipped} skipped).` : '\nAll checks passed.');
