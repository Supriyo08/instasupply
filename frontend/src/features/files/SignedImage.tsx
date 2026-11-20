import { useFileUrl } from '@instasupply/api-client/react';
import type { ImgHTMLAttributes } from 'react';

import { Skeleton } from '@/components/ui/Feedback';
import { NoImageIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';

/**
 * An image from private storage (delivery proofs, issue photos, quote attachments): the short-lived
 * URL comes from `useFileUrl`, which refetches it before it expires (CLIENTS §1.8).
 */
export function SignedImage({
  path,
  alt,
  className,
  ...props
}: { path: string | null | undefined; alt: string } & Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'alt'
>) {
  const file = useFileUrl(path);
  if (!path) return null;
  if (file.loading) return <Skeleton className={cn('aspect-video w-full', className)} />;
  if (!file.url) {
    return (
      <button
        type="button"
        onClick={file.retry}
        className={cn(
          'grid aspect-video w-full place-items-center rounded-lg bg-slate-100 text-xs text-slate-500',
          className,
        )}
      >
        <span className="flex flex-col items-center gap-1">
          <NoImageIcon size={18} aria-hidden />
          Couldn't load the image. Try again
        </span>
      </button>
    );
  }
  return <img src={file.url} alt={alt} className={className} {...props} />;
}
