import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const googleIosUrlScheme = process.env.KNOCKOFF_GOOGLE_IOS_URL_SCHEME?.trim();
  const plugins: NonNullable<ExpoConfig['plugins']> = [
    'expo-router',
    [
      'expo-dev-client',
      { toolsButton: false, skipOnboarding: true, showMenuAtLaunch: false },
    ],
    'expo-apple-authentication',
    ...(googleIosUrlScheme
      ? [[
          '@react-native-google-signin/google-signin',
          { iosUrlScheme: googleIosUrlScheme },
        ] as const]
      : []),
  ];
  const receipt = `knockoff.native-auth-build.v1:apple-ios:google-ios-${googleIosUrlScheme ? 'ready' : 'missing'}:google-android-ready`;

  return {
    ...config,
    name: 'Knockoff',
    slug: 'snapback-knockoff',
    scheme: [
      'knockoff',
      'knockoff-apple-native-v1',
      'knockoff-google-native-v1',
    ],
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    plugins,
    experiments: { typedRoutes: true },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.snapback.knockoff',
      usesAppleSignIn: true,
      infoPlist: {
        NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
      },
    },
    android: {
      package: 'com.snapback.knockoff',
      usesCleartextTraffic: true,
    },
    extra: {
      router: {},
      knockoffAuthBuild: {
        format: 'knockoff.native-auth-build.v1',
        receipt,
        appleNative: { ios: true },
        googleNative: { ios: Boolean(googleIosUrlScheme), android: true },
      },
    },
    owner: 'ccheever',
  };
};
