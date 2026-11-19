import { isRouteErrorResponse, useRouteError } from 'react-router';

import { Button } from '@/components/ui/Button';
import { ErrorIcon, RefreshIcon } from '@/components/ui/icons';

/** Shown when a route fails to load or render (e.g. a stale chunk after a deploy). */
export function RouteError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : 'Unexpected error';

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-rose-50 text-rose-600">
          <ErrorIcon size={22} aria-hidden />
        </div>
        <h1 className="mt-4 text-lg font-semibold text-slate-900">Something went wrong</h1>
        <p className="mt-1 text-sm text-slate-500">{message}</p>
        <Button className="mt-6" icon={RefreshIcon} onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  );
}
