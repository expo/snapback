import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Simple key/value persistence for "who am I" identity.
//
// On web we deliberately use `sessionStorage` instead of `localStorage`.
// This is a demo-only trick: it lets two browser *tabs* pointed at the same
// dev server behave like two different logged-in users, which is how we
// simulate a second client to prove out live sync (typing indicators,
// message delivery) without standing up two devices.
export const sessionStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === "web") {
      return window.sessionStorage.getItem(key);
    }
    return AsyncStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === "web") {
      window.sessionStorage.setItem(key, value);
      return;
    }
    await AsyncStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === "web") {
      window.sessionStorage.removeItem(key);
      return;
    }
    await AsyncStorage.removeItem(key);
  },
};
