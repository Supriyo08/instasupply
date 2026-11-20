import type { ReactNode } from 'react';

import { Card } from './Card';
import { PlaceholderIcon } from './icons';
import { PageHeader } from './Layout';

/**
 * Stand-in for a route whose screen is still being built. Each placeholder names the spec rows the
 * screen implements, so the route, its guard and its sidebar entry work before the screen does.
 * Screen builders replace the whole file (frontend/CONVENTIONS.md).
 */
export function ScreenPlaceholder({
  title,
  spec,
  back,
  children,
}: {
  title: string;
  /** For example "MARKETPLACE §9 /stores; CLIENTS §4.5". */
  spec: string;
  back?: { to: string; label: string };
  children?: ReactNode;
}) {
  return (
    <div>
      <PageHeader title={title} back={back} />
      <Card className="flex items-start gap-4 p-6">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600">
          <PlaceholderIcon size={20} aria-hidden />
        </div>
        <div className="text-sm">
          <p className="font-semibold text-slate-900">This screen is being built</p>
          <p className="mt-1 text-slate-500">Specification: {spec}</p>
          {children ? <div className="mt-3 text-slate-600">{children}</div> : null}
        </div>
      </Card>
    </div>
  );
}
