import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Construction illustrations from @instasupply/art for the ops screens (dashboard, jobs, deliveries,
 * payouts, tracking). The art bundle is large, so it is loaded once, on demand, in its own chunk:
 * the screens render at once and the picture fades in.
 */
type ArtModule = { artDataUri: (key: string | null | undefined) => string | null };

let artModule: Promise<ArtModule> | null = null;
const loadArt = () => (artModule ??= import('@instasupply/art'));

export function useArtSrc(artKey: string): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadArt().then(
      (art) => {
        if (live) setSrc(art.artDataUri(artKey));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [artKey]);
  return src;
}

/** Decorative: the text beside it says the same thing, so it is hidden from screen readers. */
export function SceneArt({ artKey, className }: { artKey: string; className?: string }) {
  const src = useArtSrc(artKey);
  return (
    <span className={cn('inline-block', className)} aria-hidden>
      {src ? <img src={src} alt="" className="size-full animate-fade-in object-contain" /> : null}
    </span>
  );
}

/** An empty state with a scene instead of an icon. */
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
      {description ? <div className="mt-1 max-w-sm text-sm text-slate-500">{description}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
