import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const probe = process.env.SNAPBACK_ACTIVITY_PRESENCE_BROWSER_PROBE === '1';

if (!probe) {
  execFileSync(
    process.execPath,
    ['--conditions', 'browser', fileURLToPath(import.meta.url)],
    {
      env: { ...process.env, SNAPBACK_ACTIVITY_PRESENCE_BROWSER_PROBE: '1' },
      stdio: 'inherit',
    },
  );
} else {
  const listeners = new Set();
  let lifecycleSubscriptions = 0;
  const appState = {
    currentState: 'active',
    addEventListener(type, listener) {
      assert.equal(type, 'change');
      lifecycleSubscriptions += 1;
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    transition(next) {
      this.currentState = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
  globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
  globalThis.__SNAPBACK_TEST_BROWSER_APP_STATE__ = appState;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'react-native-web/dist/exports/AppState/index.js') {
        return {
          url: 'data:text/javascript,export default globalThis.__SNAPBACK_TEST_BROWSER_APP_STATE__',
          shortCircuit: true,
        };
      }
      return nextResolve(specifier, context);
    },
  });

  const React = (await import('react')).default;
  const TestRenderer = await import('react-test-renderer');
  const { SnapbackProvider } = await import('@expo/snapback-react');
  const { useSnapbackActivityPresence } = await import('./activity-presence.mjs');
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  let publishCalls = 0;
  let deleteCalls = 0;
  const presenceSnapshot = Object.freeze({
    status: 'ready',
    entries: Object.freeze([]),
    selfKey: null,
    diagnostic: null,
    connection: 'live',
    publisher: Object.freeze({ status: 'observing', diagnostic: null }),
    publish: async () => { publishCalls += 1; },
    delete: async () => { deleteCalls += 1; },
  });
  const registry = Object.freeze({
    createPresenceToken: () => Object.freeze({}),
    presenceDescriptor: () => Object.freeze({ key: 'bare-provider-presence' }),
    subscribePresence: () => Object.freeze({ release() {} }),
    presenceSnapshot: () => presenceSnapshot,
  });
  const provider = Object.freeze({
    kind: 'snapback.react-provider.v1',
    binding: Object.freeze({}),
    registry,
    start() {},
  });
  const contract = Object.freeze({ kind: 'string', maxBytes: 32 });
  const typing = Object.freeze({
    name: 'typing',
    scopeContract: Object.freeze({
      kind: 'object',
      fields: Object.freeze([
        Object.freeze({ name: 'roomId', required: true, value: contract }),
      ]),
      allowExtra: false,
    }),
    valueContract: Object.freeze({
      kind: 'object',
      fields: Object.freeze([
        Object.freeze({ name: 'name', required: true, value: contract }),
      ]),
      allowExtra: false,
    }),
  });
  let activity = null;
  function Probe() {
    activity = useSnapbackActivityPresence(typing, {
      scope: { roomId: 'room-one' },
      value: () => ({ name: 'Ada' }),
      idleMs: 60_000,
    });
    return null;
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve));
  let renderer;
  // @ref LLP 0257#expo-backgrounding-and-resume — a tree without the facade
  // provider still uses the conditional browser AppState source.
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { provider },
      React.createElement(Probe),
    ));
    await flush();
  });
  assert.equal(lifecycleSubscriptions, 1, 'bare provider must attach the browser AppState fallback');
  TestRenderer.act(() => activity.touch());
  await TestRenderer.act(async () => { await flush(); });
  assert.equal(publishCalls, 1);
  await TestRenderer.act(async () => {
    appState.transition('background');
    await flush();
  });
  assert.equal(activity.active, false);
  assert.equal(deleteCalls, 1, 'backgrounding must withdraw facade activity intent');
  await TestRenderer.act(async () => { renderer.unmount(); });

  console.log('activity-presence-bare-provider.test.mjs: facade hook under bare SnapbackProvider did not throw; browser AppState fallback attached and background withdrawal passed');
}
