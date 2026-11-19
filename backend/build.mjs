// Bundles the server and the CLI (docs/PLATFORM.md §2.5). @instasupply/shared is TypeScript source with
// extension-less imports, so it is inlined; every other dependency stays external and comes from node_modules.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const here = import.meta.dirname;
const pkg = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));
const external = Object.keys(pkg.dependencies)
  .filter((name) => name !== '@instasupply/shared')
  .flatMap((name) => [name, `${name}/*`]);

await build({
  entryPoints: { server: path.join(here, 'src/server.ts'), cli: path.join(here, 'src/cli.ts') },
  outdir: path.join(here, 'dist'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
  external,
});
