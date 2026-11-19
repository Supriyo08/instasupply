/**
 * Firebase app + Firestore. Kept separate from auth/functions/storage so the public tracking page
 * only downloads what it needs.
 */
import { initializeApp } from 'firebase/app';
import { connectFirestoreEmulator, initializeFirestore } from 'firebase/firestore';

import { emulatorHost, env } from '../env';

export const app = initializeApp(env.firebase);

export const db = initializeFirestore(app, { ignoreUndefinedProperties: true });

if (env.useEmulators) {
  connectFirestoreEmulator(db, emulatorHost, 8080);
}
