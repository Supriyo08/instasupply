/** Typed access to build-time configuration (see .env.example). */
const read = (value: string | undefined, fallback = ''): string => value?.trim() || fallback;

export const env = {
  useEmulators: import.meta.env.VITE_USE_EMULATORS === 'true',
  firebase: {
    apiKey: read(import.meta.env.VITE_FIREBASE_API_KEY, 'demo-key'),
    authDomain: read(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: read(import.meta.env.VITE_FIREBASE_PROJECT_ID, 'demo-instasupply'),
    storageBucket: read(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: read(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
    appId: read(import.meta.env.VITE_FIREBASE_APP_ID),
  },
  functionsRegion: read(import.meta.env.VITE_FUNCTIONS_REGION, 'us-central1'),
  map: {
    tileUrl: read(import.meta.env.VITE_MAP_TILE_URL, 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'),
    attribution: read(
      import.meta.env.VITE_MAP_ATTRIBUTION,
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    ),
  },
} as const;

/** Host the emulators are reached on: the same host that served the page (works over LAN too). */
export const emulatorHost = typeof window === 'undefined' ? '127.0.0.1' : window.location.hostname;
