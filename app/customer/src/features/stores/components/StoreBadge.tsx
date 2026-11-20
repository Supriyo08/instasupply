import { StatusPill } from '@/components/ui';
import type { StatusTone } from '@/theme/tokens';

/** `storeAvailability().badge` ("Onboarding now", "Coming soon", "Paused", "Closed · opens 7:00 am"). */
export function StoreBadge({ badge, size = 'sm' }: { badge: string | null; size?: 'sm' | 'md' }) {
  if (!badge) return null;
  const tone: StatusTone = badge === 'Paused' ? 'warning' : badge.startsWith('Closed') ? 'neutral' : 'info';
  return <StatusPill label={badge} tone={tone} size={size} />;
}
