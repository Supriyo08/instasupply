import { cleanText, isStrongPassword, isValidEmail } from '@instasupply/shared';

import { parsePhoneInput } from './phone';

export type FieldErrors<Field extends string> = Partial<Record<Field, string>>;

export function validateEmail(value: string): string | undefined {
  if (!value.trim()) return 'Enter your email address.';
  return isValidEmail(value) ? undefined : 'Enter a valid email address.';
}

export function validateName(value: string): string | undefined {
  const name = cleanText(value, 80);
  if (!name) return 'Enter your name.';
  return name.length < 2 ? 'That name looks too short.' : undefined;
}

export function validateNewPassword(value: string): string | undefined {
  if (!value) return 'Create a password.';
  return isStrongPassword(value).message;
}

export interface SignUpForm {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export interface SignUpInput {
  name: string;
  email: string;
  phone: string | null;
  password: string;
}

/** Checks the sign-up form; the phone is optional here and verified on the next screen. */
export function validateSignUp(
  form: SignUpForm,
): { ok: true; value: SignUpInput } | { ok: false; errors: FieldErrors<keyof SignUpForm> } {
  const phone = form.phone.trim() ? parsePhoneInput(form.phone) : null;
  const errors: FieldErrors<keyof SignUpForm> = {
    name: validateName(form.name),
    email: validateEmail(form.email),
    phone: phone?.error,
    password: validateNewPassword(form.password),
  };
  if (Object.values(errors).some(Boolean)) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name: cleanText(form.name, 80) ?? form.name.trim(),
      email: form.email.trim(),
      phone: phone?.phone ?? null,
      password: form.password,
    },
  };
}
