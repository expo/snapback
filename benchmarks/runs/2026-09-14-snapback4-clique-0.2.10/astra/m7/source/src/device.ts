import { nativeDevice } from "snapback4-expo";
import * as SecureStore from "expo-secure-store";
export const device = () => nativeDevice;
const key = (k: string) => k.replace(/[^a-zA-Z0-9._-]/g, "_");
export const sessionStore = {
  get: (k: string) => SecureStore.getItemAsync(key(k)),
  set: (k: string, v: string) => SecureStore.setItemAsync(key(k), v),
  delete: (k: string) => SecureStore.deleteItemAsync(key(k)),
};
