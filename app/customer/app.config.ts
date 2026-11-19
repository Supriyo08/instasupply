import type { ConfigContext, ExpoConfig } from 'expo/config';

/** APP_VARIANT lets development, preview and production builds live side by side on one device. */
const variant = process.env.APP_VARIANT ?? 'production';
const isProduction = variant === 'production';
const suffix = isProduction ? '' : `.${variant}`;
const easProjectId = process.env.EAS_PROJECT_ID;
// Path to google-services.json (enables native FCM on Android). On EAS, use a file environment variable.
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || undefined;
// Maps SDK for Android key for the live tracking map; without it Android shows a text summary.
// Keep it the same (set or unset) for prebuild, the build and any `eas update` publish: prebuild
// writes the key into the native app, the other two write the `extra.googleMapsEnabled` flag below.
const googleMapsAndroidKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY || undefined;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: isProduction ? 'InstaSupply' : `InstaSupply (${variant})`,
  slug: 'instasupply-shop',
  scheme: 'instasupply',
  version: '1.0.0',
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
    config: googleMapsAndroidKey ? { googleMaps: { apiKey: googleMapsAndroidKey } } : undefined,
    predictiveBackGestureEnabled: false,
  },
  web: { favicon: './assets/favicon.png', bundler: 'metro', output: 'single' },
  plugins: [
    'expo-router',
    'expo-status-bar',
    'expo-font',
    'expo-image',
    [
      'expo-splash-screen',
      { backgroundColor: '#6CC51D', image: './assets/splash-icon.png', imageWidth: 120 },
    ],
    [
      'expo-location',
      { locationWhenInUsePermission: 'InstaSupply uses your location to fill in your delivery address.' },
    ],
    [
      'expo-notifications',
      { color: '#6CC51D', defaultChannel: 'orders', icon: './assets/notification-icon.png' },
    ],
  ],
  extra: {
    eas: easProjectId ? { projectId: easProjectId } : undefined,
    variant,
    // Expo leaves `android.config` out of the config a build embeds, so the app (TrackingMap)
    // can't look for the key there: this tells it whether the build has one.
    googleMapsEnabled: Boolean(googleMapsAndroidKey),
  },
});
