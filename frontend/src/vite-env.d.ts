/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Origin of the API, `https://host[:port]` (docs/CLIENTS.md §8.3). Required by `vite build`. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** `version` of frontend/package.json, defined in vite.config.ts. */
declare const __APP_VERSION__: string;
