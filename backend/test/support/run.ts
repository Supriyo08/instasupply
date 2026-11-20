/**
 * `npm test` (docs/PLATFORM.md §12.1): sweep stale test databases, build this run's migrated template,
 * run every test file under Node's test runner with TEST_RUN set, then drop every database of the run.
 *
 *   npm --workspace @instasupply/backend run test                      every test/**\/*.test.ts
 *   npm --workspace @instasupply/backend run test -- test/auth         only these files or folders
 *
 * TEST_CONCURRENCY (default 4) is the number of files that run at once.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTemplate,
  dropDatabasesWithPrefix,
  dropOrphanedDatabases,
  dropStaleDatabases,
  newRunName,
} from './db-admin';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function testFiles(targets: string[]): string[] {
  const found: string[] = [];
  const walk = (entry: string) => {
    const stat = statSync(entry);
    if (stat.isDirectory()) {
      for (const name of readdirSync(entry).sort()) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        walk(path.join(entry, name));
      }
    } else if (entry.endsWith('.test.ts')) {
      found.push(path.relative(backendRoot, entry));
    }
  };
  for (const target of targets.length > 0 ? targets : ['test']) walk(path.resolve(backendRoot, target));
  return found;
}

const say = (message: string): void => {
  process.stdout.write(`[test-run] ${message}\n`);
};

async function main(): Promise<number> {
  const files = testFiles(process.argv.slice(2).filter((arg) => !arg.startsWith('-')));
  if (files.length === 0) {
    say('no test files found');
    return 1;
  }
  const stale = [...(await dropStaleDatabases()), ...(await dropOrphanedDatabases())];
  if (stale.length > 0) say(`dropped ${stale.length} database(s) left over by crashed runs`);

  const run = newRunName();
  let child: ChildProcess | null = null;
  let cleaned: Promise<void> | null = null;
  const cleanup = () => {
    cleaned ??= (async () => {
      try {
        const dropped = await dropDatabasesWithPrefix(run);
        // Every file process of this run has exited by now, so whatever they left is an orphan.
        const orphans = await dropOrphanedDatabases();
        say(`dropped ${dropped.length + orphans.length} database(s) of ${run}`);
      } catch (error) {
        say(`could not drop the databases of ${run}: ${String(error)}`);
      }
    })();
    return cleaned;
  };
  let interrupted: NodeJS.Signals | null = null;
  const onSignal = (signal: NodeJS.Signals) => {
    interrupted = signal;
    // The child gets the signal too when it shares the terminal; forwarding covers CI and wrappers.
    child?.kill(signal);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    const started = Date.now();
    await createTemplate(run);
    say(`template ${run}_tpl ready in ${Date.now() - started} ms; ${files.length} file(s)`);
    const concurrency = process.env.TEST_CONCURRENCY ?? '4';
    const code = await new Promise<number>((resolve, reject) => {
      child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          // Loads @instasupply/shared as ESM under tsx (see src/platform/dev/register.mjs).
          '--import',
          './src/platform/dev/register.mjs',
          '--test',
          `--test-concurrency=${concurrency}`,
          ...files,
        ],
        {
          cwd: backendRoot,
          stdio: 'inherit',
          env: { ...process.env, NODE_ENV: 'test', TEST_RUN: run },
        },
      );
      child.on('error', reject);
      child.on('exit', (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
    });
    return interrupted ? 130 : code;
  } finally {
    await cleanup();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    process.stderr.write(
      `[test-run] ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(1);
  },
);
