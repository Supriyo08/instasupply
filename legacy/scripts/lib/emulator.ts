/**
 * Helpers for scripts that talk to the local Firebase Emulator Suite.
 * They refuse to run against anything but the emulators.
 */
export const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-instasupply';
export const REGION = process.env.FUNCTIONS_REGION ?? 'us-central1';
const HOST = process.env.EMULATOR_HOST ?? '127.0.0.1';

process.env.GCLOUD_PROJECT = PROJECT_ID;
// Skip the GCP metadata-server probe; the emulators need no credentials.
process.env.METADATA_SERVER_DETECTION ??= 'none';
process.env.FIRESTORE_EMULATOR_HOST ??= `${HOST}:8080`;
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `${HOST}:9099`;
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= `${HOST}:9199`;

if (!PROJECT_ID.startsWith('demo-')) {
  throw new Error(`Refusing to run: ${PROJECT_ID} is not a demo (emulator-only) project.`);
}

const AUTH_URL = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const FIRESTORE_URL = `http://${process.env.FIRESTORE_EMULATOR_HOST}`;
const FUNCTIONS_URL = `http://${HOST}:5001/${PROJECT_ID}/${REGION}`;

export async function assertEmulatorsRunning(): Promise<void> {
  try {
    await fetch(`${FIRESTORE_URL}/`, { signal: AbortSignal.timeout(2000) });
    await fetch(`${AUTH_URL}/`, { signal: AbortSignal.timeout(2000) });
  } catch {
    throw new Error('The Firebase emulators are not running. Start them with `npm run emulators` first.');
  }
}

/** Wipe all Firestore documents and Auth users in the emulator. */
export async function resetEmulators(): Promise<void> {
  await fetch(`${FIRESTORE_URL}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  await fetch(`${AUTH_URL}/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' });
}

/** Sign in with email/password against the Auth emulator and return an ID token. */
export async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(
    `${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const payload = (await response.json()) as { idToken?: string; error?: { message: string } };
  if (!payload.idToken) throw new Error(`Sign-in failed for ${email}: ${payload.error?.message}`);
  return payload.idToken;
}

/** Invoke an HTTPS callable function as a signed-in user. */
export async function callFunction<T = unknown>(name: string, idToken: string, data: unknown): Promise<T> {
  const response = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  const payload = (await response.json()) as { result?: T; error?: { message: string; status: string } };
  if (payload.error) throw new Error(`${name}: ${payload.error.status} ${payload.error.message}`);
  return payload.result as T;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
