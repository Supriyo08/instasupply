/** Build-time configuration of the console (docs/CLIENTS.md §8.3, frontend/.env.example). */
const DEV_API_PORT = 4000;

function resolveApiUrl(): string {
  const explicit = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  // `vite` on this machine or opened from another device on the LAN: the API is on the same host.
  if (import.meta.env.DEV) {
    if (typeof window === 'undefined') return `http://localhost:${DEV_API_PORT}`;
    return `${window.location.protocol}//${window.location.hostname}:${DEV_API_PORT}`;
  }
  throw new Error('VITE_API_URL is empty in a production build (docs/CLIENTS.md §8.3).');
}

export const env = {
  apiUrl: resolveApiUrl(),
  /** True in `vite` (development); shows the demo-account hint on the sign-in page. */
  dev: import.meta.env.DEV,
} as const;
