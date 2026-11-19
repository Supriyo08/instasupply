#!/usr/bin/env node
/**
 * Builds the functions and starts the Firebase Emulator Suite.
 *
 * firebase-tools needs Java 21+. This script finds a suitable JDK (JAVA_HOME, Homebrew, PATH)
 * so you don't have to change your system default Java.
 *
 *   node scripts/emulators.mjs                      # fresh, empty emulators
 *   node scripts/emulators.mjs --persist            # import/export ./.emulator-data between runs
 *   node scripts/emulators.mjs --exec "<command>"   # start, run a command (e.g. tests), stop
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_JAVA = 21;

function javaMajor(javaBinary) {
  const result = spawnSync(javaBinary, ['-version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return 0;
  const match = /version "(\d+)/.exec(`${result.stderr}${result.stdout}`);
  return match ? Number(match[1]) : 0;
}

function findJava() {
  const candidates = [
    process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin', 'java'),
    '/opt/homebrew/opt/openjdk/bin/java',
    '/opt/homebrew/opt/openjdk@25/bin/java',
    '/opt/homebrew/opt/openjdk@21/bin/java',
    '/usr/local/opt/openjdk/bin/java',
    '/usr/local/opt/openjdk@21/bin/java',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate) && javaMajor(candidate) >= MIN_JAVA) return path.dirname(candidate);
  }
  if (javaMajor('java') >= MIN_JAVA) return null; // the default `java` is fine
  console.error(
    `The Firebase emulators need Java ${MIN_JAVA} or newer.\n` +
      '  macOS:  brew install openjdk\n' +
      '  Linux:  install Temurin 21 (https://adoptium.net) or `sudo apt install openjdk-21-jre`',
  );
  process.exit(1);
}

const javaBin = findJava();
const env = { ...process.env };
if (javaBin) {
  env.PATH = `${javaBin}${path.delimiter}${env.PATH}`;
  env.JAVA_HOME = path.dirname(javaBin);
}

const build = spawnSync('npm', ['--workspace', '@instasupply/functions', 'run', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env,
});
if (build.status !== 0) process.exit(build.status ?? 1);

const execIndex = process.argv.indexOf('--exec');
const execCommand = execIndex >= 0 ? process.argv[execIndex + 1] : null;

const args = [
  'firebase',
  execCommand ? 'emulators:exec' : 'emulators:start',
  '--project',
  'demo-instasupply',
  '--only',
  'auth,functions,firestore,storage',
];
if (execCommand) args.push(execCommand);
if (process.argv.includes('--persist')) {
  args.push('--import', './.emulator-data', '--export-on-exit', './.emulator-data');
}

const child = spawn('npx', args, { cwd: root, stdio: 'inherit', env });
const forward = (signal) => child.kill(signal);
process.on('SIGINT', forward);
process.on('SIGTERM', forward);
child.on('exit', (code) => process.exit(code ?? 0));
