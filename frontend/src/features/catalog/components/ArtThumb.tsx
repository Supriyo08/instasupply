import { useState } from 'react';

import { NoImageIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

import { artSrc } from '../art';
import { normalizeHex } from '../category-form';

const SIZES = {
  sm: { box: 'size-10', icon: 16 },
  md: { box: 'size-12', icon: 18 },
  lg: { box: 'size-16', icon: 22 },
  xl: { box: 'size-28', icon: 30 },
};

/**
 * An uploaded photo (preferred, like the shop) or an illustration on its category tint, with a
 * neutral placeholder when there is neither. Decorative: the name is always shown next to it.
 */
export function ArtThumb({
  artKey,
  imageUrl,
  tint,
  size = 'sm',
  shape = 'square',
  className,
}: {
  artKey: string | null | undefined;
  imageUrl?: string | null;
  tint?: string | null;
  size?: keyof typeof SIZES;
  shape?: 'square' | 'circle';
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const photo = imageUrl && imageUrl !== failedUrl ? imageUrl : null;
  const src = photo ?? artSrc(artKey);
  const background = normalizeHex(tint);

  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden',
        SIZES[size].box,
        shape === 'circle' ? 'rounded-full' : size === 'sm' ? 'rounded-lg' : 'rounded-xl',
        !background && 'bg-slate-100',
        className,
      )}
      style={background ? { backgroundColor: background } : undefined}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className={photo ? 'h-full w-full object-cover' : 'h-4/5 w-4/5 object-contain'}
          onError={photo ? () => setFailedUrl(photo) : undefined}
        />
      ) : (
        <NoImageIcon size={SIZES[size].icon} className="text-slate-400" />
      )}
    </span>
  );
}
