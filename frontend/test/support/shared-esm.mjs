/**
 * Node module hooks for the console's tests only (Vite bundles the app and needs none of this).
 *
 * packages/shared ships TypeScript source and its package.json has no "type", so Node and tsx treat its
 * files as CommonJS. The console is ESM, and Node's CommonJS interop cannot see the names behind the
 * `export * from './x'` lines of shared's index. These hooks tell the loader that shared's .ts files are
 * ES modules; tsx then compiles them as such. Same approach as the backend's dev hooks.
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
