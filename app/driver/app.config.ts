import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * APP_VARIANT lets development, preview and production builds live side by side on one device.
 * Secrets never go here: everything below is either public or injected at build time (docs/CLIENTS.md §8.2).
 */
const variant = process.env.APP_VARIANT ?? 'production';
const isProduction = variant === 'production';
const suffix = isProduction ? '' : `.${variant}`;

// A release bundle that cannot reach the API must fail at build time, not on a driver's phone.
// Release bundling runs in production mode with .env.production loaded; `expo start` does not.
const apiUrl = (process.env.EXPO_PUBLIC_API_URL ?? '').trim();
if (process.env.NODE_ENV === 'production' && !/^https:\/\/[^/\s]+$/.test(apiUrl)) {
  throw new Error(
    `EXPO_PUBLIC_API_URL must be an https:// origin without a path for a release bundle (got "${apiUrl}"). See docs/CLIENTS.md §8.2.`,
  );
}

// Path to google-services.json: FCM transport for Expo push on Android (docs/CLIENTS.md §6.1).
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || undefined;
const easProjectId = process.env.EAS_PROJECT_ID || undefined;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isProduction ? 'InstaSupply Driver' : `InstaSupply Driver (${variant})`,
  slug: 'instasupply-driver',
  scheme: 'instasupply-driver',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#0B1020',
  ios: {
    bundleIdentifier: `com.instasupply.driver${suffix}`,
    supportsTablet: false,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: `com.instasupply.driver${suffix}`,
    adaptiveIcon: {
      backgroundColor: '#4F46E5',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    googleServicesFile,
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
    bundler: 'metro',
    output: 'single',
  },
  plugins: [
    'expo-router',
    'expo-status-bar',
    'expo-secure-store',
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'InstaSupply shares your location while you are online, so dispatch, stores and the site can see your truck approach.',
        locationWhenInUsePermission:
          'InstaSupply uses your location to show jobs near you, plan your route and share live tracking while you are online.',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#4F46E5',
        image: './assets/splash-icon.png',
        imageWidth: 120,
        dark: { backgroundColor: '#0B1020', image: './assets/splash-icon.png' },
      },
    ],
    [
      'expo-notifications',
      { color: '#4F46E5', defaultChannel: 'assignments', icon: './assets/notification-icon.png' },
    ],
    [
      'expo-image-picker',
      {
        cameraPermission: 'Take the drop-off photo that proves where you left the load.',
        photosPermission: 'Attach a drop-off photo that proves where you left the load.',
        microphonePermission: false,
      },
    ],
  ],
  extra: {
    eas: easProjectId ? { projectId: easProjectId } : undefined,
    variant,
    // Whether this build can receive system push at all (docs/CLIENTS.md §6.1): read by push-availability.ts.
    push: { android: Boolean(easProjectId && googleServicesFile), ios: Boolean(easProjectId) },
  },
});
