import { isValidEmail } from '@instasupply/shared';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Field, TextInput } from '@/components/ui/Form';
import { WarningIcon } from '@/components/ui/icons';
import { api } from '@/lib/api';
import { env } from '@/lib/env';

import { authErrorMessage } from './auth-errors';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './AuthProvider';

/** Where a signed-in user goes: the page they came from when it belongs to their side, else their home. */
function landingFor(isSupplier: boolean, from: string | undefined): string {
  if (!from) return isSupplier ? '/portal' : '/';
  const portal = from === '/portal' || from.startsWith('/portal/');
  if (isSupplier) return portal ? from : '/portal';
  return portal ? '/' : from;
}

export default function LoginPage() {
  const { status, rejection, clearRejection, isSupplier } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'signed_in') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={landingFor(isSupplier, from)} replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    clearRejection();
    if (!isValidEmail(email.trim())) return setError('Enter a valid email address.');
    if (!password) return setError('Enter your password.');
    setError(null);
    setBusy(true);
    try {
      // The provider decides what happens next: staff and suppliers are let in, others refused (§2.7).
      await api.session.signIn({ email: email.trim(), password });
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const message = error ?? rejection;

  return (
    <AuthLayout title="Sign in" subtitle="Ops staff and supplier teams.">
      <form className="mt-8 space-y-4" onSubmit={onSubmit} noValidate>
        <Field label="Work email">
          {(id) => (
            <TextInput
              id={id}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              autoFocus
            />
          )}
        </Field>
        <Field label="Password">
          {(id) => (
            <TextInput
              id={id}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
            />
          )}
        </Field>

        {message ? (
          <Callout tone="warning" icon={WarningIcon}>
            {message}
          </Callout>
        ) : null}

        <Button type="submit" size="lg" className="w-full" loading={busy || status === 'loading'}>
          Sign in
        </Button>
        <Link
          to={email.trim() ? `/reset-password?email=${encodeURIComponent(email.trim())}` : '/reset-password'}
          onClick={clearRejection}
          className="block w-full text-center text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          Forgot password?
        </Link>
      </form>

      {env.dev ? (
        <div className="mt-10 rounded-xl border border-dashed border-slate-300 p-4 text-xs text-slate-600">
          <p className="font-semibold text-slate-800">Demo accounts (seed --demo)</p>
          <p className="mt-1">
            Ops: admin@instasupply.test, dispatch@instasupply.test. Supplier: kestrel@instasupply.test.
            Password: the seed password (development default <code>Instasupply@123</code>).
          </p>
        </div>
      ) : null}
    </AuthLayout>
  );
}
