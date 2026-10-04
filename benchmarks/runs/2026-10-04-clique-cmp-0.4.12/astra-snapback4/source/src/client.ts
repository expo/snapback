import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createApp } from 'snapback4/app';
import { localStorageSessionStore } from 'snapback4/auth';
import { nativeAvailable, nativeDevice } from 'snapback4-expo';
import { webDevice } from 'snapback4/web';
export const url = process.env.EXPO_PUBLIC_SNAPBACK_URL ?? 'http://127.0.0.1:49360';
export const app = createApp({url, sessionStore: Platform.OS === 'web' ? localStorageSessionStore() : {
 get: (key: string) => SecureStore.getItemAsync(key),
 set: (key: string,value: string) => SecureStore.setItemAsync(key,value),
 delete: (key: string) => SecureStore.deleteItemAsync(key),
}, device: Platform.OS === 'web' ? webDevice() : nativeAvailable() ? nativeDevice : undefined,
assets: {keep:'viewed',maxBytes:67108864}});
