/**
 * The one way to pass a value to a `jsonb` parameter (with a `::jsonb` cast in the SQL). node-postgres turns
 * a JavaScript array into a PostgreSQL array literal, which is wrong for a jsonb column.
 */
export const jsonb = (value: unknown): string => JSON.stringify(value);
