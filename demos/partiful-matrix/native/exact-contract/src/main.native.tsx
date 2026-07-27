// @platform-split: native runtime entry avoids browser DOM APIs (LLP 0154, LLP 0243)
/**
 * Native entrypoint: mounts the app's sole Contract route without touching the
 * DOM. The native host resolves /src/main.tsx to this file (mac -> native ->
 * unsuffixed).
 *
 * Partitime has no path navigation: its feed/detail transition is component
 * state inside the unchanged route fixture. Keeping the general file router
 * and Contract router adapter in this native graph retained hundreds of
 * kilobytes of unreachable navigation machinery in the startup HBC.
 */

import { mount, reset } from '@exact/contract/runtime';

import app from './app/routes/index.contract';
import { configurePartitimeData } from './partitime/bootstrap.js';

type StarterNativeGlobal = typeof globalThis & {
  __exactDisposeApp?: () => void;
};

const starterGlobal = globalThis as StarterNativeGlobal;
const disposePartitimeData = configurePartitimeData();
const handle = mount(app);
starterGlobal.__exactDisposeApp = () => {
  handle.dispose();
  disposePartitimeData();
  reset();
  starterGlobal.__exactDisposeApp = undefined;
};

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    starterGlobal.__exactDisposeApp?.();
  });
}
