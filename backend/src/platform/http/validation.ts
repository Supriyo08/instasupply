import type { z } from 'zod';
import { ApiError } from './errors';

/** zod issues → invalid-argument with details.fields = { "<path>": "<message>" } (§4.2). */
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '(body)';
    fields[key] ??= issue.message;
  }
  const first = result.error.issues[0];
  const message = first
    ? first.path.length > 0
      ? `${first.path.join('.')}: ${first.message}`
      : first.message
    : 'Invalid request.';
  throw new ApiError('invalid-argument', message, null, { fields });
}
