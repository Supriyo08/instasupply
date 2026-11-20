import { useApiMutation, useLiveQuery } from '@instasupply/api-client/react';
import { formatDateTimeET, formatRelativeTime } from '@instasupply/shared';
import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorState, Spinner } from '@/components/ui/Feedback';
import { DeviceIcon, SignOutIcon } from '@/components/ui/icons';
import { useToast } from '@/components/ui/Toast';
import { queries } from '@/lib/api';
import { useNow } from '@/lib/data';

const APP_LABEL = { customer: 'Customer app', driver: 'Driver app', console: 'Console' };
const PLATFORM_LABEL = { ios: 'iPhone', android: 'Android', web: 'Web' };

/**
 * An account's signed-in devices (`GET /users/{uid}/sessions`, admin) and "Sign out everywhere"
 * (`POST …/sessions/revoke-all`): the account stays usable, every device has to sign in again.
 */
export function SessionsPanel({ uid, name, self = false }: { uid: string; name: string; self?: boolean }) {
  const now = useNow();
  const toast = useToast();
  const sessions = useLiveQuery(queries.userSessions(uid));
  const [confirming, setConfirming] = useState(false);
  const revoke = useApiMutation((api) => api.users.revokeSessions(uid));

  if (sessions.loading && sessions.data.length === 0) return <Spinner label="Loading devices" />;
  if (sessions.error && sessions.data.length === 0) {
    return <ErrorState error={sessions.error} onRetry={sessions.retry} title="Couldn't load the devices" />;
  }

  return (
    <div className="space-y-3">
      {sessions.data.length === 0 ? (
        <p className="text-sm text-slate-500">Not signed in on any device.</p>
      ) : (
        <ul className="divide-y divide-slate-100" aria-label={`Devices ${name} is signed in on`}>
          {sessions.data.map((session) => (
            <li key={session.id} className="flex items-center gap-3 py-2 text-sm">
              <DeviceIcon size={16} className="shrink-0 text-slate-400" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-800">
                  {session.deviceName ?? APP_LABEL[session.app]}
                  {session.platform ? ` · ${PLATFORM_LABEL[session.platform]}` : ''}
                </span>
                <span className="block text-xs text-slate-500">
                  {APP_LABEL[session.app]} · signed in {formatDateTimeET(session.createdAt, now)} · last used{' '}
                  {formatRelativeTime(session.lastUsedAt, now)}
                </span>
              </span>
              {session.current ? <Badge tone="brand">This device</Badge> : null}
            </li>
          ))}
        </ul>
      )}
      {sessions.data.length > 0 && !self ? (
        <Button size="sm" variant="secondary" icon={SignOutIcon} onClick={() => setConfirming(true)}>
          Sign out everywhere
        </Button>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Sign ${name} out everywhere?`}
        description="Every device has to sign in again. The account stays active; to stop access, suspend it."
        confirmLabel="Sign out everywhere"
        tone="danger"
        onConfirm={async () => {
          await revoke.run();
          toast.success(`${name} was signed out everywhere`);
        }}
      />
    </div>
  );
}
