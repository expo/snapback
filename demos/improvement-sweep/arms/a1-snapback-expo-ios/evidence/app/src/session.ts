// App-owned session custody: the field notebook persists its Snapback
// session bearer in the OS keychain (expo-secure-store) so a previously
// opened client can cold-restart and attempt reconnection without
// re-entering the email code. The Snapback client itself persists nothing
// durable on this carrier (rqs default store resolves to the in-memory
// arm on React Native — see the arm findings).
import * as SecureStore from 'expo-secure-store';

const KEY = 'a1.session.v1';

export type StoredSession = {
  bearer: string;
  userId: string;
  email: string;
  workspaceId: string | null;
};

export async function loadStoredSession(): Promise<StoredSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export async function saveStoredSession(value: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(value));
}

export async function clearStoredSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
