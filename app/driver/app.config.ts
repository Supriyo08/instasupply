import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * APP_VARIANT lets development, preview and production builds live side by side on one device.
 * Secrets never go here: everything below is either public or injected by EAS at build time.
 */
const variant = process.env.APP_VARIANT ?? 'production';
const isProduction = variant === 'production';
const suffix = isProduction ? '' : `.${variant}`;

// Path to google-services.json (enables native FCM on Android). On EAS, use a file environment variable.
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || undefined;

const easProjectId = process.env.EAS_PROJECT_ID;

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
    config: process.env.GOOGLE_MAPS_ANDROID_API_KEY
      ? { googleMaps: { apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY } }
      : undefined,
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
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'InstaSupply shares your location with dispatch while you are online, so customers can follow their delivery.',
        locationWhenInUsePermission:
          'InstaSupply uses your location to plan your route and share live tracking while you are online.',
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
        cameraPermission: 'Take a photo of the package as proof of delivery.',
        photosPermission: 'Attach a photo of the package as proof of delivery.',
        microphonePermission: false,
      },
    ],
  ],
  extra: {
    eas: easProjectId ? { projectId: easProjectId } : undefined,
    variant,
  },
});
