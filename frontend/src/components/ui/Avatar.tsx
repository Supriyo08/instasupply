import { initials } from '@instasupply/shared';

import { cn } from '@/lib/cn';

const PALETTE = [
  'bg-indigo-100 text-indigo-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-800',
  'bg-sky-100 text-sky-700',
  'bg-rose-100 text-rose-700',
  'bg-violet-100 text-violet-700',
  'bg-teal-100 text-teal-700',
];

/** Stable colour per name, so a person always looks the same across screens. */
export function colorIndex(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  return Math.abs(hash) % PALETTE.length;
}

const PRESENCE = {
  online: 'bg-emerald-500',
  stale: 'bg-amber-400',
  offline: 'bg-slate-300',
};

export function Avatar({
  name,
  size = 'md',
  presence,
  className,
}: {
  name: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  presence?: keyof typeof PRESENCE;
  className?: string;
}) {
  const label = name || 'Unknown';
  const sizes = { sm: 'size-7 text-[11px]', md: 'size-9 text-xs', lg: 'size-14 text-base' };
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <span
        className={cn(
          'grid place-items-center rounded-full font-semibold',
          sizes[size],
          PALETTE[colorIndex(label)],
        )}
        aria-hidden
      >
        {initials(label)}
      </span>
      {presence ? (
        <span
          className={cn(
            'absolute -right-0.5 -bottom-0.5 rounded-full ring-2 ring-white',
            size === 'lg' ? 'size-3.5' : 'size-2.5',
            PRESENCE[presence],
          )}
          title={presence}
        />
      ) : null}
    </span>
  );
}
