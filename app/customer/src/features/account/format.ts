import { formatDate, type TimestampLike } from '@instasupply/shared';
import { router, type Href } from 'expo-router';

/** "+91 98765 43210" for Indian numbers; other E.164 numbers are shown as stored. */
export function displayPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const indian = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return indian ? `+91 ${indian[1]} ${indian[2]}` : phone;
}

/** "Member since 12 Nov 2025", or null when the profile has no creation date yet. */
export function memberSince(createdAt: TimestampLike | undefined): string | null {
  if (!createdAt) return null;
  return `Member since ${formatDate(createdAt)}`;
}

/** Go back to the previous screen, or to `fallback` when the screen was opened directly (web deep link). */
export function leaveTo(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
