import { isRouteErrorResponse, useRouteError } from 'react-router';

import { Button } from '@/components/ui/Button';
import { ErrorIcon, RefreshIcon } from '@/components/ui/icons';

function messageOf(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`;
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
}

/** A new deploy replaced the chunk this tab still points at: a reload fetches the new one. */
function isStaleChunk(error: unknown): boolean {
  return (
    error instanceof Error &&
    /dynamically imported module|Importing a module script failed/i.test(error.message)
  );
}

/**
 * Shown when a route fails to load or render. `inline` renders inside the layout, so one broken page
 * keeps the sidebar and header (verified defect R40); the full-page version is the last resort.
 */
export function RouteError({ inline = false }: { inline?: boolean }) {
  const error = useRouteError();
  const stale = isStaleChunk(error);
  const body = (
    <div className="max-w-md text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-rose-50 text-rose-600">
        <ErrorIcon size={22} aria-hidden />
      </div>
      <h1 className="mt-4 text-lg font-semibold text-slate-900">
        {stale ? 'A new version is available' : 'Something went wrong'}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {stale ? 'Reload the page to continue.' : messageOf(error)}
      </p>
      <Button className="mt-6" icon={RefreshIcon} onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
  if (inline) return <div className="grid min-h-80 place-items-center p-6">{body}</div>;
  return <div className="grid min-h-dvh place-items-center bg-slate-50 p-6">{body}</div>;
}
