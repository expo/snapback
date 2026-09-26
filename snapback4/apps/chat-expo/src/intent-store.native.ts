import Storage from "expo-sqlite/kv-store";
import type { IntentStorage } from "./intents";
// Message text belongs in SQLite, not SecureStore's size-limited values.
export const intentStorage: IntentStorage = {
  getItem: key => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
  removeItem: key => Storage.removeItemSync(key),
};
