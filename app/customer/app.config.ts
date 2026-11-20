import type { ConfigContext, ExpoConfig } from 'expo/config';

/** APP_VARIANT lets development, preview and production builds live side by side on one device. */
const variant = process.env.APP_VARIANT ?? 'production';
const isProduction = variant === 'production';
const suffix = isProduction ? '' : `.${variant}`;
const easProjectId = process.env.EAS_PROJECT_ID || undefined;
// Path to google-services.json: the FCM transport Expo push needs on Android (docs/CLIENTS.md §6.1).
// On EAS, use a file environment variable. Without it the build runs, without system notifications.
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || undefined;

// A release bundle that cannot reach the API must fail here, not on the customer's phone
// (docs/CLIENTS.md §8.2). `expo start` and `expo prebuild` run in development mode.
const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();
if (process.env.NODE_ENV === 'production' && !/^https:\/\/[^/\s]+$/.test(apiUrl)) {
  throw new Error(
    `EXPO_PUBLIC_API_URL must be an https origin without a path in a release bundle, got "${apiUrl}" ` +
      '(set it in app/customer/.env.production, docs/CLIENTS.md §8.2).',
  );
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isProduction ? 'InstaSupply' : `InstaSupply (${variant})`,
  slug: 'instasupply-shop',
  scheme: 'instasupply',
  version: '1.0.0',
  description: 'Building supplies from local GTA stores, delivered to your jobsite or ready for pickup.',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  backgroundColor: '#F4F5F9',
  ios: {
    bundleIdentifier: `com.instasupply.shop${suffix}`,
    supportsTablet: false,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: `com.instasupply.shop${suffix}`,
    adaptiveIcon: {
      backgroundColor: '#6CC51D',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    googleServicesFile,
    predictiveBackGestureEnabled: false,
  },
  web: { favicon: './assets/favicon.png', bundler: 'metro', output: 'single' },
  plugins: [
    'expo-router',
    'expo-status-bar',
    'expo-font',
    'expo-image',
    'expo-secure-store',
    [
      'expo-splash-screen',
      { backgroundColor: '#6CC51D', image: './assets/splash-icon.png', imageWidth: 120 },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'InstaSupply uses your location to find stores near your jobsite and to place your jobsite pin.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'InstaSupply uses your photos to attach a material list or show a problem with a delivered item.',
        cameraPermission:
          'InstaSupply uses the camera to photograph a material list or a problem with a delivered item.',
      },
    ],
    [
      'expo-notifications',
      { color: '#6CC51D', defaultChannel: 'orders', icon: './assets/notification-icon.png' },
    ],
  ],
  extra: {
    eas: easProjectId ? { projectId: easProjectId } : undefined,
    variant,
    // The embedded config leaves native-only fields out, so the app cannot look for
    // googleServicesFile itself: these flags say whether this build can push (docs/CLIENTS.md §6.1).
    push: { android: Boolean(easProjectId && googleServicesFile), ios: Boolean(easProjectId) },
  },
});
