import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The email typed on one auth screen, carried to the next (login → forgot password → sign-up)
 * so nobody types it twice. Kept in memory only.
 */
let draftEmail = '';

export const getDraftEmail = () => draftEmail;

export function setDraftEmail(value: string) {
  draftEmail = value;
}

const REMEMBERED_EMAIL_KEY = 'instasupply.rememberedEmail';

/** "Remember me" keeps the email on this device so the login form is pre-filled next time. */
export async function loadRememberedEmail(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(REMEMBERED_EMAIL_KEY);
  } catch {
    return null;
  }
}

export async function saveRememberedEmail(email: string | null): Promise<void> {
  try {
    if (email) await AsyncStorage.setItem(REMEMBERED_EMAIL_KEY, email);
    else await AsyncStorage.removeItem(REMEMBERED_EMAIL_KEY);
  } catch {
    // Storage can be unavailable (e.g. private browsing); remembering the email is best-effort.
  }
}
