#!/usr/bin/env node
/**
 * Fails when a leftover of the old grocery prototype (India, rupees, cash on delivery) is still in
 * the repository. InstaSupply is a construction-supply marketplace for the Greater Toronto Area:
 * CAD, +1 phones, card payments only. See docs/MARKETPLACE.md §12.7.
 *
 *   node scripts/check-legacy.mjs              # list every match, exit 1 if there is one
 *   node scripts/check-legacy.mjs --summary    # counts per area only
 *   node scripts/check-legacy.mjs apps/driver  # check one folder
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Each pattern is a leftover that must not come back. Word boundaries avoid matching inside other words. */
const PATTERNS = [
  ['₹', /₹/],
  ['INR', /\bINR\b/],
  ['+91', /\+91/],
  ['rupay', /rupay/i],
  ['organic', /\borganic\b/i],
  ['codAmount', /codAmount/],
  ['codCollected', /codCollected/],
  ['cod_pending', /cod_pending/],
  ['grocer', /grocer/i],
  ['Bengaluru', /bengaluru/i],
  ['FIRST20', /FIRST20/],
  ['FRESH10', /FRESH10/],
  ['asia-south1', /asia-south1/],
  ['KA01', /KA01/],
];

/** The spec documents the migration, so it names every leftover on purpose; this file lists them too. */
const SKIP_FILES = new Set(['docs/MARKETPLACE.md', 'scripts/check-legacy.mjs', 'package-lock.json']);
const SKIP_DIRS = new Set([
  'node_modules',
  '.build',
  // Firebase-era code parked for reference while it is ported; deleted before release.
  'legacy',
  '.git',
  '.expo',
  '.emulator-data',
  '.firebase',
  'dist',
  'web-build',
  'coverage',
  'ios',
  'android',
]);
/** Build output and generated art are derived from sources that are checked themselves. */
const SKIP_PATHS = ['firebase/functions/lib', 'packages/art/src/generated.ts', 'packages/art/preview'];
const TEXT_FILE =
  /\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|rules|html|css|sh|txt|svg|env|example|development)$|(^|\/)\.env[^/]*$/;

const args = process.argv.slice(2);
const summaryOnly = args.includes('--summary');
const targets = args.filter((arg) => !arg.startsWith('--'));

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.endsWith('-debug.log')) continue;
    const full = path.join(dir, name);
    const relative = path.relative(root, full);
    if (
      SKIP_FILES.has(relative) ||
      SKIP_PATHS.some((skip) => relative === skip || relative.startsWith(`${skip}/`))
    ) {
      continue;
    }
    const stats = statSync(full);
    if (stats.isDirectory()) yield* walk(full);
    else if (stats.isFile() && TEXT_FILE.test(relative) && stats.size < 2_000_000) yield relative;
  }
}

const matches = [];
for (const target of targets.length > 0 ? targets : ['.']) {
  for (const file of walk(path.resolve(root, target))) {
    const lines = readFileSync(path.join(root, file), 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const [label, pattern] of PATTERNS) {
        if (pattern.test(line))
          matches.push({ file, line: index + 1, label, text: line.trim().slice(0, 140) });
      }
    });
  }
}

if (matches.length === 0) {
  console.log('✓ No grocery-prototype leftovers found.');
  process.exit(0);
}

/** Group by the first two path segments (apps/customer, firebase/functions, …) so progress is easy to read. */
const areaOf = (file) => file.split('/').slice(0, 2).join('/');
const byArea = new Map();
for (const match of matches) byArea.set(areaOf(match.file), (byArea.get(areaOf(match.file)) ?? 0) + 1);

console.log(
  `✗ ${matches.length} leftover(s) of the grocery prototype in ${new Set(matches.map((m) => m.file)).size} file(s):\n`,
);
for (const [area, count] of [...byArea].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(count).padStart(5)}  ${area}`);
if (!summaryOnly) {
  console.log('');
  for (const match of matches) console.log(`${match.file}:${match.line}  [${match.label}]  ${match.text}`);
}
process.exit(1);
