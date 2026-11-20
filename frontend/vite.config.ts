import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig(({ command, mode }) => {
  // The .env files of this mode plus the VITE_* variables already in the environment (docs/CLIENTS.md §8.3).
  const vars = loadEnv(mode, root, 'VITE_');
  const apiUrl = (vars.VITE_API_URL ?? '').trim();
  if (command === 'build' && !/^https?:\/\/[^/\s]+$/.test(apiUrl)) {
    throw new Error(
      'Set VITE_API_URL to the origin of the API (for example https://api.example.com, no path) before building the console.',
    );
  }
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    server: {
      port: 5173,
      strictPort: true,
      host: true,
    },
    preview: {
      port: 4173,
    },
    build: {
      sourcemap: true,
      target: 'es2022',
      chunkSizeWarningLimit: 900,
    },
  };
});
