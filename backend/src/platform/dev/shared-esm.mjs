/**
 * Node module hooks for development and tests only (never part of the bundle).
 *
 * packages/shared ships TypeScript source and its package.json has no "type", so Node and tsx treat its
 * files as CommonJS. The backend is ESM, and Node's CommonJS interop cannot see the names behind the
 * `export * from './x'` lines of shared's index, so every named import from '@instasupply/shared' fails at
 * run time. These hooks tell the loader that shared's .ts files are ES modules; tsx then compiles them as
 * such. The production bundle inlines shared with esbuild and does not need this. (docs/PLATFORM.md §2.5
 * assumed "nothing to configure"; see the platform report.)
 */
const SHARED = '/packages/shared/src/';

const isShared = (url) => url.startsWith('file:') && url.includes(SHARED) && url.endsWith('.ts');

export async function resolve(specifier, context, next) {
  const result = await next(specifier, context);
  return isShared(result.url) ? { ...result, format: 'module' } : result;
}

export async function load(url, context, next) {
  return next(url, isShared(url) ? { ...context, format: 'module' } : context);
}
