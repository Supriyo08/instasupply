import { isStrongPassword, isValidEmail } from '@instasupply/shared';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';

import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { Field, TextInput } from '@/components/ui/Form';
import { InfoIcon, SuccessIcon, WarningIcon } from '@/components/ui/icons';
import { api } from '@/lib/api';

import { authErrorMessage } from './auth-errors';
import { AuthLayout } from './AuthLayout';

/**
 * Password reset with the 6-digit code the server emails (PLATFORM §6.3.7): ask for the code, then
 * enter it with a new password. `forgot` never reveals whether the account exists.
 */
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'request' | 'reset' | 'done'>('request');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!isValidEmail(email.trim())) return setError('Enter a valid email address.');
    setError(null);
    setBusy(true);
    try {
      await api.session.requestPasswordReset(email.trim());
      setStep('reset');
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const reset = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from the email.');
    const strength = isStrongPassword(password);
    if (!strength.ok) return setError(strength.message ?? 'Choose a stronger password.');
    setError(null);
    setBusy(true);
    try {
      await api.session.resetPassword({ email: email.trim(), code: code.trim(), newPassword: password });
      setStep('done');
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a 6-digit code.">
      {step === 'done' ? (
        <div className="mt-8 space-y-4">
          <Callout tone="success" icon={SuccessIcon} title="Password changed">
            Sign in with your new password. Other devices signed in to this account were signed out.
          </Callout>
          <Link
            to="/login"
            className="block text-center text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            Go to sign in
          </Link>
        </div>
      ) : (
        <form className="mt-8 space-y-4" onSubmit={step === 'request' ? requestCode : reset} noValidate>
          <Field label="Work email">
            {(id) => (
              <TextInput
                id={id}
                type="email"
                autoComplete="username"
                value={email}
                disabled={step === 'reset'}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                autoFocus={step === 'request'}
              />
            )}
          </Field>
          {step === 'reset' ? (
            <>
              <Callout tone="info" icon={InfoIcon}>
                If an account exists for {email.trim()}, a code is on its way. It expires after a short while.
              </Callout>
              <Field label="Code">
                {(id) => (
                  <TextInput
                    id={id}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    autoFocus
                  />
                )}
              </Field>
              <Field label="New password" hint="At least 8 characters, with letters and a number.">
                {(id) => (
                  <TextInput
                    id={id}
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                )}
              </Field>
            </>
          ) : null}
          {error ? (
            <Callout tone="warning" icon={WarningIcon}>
              {error}
            </Callout>
          ) : null}
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            {step === 'request' ? 'Email me a code' : 'Set new password'}
          </Button>
          <div className="flex justify-between text-sm">
            {step === 'reset' ? (
              <button
                type="button"
                className="font-medium text-slate-500 hover:text-slate-700"
                onClick={() => {
                  setStep('request');
                  setError(null);
                }}
              >
                Use another email
              </button>
            ) : (
              <span />
            )}
            <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
              Back to sign in
            </Link>
          </div>
        </form>
      )}
    </AuthLayout>
  );
}
