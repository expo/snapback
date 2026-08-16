const resolvedSources = new WeakMap();
let defaultSource = null;

function compatibilityError(message) {
  const error = new Error(message);
  error.code = 'SNAPBACK_EXPO_COMPATIBILITY_UNSUPPORTED';
  return error;
}

function admitSource(source) {
  if (source?.addEventListener) return source;
  throw compatibilityError(
    'No platform AppState-compatible lifecycle source resolved; inject appState '
    + '(or resolveAppState) via createSupervisedExpoEnvironment({ appState }).',
  );
}

// @ref LLP 0257#expo-backgrounding-and-resume — the provider and activity
// wrapper resolve one shared source. An injected source/resolver wins; only an
// uninjected environment may use the conditional #app-state fallback.
export function resolveSnapbackExpoLifecycleSource(environment = null) {
  if (environment?.appState !== undefined) {
    return Promise.resolve().then(() => admitSource(environment.appState));
  }
  if (typeof environment?.resolveAppState === 'function') {
    let resolution = resolvedSources.get(environment);
    if (resolution === undefined) {
      resolution = Promise.resolve()
        .then(() => environment.resolveAppState())
        .then(admitSource);
      resolvedSources.set(environment, resolution);
    }
    return resolution;
  }
  if (defaultSource === null) {
    defaultSource = import('#app-state')
      .then(({ resolveDefaultAppState }) => resolveDefaultAppState())
      .then(admitSource);
  }
  return defaultSource;
}
