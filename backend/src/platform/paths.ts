import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The `backend/` folder. Source files live at different depths (`src/config/env.ts`) while the bundle puts
 * everything into `dist/server.js`, so the folder is found by walking up to our own package.json instead of
 * counting `..` segments.
 */
export function backendRoot(from: string = import.meta.dirname): string {
  let dir = from;
  for (;;) {
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
      if (pkg.name === '@instasupply/backend') return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('backend/package.json not found above ' + from);
    dir = parent;
  }
}

export const migrationsDir = (): string => path.join(backendRoot(), 'migrations');
