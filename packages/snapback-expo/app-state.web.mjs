export async function resolveDefaultAppState() {
  if (typeof globalThis.document?.addEventListener !== 'function') return null;
  try {
    // @ref LLP 0181#native-adapters — web resolves its lifecycle owner from
    // React Native Web without evaluating the native package entry point.
    const module = await import('react-native-web/dist/exports/AppState/index.js');
    const appState = module.default;
    return appState?.addEventListener ? appState : null;
  } catch {
    return null;
  }
}
