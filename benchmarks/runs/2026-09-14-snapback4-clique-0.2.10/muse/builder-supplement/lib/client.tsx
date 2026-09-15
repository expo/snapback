import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { AuthForm } from "../ui-kit/src/AuthForm";
import { createLocalClient } from "snapback4/local";
import { createClient } from "snapback4/client";
import { indexedDbPersistence, webDevice } from "snapback4/web";
import { localStorageSessionStore, login as authLogin, logout as authLogout, signup as authSignup, restoreSession, forgetSession } from "snapback4/auth";
import type { Session } from "snapback4/auth";
import { SnapbackProvider } from "snapback4/react";
import { api } from "../snapback/generated/api";

export function serverUrl(): string {
  const fromEnv = (process.env.EXPO_PUBLIC_SNAPBACK_URL as string | undefined)?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    try {
      const q = new URLSearchParams(window.location.search).get("snapback_url");
      if (q) return q.replace(/\/$/, "");
    } catch {}
  }
  return "http://127.0.0.1:49340";
}

async function openDevice() {
  // The Metro web export does not emit the device wasm beside the module,
  // so point the opener at the staged /wasm asset (public/wasm).
  // IndexedDB persistence (the vendor default): the device survives page
  // loads warm, so a fresh navigation resumes from synced state instead of
  // re-syncing the whole store — required for warm-offline reads (search,
  // history) immediately after a reload, and milder reload storms.
  if (Platform.OS === "web") return webDevice({ wasm: "/wasm/snapback4_device_bg.wasm", persist: indexedDbPersistence() });
  try {
    const expo = require("snapback4-expo") as typeof import("snapback4-expo");
    if (expo.nativeAvailable()) return expo.nativeDevice();
  } catch {}
  return null;
}

function sessionStore() {
  if (Platform.OS === "web") {
    return localStorageSessionStore();
  }
  try {
    const SecureStore = require("expo-secure-store") as typeof import("expo-secure-store");
    return {
      get: (k: string) => SecureStore.getItemAsync(k),
      set: (k: string, v: string) => SecureStore.setItemAsync(k, v),
      delete: (k: string) => SecureStore.deleteItemAsync(k),
    };
  } catch {
    return undefined;
  }
}

interface AppClient {
  client: any;
  onlineOnly: boolean;
  session: Session | null;
  signInWithSession: (s: Session) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ ok: true; session: Session } | { ok: false; why: any }>;
  signIn: (email: string, password: string) => Promise<{ ok: true; session: Session } | { ok: false; why: any }>;
  signOut: () => Promise<void>;
  url: string;
}

const Ctx = createContext<AppClient | null>(null);
export const useAppClient = () => useContext(Ctx)!;

// Debug-only timing proxy: logs every client call slower than 1s (plus all
// member/send mutations) with invoke/resolve timestamps to expose wedges.
function instrumentClient(c: any): any {
  const slow = (op: string, kind: string, t: number, extra: string) => {
    // eslint-disable-next-line no-console
    console.log(`[client-timing] ${kind} ${op} ${extra}@${t}`);
  };
  const wrap = (kind: string, fn: any) =>
    function (op: any, args: any, ...rest: any[]) {
      const name = op?.name ?? op ?? "?";
      const t = Date.now();
      const memberOp = kind === "mutate" && ["memberAdd", "memberRemove", "promoteAdmin", "leaveChat", "sendText"].includes(name);
      let logged = false;
      const timer = setTimeout(() => {
        logged = true;
        slow(name, kind, t, `STALLED >1000ms args=${JSON.stringify(args).slice(0, 120)} `);
      }, 1000);
      try {
        const r = fn.call(c, op, args, ...rest);
        if (r && typeof (r as any).then === "function") {
          return (r as any).then(
            (v: any) => {
              clearTimeout(timer);
              if (logged || memberOp) slow(name, kind, t, `resolved@${Date.now()} state=${JSON.stringify((v as any)?.state ?? (v as any)?.read?.denied ?? "ok")} seq=${(v as any)?.seq ?? "-"} `);
              return v;
            },
            (e: any) => {
              clearTimeout(timer);
              slow(name, kind, t, `rejected@${Date.now()} ${String(e).slice(0, 120)} `);
              throw e;
            }
          );
        }
        clearTimeout(timer);
        return r;
      } catch (e: any) {
        clearTimeout(timer);
        slow(name, kind, t, `threw@${Date.now()} ${String(e).slice(0, 120)} `);
        throw e;
      }
    };
  return new Proxy(c, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if ((prop === "mutate" || prop === "query" || prop === "asset" || prop === "upload") && typeof v === "function") return wrap(prop as string, v);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

export function ClientGate({ children }: { children: React.ReactNode }) {
  const url = useMemo(() => serverUrl(), []);
  const [client, setClient] = useState<any>(null);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const storeRef = useRef<any>(null);
  if (!storeRef.current) storeRef.current = sessionStore();

  const adopt = useCallback(
    async (s: Session) => {
      const device = await openDevice();
      const store = storeRef.current;
      let c: any;
      if (device) {
        c = await createLocalClient({ url, session: s, sessionStore: store, device, assets: { keep: "viewed", maxBytes: 64 * 1024 * 1024 } });
        setOnlineOnly(false);
      } else {
        c = createClient({ url, session: s });
        setOnlineOnly(true);
      }
      if (process.env.EXPO_PUBLIC_DEBUG_DELIVERY === "1") {
        c = instrumentClient(c);
        try {
          (window as any).__sbClient = c;
          (window as any).__sbApi = api;
        } catch {}
      }
      setClient((prev: any) => {
        try { prev?.close?.(); } catch {}
        return c;
      });
      setSession(s);
    },
    [url]
  );

  const clientRef = useRef<any>(null);
  clientRef.current = client;
  const restore = useCallback(async () => {
    try {
      const kept = await restoreSession(url, storeRef.current);
      if (kept && !clientRef.current) await adopt(kept);
    } catch {}
    setReady(true);
  }, [adopt, url]);
  useEffect(() => {
    void restore();
    // A mid-load offline window fails device/session adoption with no
    // client; retry on reconnect (genuinely signed-out users have no kept
    // session, so this is a no-op for them). The first retry can race
    // network readiness, so stagger follow-ups while still clientless.
    const timers: ReturnType<typeof setTimeout>[] = [];
    const onOnline = () => {
      if (clientRef.current) return;
      void restore();
      for (const ms of [2000, 5000, 10000]) {
        timers.push(setTimeout(() => {
          if (!clientRef.current) void restore();
        }, ms));
      }
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      for (const t of timers) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const signUp = useCallback(
    async (email: string, password: string) => {
      const r = await authSignup(url, email, password);
      if ((r as any).ok) await adopt((r as any).session);
      return r as any;
    },
    [adopt, url]
  );
  const signIn = useCallback(
    async (email: string, password: string) => {
      const r = await authLogin(url, email, password);
      if ((r as any).ok) await adopt((r as any).session);
      return r as any;
    },
    [adopt, url]
  );
  const signOut = useCallback(async () => {
    try {
      if (session) await authLogout(url, session.token);
    } catch {}
    try { await client?.signOut?.(); } catch {}
    try { await forgetSession(url, storeRef.current); } catch {}
    try { client?.close?.(); } catch {}
    setClient(null);
    setSession(null);
  }, [client, session, url]);

  const value = useMemo(
    () => ({ client, onlineOnly, session, signInWithSession: adopt, signUp, signIn, signOut, url }),
    [client, onlineOnly, session, adopt, signUp, signIn, signOut, url]
  );
  if (!ready) return null;
  // When signed out, every route renders the auth form (which needs no
  // provider), so a signed-out deep route never crashes on client hooks.
  if (!client)
    return (
      <Ctx.Provider value={value}>
        <AuthScreen />
      </Ctx.Provider>
    );
  return (
    <Ctx.Provider value={value}>
      <SnapbackProvider client={client}>{children}</SnapbackProvider>
    </Ctx.Provider>
  );
}

export function AuthScreen() {
  const ctx = useAppClient();
  const [mode, setMode] = useState<"sign-up" | "sign-in">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const submit = async (e: string, p: string) => {
    setSubmitting(true);
    setError(undefined);
    try {
      const r = mode === "sign-up" ? await ctx.signUp(e.trim(), p) : await ctx.signIn(e.trim(), p);
      if (!(r as any).ok) {
        const why = (r as any).why;
        setError(why?.code ? `Authentication failed: ${why.code}` : "Authentication failed");
      }
    } catch (err: any) {
      setError(`Authentication failed: ${err?.message ?? err}`);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <View style={{ flex: 1, justifyContent: "center", backgroundColor: "#fff" }}>
      <AuthForm
        mode={mode}
        email={email}
        password={password}
        onChangeEmail={setEmail}
        onChangePassword={setPassword}
        onSubmit={submit}
        onToggleMode={() => {
          setMode(mode === "sign-up" ? "sign-in" : "sign-up");
          setError(undefined);
        }}
        errorText={error}
        submitting={submitting}
      />
    </View>
  );
}

export function useAuthedClient() {
  const v = useAppClient();
  if (!v.client) throw new Error("no client");
  return v.client;
}
