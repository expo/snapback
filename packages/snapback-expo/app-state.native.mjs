export async function resolveDefaultAppState() {
  // Import the lifecycle owner directly. Metro turns a dynamic import of the
  // React Native package root into a namespace bundle that evaluates legacy
  // optional exports such as PushNotificationIOS; Expo Go intentionally does
  // not carry those native modules, even though AppState itself is available.
  const nativeAppState = await import(
    'react-native/Libraries/AppState/AppState.js'
  );
  const appState = nativeAppState.default;
  return appState?.addEventListener ? appState : null;
}
