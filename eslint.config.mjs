// Single ESLint config for the whole monorepo (flat config).
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '.build/**',
      // Firebase-era code parked for reference while it is ported to the API server.
      'legacy/**',
      'packages/art/src/generated.ts',
      'packages/art/preview/**',
      '**/coverage/**',
      '**/.expo/**',
      '**/web-build/**',
      'app/*/ios/**',
      'app/*/android/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      eqeqeq: ['error', 'smart'],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Everything that renders UI: the web console and the two Expo apps.
    files: ['frontend/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // CLI scripts and config files print progress on purpose.
    files: ['scripts/**', 'backend/scripts/**', '**/*.config.{js,mjs,ts}', '**/metro.config.js'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Folder boundary: the server imports @instasupply/shared and nothing else from this repository.
    files: ['backend/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@instasupply/(?!shared(/|$))',
              message: 'backend/ may import only @instasupply/shared.',
            },
            {
              regex: '^(\\.\\./)+(frontend|packages|legacy|app/(customer|driver))(/|$)',
              message: 'backend/ may not import files of another top-level folder.',
            },
          ],
        },
      ],
    },
  },
  {
    // The client address has one source, clientAddress() (PLATFORM.md §4.6): Fastify's request.ip would
    // trust whatever X-Forwarded-For a client sends, because Railway's edge does not set that header.
    files: ['backend/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'request', property: 'ip', message: 'Use clientAddress(req) (PLATFORM.md §4.6).' },
        { object: 'req', property: 'ip', message: 'Use clientAddress(req) (PLATFORM.md §4.6).' },
      ],
    },
  },
  {
    // The server's command-line entry and its CLI commands print their results (links, statuses) on purpose.
    files: ['backend/src/cli.ts', 'backend/src/cli/**/*.ts', 'backend/build.mjs'],
    rules: { 'no-console': 'off' },
  },
);
