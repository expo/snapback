import { Platform } from "react-native";
import {
  forgetSession,
  keepSession,
  localStorageSessionStore,
  login as authLogin,
  logout as authLogout,
  restoreSession,
  signup as authSignup,
  type Session,
  type SessionStore,
} from "snapback4/auth";
import { createClient } from "snapback4/client";
import type { Client } from "snapback4/contract";
import { createLocalClient, type LocalClient } from "snapback4/local";
import { webDevice } from "snapback4/web";
import { api } from "./api.generated";
import { handleFromEmail, settle } from "./ops";
import { SNAPBACK_URL } from "./url";

function memoryStore(): SessionStore {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => {
      m.set(k, v);
    },
    delete: async (k) => {
      m.delete(k);
    },
  };
}

function sessionStore(): SessionStore {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    return localStorageSessionStore();
  }
  return memoryStore();
}

const store = sessionStore();

export type AppClient = LocalClient | Client;

export async function openWithSession(session: Session): Promise<AppClient> {
  await keepSession(SNAPBACK_URL, session, store);
  if (Platform.OS === "web") {
    // Online tier on web: live /changes without wasm/IndexedDB. Local-first
    // remains on native (snapback4-expo).
    return createClient({ url: SNAPBACK_URL, session });
  }
  try {
    const expo = await import("snapback4-expo");
    if (expo.nativeAvailable()) {
      return createLocalClient({
        url: SNAPBACK_URL,
        session,
        sessionStore: store,
        device: expo.nativeDevice,
        assets: { keep: "viewed", maxBytes: 64 * 1024 * 1024 },
      });
    }
  } catch {
    /* Expo Go / tests */
  }
  return createClient({ url: SNAPBACK_URL, session });
}

export async function restoreClient(): Promise<AppClient | null> {
  const session = await restoreSession(SNAPBACK_URL, store);
  if (!session) return null;
  return openWithSession(session);
}

export async function signUp(email: string, password: string): Promise<{ ok: true; client: AppClient } | { ok: false; error: string }> {
  const result = await authSignup(SNAPBACK_URL, email, password);
  if (!result.ok) {
    const msg = result.why.message ?? result.why.code;
    if (/exist|duplicate|taken/i.test(msg) || result.why.code === "E_CONSTRAINT") {
      return { ok: false, error: "That email is already registered." };
    }
    return { ok: false, error: msg };
  }
  const client = await openWithSession(result.session);
  const handle = handleFromEmail(email);
  const write = await settle(client, api.setProfile, {
    displayName: handle,
    handle,
    bio: "",
    location: "",
    link: "https://example.com/user",
  });
  if (write.state === "failed") {
    const msg = write.why.message ?? write.why.code;
    if (write.why.code === "E_CONSTRAINT") {
      await client.close();
      return { ok: false, error: "That handle is already taken." };
    }
    await client.close();
    return { ok: false, error: msg };
  }
  return { ok: true, client };
}

export async function signIn(email: string, password: string): Promise<{ ok: true; client: AppClient } | { ok: false; error: string }> {
  const result = await authLogin(SNAPBACK_URL, email, password);
  if (!result.ok) return { ok: false, error: result.why.message ?? result.why.code };
  return { ok: true, client: await openWithSession(result.session) };
}

export async function signOut(client: AppClient): Promise<void> {
  const session = "session" in client && typeof client.session === "function" ? client.session() : null;
  try {
    if (session?.token) await authLogout(SNAPBACK_URL, session.token);
  } catch {
    /* still drop local session */
  }
  await forgetSession(SNAPBACK_URL, store);
  if ("signOut" in client) await client.signOut();
  else await client.close();
}
