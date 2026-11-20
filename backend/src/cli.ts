/**
 * Command-line entry → dist/cli.js (docs/PLATFORM.md §2.6): migrate | create-admin | seed | storage-cors |
 * revoke-sessions. Each command loads the same configuration as the server and exits 0 or 1.
 */
import { ConfigError, loadConfig } from './config/env';
import { runCreateAdmin } from './cli/create-admin';
import { runMigrate } from './cli/migrate';
import { runRevokeSessions } from './cli/revoke-sessions';
import { runSeed } from './cli/seed';
import { runStorageCors } from './cli/storage-cors';

const USAGE = `usage: cli <command>
  migrate [--status]                     apply pending migrations and reference data
  create-admin --email <e> --name <n>    create the first administrator, print a set-password link
  revoke-sessions --email <e>            sign one account out everywhere
  storage-cors                           set the bucket's CORS rule from CORS_ORIGINS
  seed --demo [--reset] [--at <ISO>]     demo stores, products, accounts and orders`;

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (!command || command === '--help' || command === 'help') {
    console.info(USAGE);
    return command ? 0 : 1;
  }
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
  for (const warning of config.warnings) console.warn(`warning: ${warning}`);
  switch (command) {
    case 'migrate':
      return runMigrate(config, args);
    case 'create-admin':
      return runCreateAdmin(config, args);
    case 'revoke-sessions':
      return runRevokeSessions(config, args);
    case 'storage-cors':
      return runStorageCors(config);
    case 'seed':
      return runSeed(config, args);
    default:
      console.error(`unknown command "${command}"\n${USAGE}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
