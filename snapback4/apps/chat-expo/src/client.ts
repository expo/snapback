// One call opens the device: the Rust module when this build carries it
// (a development or production build), else the online tier in Expo Go,
// which loads no custom native code and no wasm. Either way the secure
// store keeps the session and a guest is minted when there is none; the
// persona door is for development against `snapback4 dev` on the same
// machine.
import * as SecureStore from "expo-secure-store";
import { guest, keepSession, restoreSession } from "snapback4/auth";
import { createApp, type App } from "snapback4/app";
import { createClient } from "snapback4/client";
import type { Client } from "snapback4/contract";
import { createLocalClient, type LocalClient, type LocalOptions } from "snapback4/local";
import { nativeAvailable, nativeDevice } from "snapback4-expo";

export const url = process.env.EXPO_PUBLIC_SNAPBACK_URL ?? "http://127.0.0.1:4400";
export const persona = process.env.EXPO_PUBLIC_SNAPBACK_PERSONA;

const sessionStore = {
  get: (key: string) => SecureStore.getItemAsync(key.replace(/[^A-Za-z0-9._-]/g, "_")),
  set: (key: string, value: string) => SecureStore.setItemAsync(key.replace(/[^A-Za-z0-9._-]/g, "_"), value),
  delete: (key: string) => SecureStore.deleteItemAsync(key.replace(/[^A-Za-z0-9._-]/g, "_")),
};

export type DeviceClient = LocalClient | Client;

/** Which tier this build runs: the Rust module, or the online tier. */
export const tier: "native" | "online" = nativeAvailable() ? "native" : "online";

export async function openClient(extra: Partial<LocalOptions> = {}): Promise<DeviceClient> {
  const as = extra.persona ?? persona;
  if (tier === "native") {
    const client = await createLocalClient({ url, ...(as ? { persona: as } : { guest: true, sessionStore }), device: nativeDevice, waitSeconds: 20, fetch: extra.fetch });
    try {
      // Network loss resolves sync normally and makes the link offline; it
      // must not block opening. `acquired` is the readiness signal. Close
      // and rethrow only an unexpected exception from this opener's work.
      if (client.link() === "online") await client.sync();
      return client;
    } catch (error) { await client.close(); throw error; }
  }
  if (as) return createClient({ url, persona: as, fetch: extra.fetch });
  // The online tier keeps no session of its own: restore the one kept, or mint a guest.
  let session = await restoreSession(url, sessionStore);
  if (!session) {
    const signedIn = await guest(url, extra.fetch ?? fetch);
    if (!signedIn.ok) throw new Error(`${signedIn.why.code}: ${signedIn.why.message}`);
    session = signedIn.session;
    await keepSession(url, session, sessionStore);
  }
  return createClient({ url, session, fetch: extra.fetch });
}

/** The ordinary application owns restoration, sign-in and client lifetime. */
export async function openApp(): Promise<App> {
  const app = createApp({ url, sessionStore, ...(tier === "native" ? { device: nativeDevice } : {}) });
  try {
    const restored = await app.ready;
    if (!restored.ok) throw new Error(restored.why.message);
    if (app.auth.state === "signed-out") {
      const result = await app.auth.guest();
      if (!result.ok) throw new Error(result.why.message);
    }
    return app;
  } catch (error) { await app.close(); throw error; }
}
