import { isValidEmail } from '@instasupply/shared';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Field, TextInput } from '@/components/ui/Form';
import { InfoIcon, LiveIcon, RouteIcon, ShieldIcon, WarningIcon } from '@/components/ui/icons';
import { env } from '@/lib/env';
import { errorMessage } from '@/lib/firebase/callables';
import { auth } from '@/lib/firebase/services';

import { useAuth } from './AuthProvider';
import { BrandMark } from './BrandMark';

const HIGHLIGHTS = [
  { icon: LiveIcon, title: 'Live fleet tracking', text: 'See every driver move in real time.' },
  { icon: RouteIcon, title: 'Optimized routes', text: 'Traffic-aware multi-stop planning.' },
  { icon: ShieldIcon, title: 'Proof of delivery', text: 'Photos, hand-off codes and COD records.' },
];

export default function LoginPage() {
  const { status, rejection, clearRejection } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'signed_in') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    clearRejection();
    setNotice(null);
    if (!isValidEmail(email)) return setError('Enter a valid email address.');
    if (!password) return setError('Enter your password.');
    setError(null);
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const onForgot = async () => {
    clearRejection();
    if (!isValidEmail(email)) return setError('Enter your email above first, then choose "Forgot password".');
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice(`If an account exists for ${email.trim()}, a reset link is on its way.`);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const message = error ?? rejection;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-brand-950 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.45),transparent_55%),radial-gradient(circle_at_80%_70%,rgba(16,185,129,0.25),transparent_50%)]" />
        <div className="relative flex items-center gap-3">
          <BrandMark className="size-10" />
          <span className="text-lg font-semibold tracking-tight">InstaSupply Dispatch</span>
        </div>
        <div className="relative mt-auto max-w-md">
          <h1 className="text-4xl leading-tight font-semibold tracking-tight">
            Every delivery, every driver, in one live view.
          </h1>
          <ul className="mt-10 space-y-5">
            {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Icon size={18} aria-hidden />
                </span>
                <span>
                  <span className="block font-medium">{title}</span>
                  <span className="text-sm text-brand-200">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark className="size-9" />
            <span className="text-lg font-semibold tracking-tight">InstaSupply Dispatch</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use your dispatch team account.</p>

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
            {notice ? (
              <Callout tone="success" icon={InfoIcon}>
                {notice}
              </Callout>
            ) : null}

            <Button type="submit" size="lg" className="w-full" loading={busy || status === 'loading'}>
              Sign in
            </Button>
            <button
              type="button"
              onClick={onForgot}
              className="w-full text-center text-sm font-medium text-brand-600 hover:text-brand-700"
            >
              Forgot password?
            </button>
          </form>

          {env.useEmulators ? (
            <div className="mt-10 rounded-xl border border-dashed border-slate-300 p-4 text-xs text-slate-600">
              <p className="font-semibold text-slate-800">Local emulator accounts</p>
              <p className="mt-1">
                admin@instasupply.test or dispatch@instasupply.test, password <code>Instasupply@123</code>
              </p>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
