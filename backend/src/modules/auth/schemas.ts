/** zod schemas of the auth requests (docs/PLATFORM.md §5.3.2, §6.3). Strict: an unknown key is invalid-argument. */
import {
  isStrongPassword,
  isValidEmail,
  type CreateStaffUserRequest,
  type InviteSupplierUserRequest,
  type LoginRequest,
  type RegisterRequest,
  type RequestPhoneOtpRequest,
  type SetSupplierUserStatusRequest,
  type SetupPasswordRequest,
  type UserStatusPatch,
  type VerifyPhoneOtpRequest,
} from '@instasupply/shared';
import { z } from 'zod';
import { MAX_PASSWORD_LENGTH } from '../../platform/auth/passwords';

/** Trimmed, whitespace collapsed, at most `max` characters (the legacy cleanText). */
export const cleanText = (min: number, max: number) =>
  z
    .string()
    .transform((value) => value.trim().replace(/\s+/g, ' '))
    .pipe(z.string().min(min).max(max));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((value) => isValidEmail(value), 'Enter a valid email address.');

/** Any password for sign-in; strength is only judged when one is chosen. */
export const passwordSchema = z.string().min(1, 'Enter your password.').max(MAX_PASSWORD_LENGTH);

export const newPasswordSchema = z
  .string()
  .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters.`)
  .superRefine((value, ctx) => {
    const verdict = isStrongPassword(value);
    if (!verdict.ok)
      ctx.addIssue({ code: 'custom', message: verdict.message ?? 'Choose a stronger password.' });
  });

export const installationIdSchema = z.string().trim().min(8).max(80);
export const appSchema = z.enum(['customer', 'driver', 'console']);

export const RegisterRequestSchema = z
  .object({
    email: emailSchema,
    password: newPasswordSchema,
    displayName: z
      .string()
      .transform((value) => value.trim().replace(/\s+/g, ' '))
      .pipe(z.string().max(80)),
    installationId: installationIdSchema,
    app: z.enum(['customer', 'driver'], { message: 'Sign up in the customer or the driver app.' }),
  })
  .strict() satisfies z.ZodType<RegisterRequest>;

export const LoginRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    installationId: installationIdSchema,
    app: appSchema,
  })
  .strict() satisfies z.ZodType<LoginRequest>;

export const RefreshRequestSchema = z.object({ refreshToken: z.string().min(1).max(200) }).strict();

export const ForgotRequestSchema = z.object({ email: emailSchema }).strict();

export const ResetRequestSchema = z
  .object({ email: emailSchema, code: z.string().trim().max(12), newPassword: newPasswordSchema })
  .strict();

export const ChangeRequestSchema = z
  .object({ currentPassword: passwordSchema, newPassword: newPasswordSchema })
  .strict();

export const InspectRequestSchema = z.object({ token: z.string().min(1).max(200) }).strict();

export const SetupPasswordRequestSchema = z
  .object({
    token: z.string().min(1).max(200),
    password: newPasswordSchema,
    installationId: installationIdSchema,
    app: appSchema,
  })
  .strict() satisfies z.ZodType<SetupPasswordRequest>;

export const CreateStaffUserRequestSchema = z
  .object({ email: emailSchema, displayName: cleanText(1, 80), role: z.enum(['admin', 'dispatcher']) })
  .strict() satisfies z.ZodType<CreateStaffUserRequest>;

export const InviteSupplierUserRequestSchema = z
  .object({
    storeId: z.string().trim().min(1).max(40),
    email: emailSchema,
    displayName: cleanText(1, 80),
    storeRole: z.enum(['owner', 'staff']),
  })
  .strict() satisfies z.ZodType<InviteSupplierUserRequest>;

export const SetSupplierUserStatusRequestSchema = z
  .object({
    uid: z.string().min(1).max(100),
    status: z.enum(['active', 'suspended']),
    reason: cleanText(1, 200).nullable().optional(),
  })
  .strict() satisfies z.ZodType<SetSupplierUserStatusRequest>;

export const UserStatusPatchSchema = z
  .object({ status: z.enum(['active', 'suspended']), reason: cleanText(1, 200).nullable() })
  .strict()
  .refine((value) => value.status !== 'suspended' || value.reason !== null, {
    message: 'Give a reason for the suspension.',
    path: ['reason'],
  }) satisfies z.ZodType<UserStatusPatch>;

export const RequestPhoneOtpRequestSchema = z
  .object({ phoneNumber: z.string().trim().min(1).max(40) })
  .strict() satisfies z.ZodType<RequestPhoneOtpRequest>;

export const VerifyPhoneOtpRequestSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Enter the 6-digit code.'),
  })
  .strict() satisfies z.ZodType<VerifyPhoneOtpRequest>;
