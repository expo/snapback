import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Small key-value cache: localStorage on web (survives cold start with the
// backend down), AsyncStorage on native.
export const cache = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw =
        Platform.OS === "web"
          ? window.localStorage.getItem(key)
          : await AsyncStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    try {
      const raw = JSON.stringify(value);
      if (Platform.OS === "web") window.localStorage.setItem(key, raw);
      else await AsyncStorage.setItem(key, raw);
    } catch {
      // best-effort cache
    }
  },
};
