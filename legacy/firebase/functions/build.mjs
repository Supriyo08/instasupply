// Bundles the functions with esbuild so `@instasupply/shared` (a TypeScript workspace package)
// is inlined. Runtime dependencies stay external and are installed by Cloud Build at deploy time.
import path from 'node:path';

import { build, context } from 'esbuild';

// Resolve paths from this file so the build works from any working directory.
const here = import.meta.dirname;

const options = {
  entryPoints: [path.join(here, 'src/index.ts')],
  outfile: path.join(here, 'lib/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
  external: ['firebase-admin', 'firebase-admin/*', 'firebase-functions', 'firebase-functions/*'],
};

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching functions for changes…');
} else {
  await build(options);
}
