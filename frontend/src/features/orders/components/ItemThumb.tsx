/**
 * Product thumbnail for order, quote and issue lines: the uploaded photo, else the product's
 * construction illustration from @instasupply/art, else its category icon; plus the construction scenes
 * of the empty states. The art bundle is large: the dashboard and the delivery screens never import it.
 */
import { artDataUri } from '@instasupply/art';
import { CATEGORIES, type CategoryId } from '@instasupply/shared';
import { useMemo, useState, type ReactNode } from 'react';

import { NoImageIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

export interface ThumbSource {
  imageUrl?: string | null;
  imageKey?: string | null;
  categoryId?: CategoryId | null;
}

export function ItemThumb({ item, size = 'md' }: { item: ThumbSource; size?: 'sm' | 'md' }) {
  const sources = useMemo(() => {
    const category = item.categoryId ? CATEGORIES[item.categoryId] : undefined;
    return [item.imageUrl, artDataUri(item.imageKey), artDataUri(category?.iconKey)].filter(
      (src): src is string => !!src,
    );
  }, [item.categoryId, item.imageKey, item.imageUrl]);
  // A broken photo or an unknown key (the art set changes over time) falls through to the next one.
  const [failures, setFailures] = useState(0);
  const src = sources[failures];

  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-50 ring-1 ring-slate-200/70',
        size === 'sm' ? 'size-9' : 'size-12',
      )}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className={src.startsWith('data:') ? 'size-full object-contain p-1' : 'size-full object-cover'}
          onError={() => setFailures((count) => count + 1)}
        />
      ) : (
        <NoImageIcon size={18} className="text-slate-300" aria-hidden />
      )}
    </span>
  );
}

/** A full-size scene from @instasupply/art for empty states ("scene-material-list", …). */
export function SceneArt({ artKey, className }: { artKey: string; className?: string }) {
  const src = useMemo(() => artDataUri(artKey), [artKey]);
  if (!src) return null;
  return <img src={src} alt="" aria-hidden className={cn('mx-auto h-32 w-auto', className)} />;
}

/** Empty state with a construction scene instead of an icon (lists, inboxes, queues). */
export function ArtEmptyState({
  artKey,
  title,
  description,
  action,
}: {
  artKey: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <SceneArt artKey={artKey} className="mb-4 h-28" />
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
