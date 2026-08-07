export async function resolveDefaultAppState() {
  try {
    const module = await import('react-native');
    const appState = module.AppState ?? module.default?.AppState;
    return appState?.addEventListener ? appState : null;
  } catch {
    return null;
  }
}
