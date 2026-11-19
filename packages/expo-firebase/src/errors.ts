const AUTH_MESSAGES: Record<string, string> = {
  'auth/email-already-in-use': 'An account with this email already exists. Try signing in.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/invalid-credential': 'That email and password combination is incorrect.',
  'auth/wrong-password': 'That email and password combination is incorrect.',
  'auth/user-not-found': 'No account found with this email.',
  'auth/user-disabled': 'Your account is suspended. Please contact your dispatcher.',
  'auth/weak-password': 'Choose a stronger password (at least 8 characters with a number).',
  'auth/too-many-requests': 'Too many attempts. Please wait a minute and try again.',
  'auth/network-request-failed': "You're offline. Check your connection and try again.",
  'auth/missing-password': 'Enter your password.',
};

const UNREACHABLE = "Can't reach the server. Check your connection and try again.";

/**
 * Failures the Firebase SDKs report on their own, by status code: Firestore uses the bare code,
 * callables `functions/<code>`. The SDKs' wording is for developers, so users get these instead.
 */
const SDK_MESSAGES: Record<string, string> = {
  unavailable: UNREACHABLE,
  'deadline-exceeded': 'This is taking longer than usual. Check your connection and try again.',
  cancelled: 'The request was interrupted. Please try again.',
  unauthenticated: 'Your session has expired. Please sign in again.',
  'permission-denied': "You don't have access to this.",
  'resource-exhausted': 'Too many requests right now. Please wait a moment and try again.',
  'not-found': "That isn't available right now. Please try again later.",
};

/** What the SDKs put in a callable error when the backend sent no explanation of its own. */
const SDK_PHRASE = /^(backend error status|bad request|request was cancelled|firebase functions instance)/i;
const lettersOf = (text: string) => text.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Our callables explain a failure in a sentence written for the user. The SDKs only name the code
 * ("deadline-exceeded", "INTERNAL", "Permission Denied") or describe the transport.
 */
function isWrittenForUsers(reason: string, text: string): boolean {
  return text !== '' && lettersOf(text) !== lettersOf(reason) && !SDK_PHRASE.test(text);
}

/** Human-readable message for Firebase Auth, Functions and Firestore errors. */
export function describeError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!error || typeof error !== 'object') return fallback;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== 'string') return fallback;
  const authMessage = AUTH_MESSAGES[code];
  if (authMessage) return authMessage;
  if (!code.startsWith('functions/')) return SDK_MESSAGES[code] ?? fallback;

  const reason = code.slice('functions/'.length);
  const raw = typeof message === 'string' ? message : '';
  // "internal" never explains itself to users. Status 0 means no response arrived at all.
  if (reason === 'internal') return /\[0\]$/.test(raw) ? UNREACHABLE : fallback;
  // Newer SDKs append the HTTP status ("… [400]"); users don't need it.
  const text = raw.replace(/\s*\[\d{3}\]$/, '');
  return isWrittenForUsers(reason, text) ? text : (SDK_MESSAGES[reason] ?? fallback);
}
