import { formatDate, formatPhone, type TimestampLike } from '@instasupply/shared';
import { router, type Href } from 'expo-router';

/** "(416) 555-0110" for a North American number; others as stored. */
export function displayPhone(phone: string | null | undefined): string {
  return formatPhone(phone);
}

/** "Member since Nov 12, 2025", or null when the profile has no creation date yet. */
export function memberSince(createdAt: TimestampLike | undefined, now: number = Date.now()): string | null {
  if (!createdAt) return null;
  return `Member since ${formatDate(createdAt, now)}`;
}

/** Go back to the previous screen, or to `fallback` when the screen was opened directly (web deep link). */
export function leaveTo(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
