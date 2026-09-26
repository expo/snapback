import type { IntentStorage } from "./intents";
// Metro selects this module on web; SQLite's web/wasm build is never imported.
export const intentStorage: IntentStorage = {
  getItem: key => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: key => localStorage.removeItem(key),
};
