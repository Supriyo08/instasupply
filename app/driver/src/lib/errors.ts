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

/** Human-readable message for Firebase Auth, Functions and Firestore errors. */
export function describeError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!error || typeof error !== 'object') return fallback;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === 'string') {
    if (AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
    // Callable errors (functions/<code>) carry a message written for users by the backend.
    if (code.startsWith('functions/') && typeof message === 'string' && code !== 'functions/internal') {
      // Newer SDKs append the HTTP status ("… [400]"); users don't need it.
      return message.replace(/\s*\[\d{3}\]$/, '');
    }
    if (code === 'unavailable' || code === 'functions/unavailable') {
      return "Can't reach the server. Check your connection and try again.";
    }
    if (code === 'permission-denied') return "You don't have access to this.";
  }
  return fallback;
}
