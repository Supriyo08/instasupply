import { artDataUri } from '@instasupply/art';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * A construction illustration from @instasupply/art (`scene-*`, `store-*`, product keys). Decorative:
 * the text beside it says the same thing, so it is hidden from screen readers.
 */
export function SceneArt({ artKey, className }: { artKey: string; className?: string }) {
  const src = artDataUri(artKey);
  if (!src) return null;
  return <img src={src} alt="" aria-hidden className={cn('object-contain', className)} />;
}

/** Empty state with an illustration instead of an icon: used where a screen has nothing yet. */
export function SceneEmpty({
  artKey,
  title,
  description,
  action,
  className,
}: {
  artKey: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      <SceneArt artKey={artKey} className="mb-4 h-28 w-40" />
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
