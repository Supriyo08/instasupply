/**
 * Bootstrap the first administrator of a real Firebase project (or the emulators).
 *
 *   # production: use a service account with the Firebase Admin role
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     npm run create-admin -- --project my-project-id --email ops@example.com --name "Ops Lead"
 *
 * The admin receives a password-setup link; no password is ever passed on the command line.
 */
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

async function main() {
  const projectId = option('project') ?? process.env.GCLOUD_PROJECT;
  const email = option('email')?.trim().toLowerCase();
  const displayName = option('name') ?? 'Administrator';
  if (!projectId || !email) {
    throw new Error(
      'Usage: npm run create-admin -- --project <project-id> --email <email> [--name "Full Name"]',
    );
  }
  if (projectId.startsWith('demo-')) {
    process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
  }

  const app = initializeApp({ projectId });
  const auth = getAuth(app);
  const db = getFirestore(app);

  const user = await auth.getUserByEmail(email).catch(() => auth.createUser({ email, displayName }));
  await auth.setCustomUserClaims(user.uid, { role: 'admin', active: true });
  await db.doc(`users/${user.uid}`).set(
    {
      uid: user.uid,
      role: 'admin',
      status: 'active',
      displayName: user.displayName ?? displayName,
      email,
      phoneNumber: user.phoneNumber ?? null,
      phoneVerified: !!user.phoneNumber,
      preferences: { chatPush: true, deliveryPush: true },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  const link = await auth.generatePasswordResetLink(email);
  console.log(`✓ ${email} is now an admin of ${projectId}.\n  Set a password here: ${link}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
