import { toApiError } from '@instasupply/api-client';
import { isStrongPassword } from '@instasupply/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Callout, PageSpinner } from '@/components/ui/Feedback';
import { Field, TextInput } from '@/components/ui/Form';
import { WarningIcon } from '@/components/ui/icons';
import { api } from '@/lib/api';

import { authErrorMessage } from './auth-errors';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './AuthProvider';

interface Invite {
  email: string;
  displayName: string;
  role: string;
  expiresAt: number;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'administrator',
  dispatcher: 'dispatcher',
  supplier: 'supplier team member',
};

/**
 * Read the invite token once from the fragment (`#token=isp_…`, never sent to any server) and remove it
 * from the address bar and history right away (CLIENTS §2.7, PLATFORM §6.3.8).
 */
function takeTokenFromHash(): string | null {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
  const token = new URLSearchParams(hash).get('token');
  if (window.location.hash) {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }
  return token && token.startsWith('isp_') ? token : null;
}

const holder: { token?: string | null } = {};

export default function SetPasswordPage() {
  const { status, isSupplier } = useAuth();
  // Kept outside React state so StrictMode's second mount still sees the token it already removed.
  const [token] = useState(() => (holder.token ??= takeTokenFromHash()));
  const [invite, setInvite] = useState<Invite | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.session
      .inspectInvite(token)
      .then((info) => !cancelled && setInvite(info))
      .catch((caught: unknown) => {
        if (cancelled) return;
        setInviteError(
          toApiError(caught).status === 'not-found'
            ? 'This link was already used or has expired. Ask whoever invited you for a new one.'
            : authErrorMessage(caught),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (done && status === 'signed_in') return <Navigate to={isSupplier ? '/portal' : '/'} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    const strength = isStrongPassword(password);
    if (!strength.ok) return setError(strength.message ?? 'Choose a stronger password.');
    if (password !== confirm) return setError("The two passwords don't match.");
    setError(null);
    setBusy(true);
    try {
      await api.session.setUpPassword({ token, password });
      holder.token = null;
      setDone(true);
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const failure = !token ? 'This page needs the link from your invitation email.' : inviteError;

  return (
    <AuthLayout title="Set your password" subtitle="Finish setting up your InstaSupply account.">
      {failure ? (
        <div className="mt-8 space-y-4">
          <Callout tone="warning" icon={WarningIcon}>
            {failure}
          </Callout>
          <Link
            to="/login"
            className="block text-center text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            Go to sign in
          </Link>
        </div>
      ) : !invite ? (
        <PageSpinner label="Checking your link" />
      ) : (
        <form className="mt-8 space-y-4" onSubmit={submit} noValidate>
          <p className="text-sm text-slate-600">
            {invite.displayName}, you're joining as {ROLE_LABELS[invite.role] ?? invite.role} with{' '}
            <span className="font-medium text-slate-900">{invite.email}</span>.
          </p>
          <Field label="Password" hint="At least 8 characters, with letters and a number.">
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoFocus
              />
            )}
          </Field>
          <Field label="Confirm password">
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            )}
          </Field>
          {error ? (
            <Callout tone="warning" icon={WarningIcon}>
              {error}
            </Callout>
          ) : null}
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Set password and sign in
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
