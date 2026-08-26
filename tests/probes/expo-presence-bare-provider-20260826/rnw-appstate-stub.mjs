// Stands in for `react-native-web/dist/exports/AppState/index.js`, which is not
// a workspace dependency. The probe stubs ONLY this third-party module; every
// Snapback module in the chain — the facade hook, `lifecycle-source.mjs`, and
// `app-state.web.mjs` under the `browser` condition — is the shipped code.
const listeners = new Set();
const AppState = {
  currentState: 'active',
  addEventListener(type, listener) {
    if (type !== 'change') throw new Error(`unexpected AppState event ${type}`);
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  },
  __emit(state) {
    AppState.currentState = state;
    for (const listener of [...listeners]) listener(state);
  },
  __inspection: () => ({ listeners: listeners.size }),
};
export default AppState;
