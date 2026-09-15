import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SnapbackProvider } from "snapback4/react";
import type { AppClient } from "./client";
import { restoreClient, signIn, signOut, signUp } from "./client";
import { DeliverySync } from "./DeliverySync";

interface SessionCtx {
  client: AppClient | null;
  booting: boolean;
  error: string | null;
  register: (email: string, password: string) => Promise<string | null>;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

export function useSessionGate(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("SessionGate missing");
  return v;
}

export function SessionGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [client, setClient] = useState<AppClient | null>(null);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    restoreClient().then(
      (c) => {
        if (cancelled) {
          void c?.close();
          return;
        }
        setClient(c);
        setBooting(false);
      },
      (e: Error) => {
        if (!cancelled) {
          setError(e.message);
          setBooting(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const result = await signUp(email, password);
    if (!result.ok) return result.error;
    setClient(result.client);
    setError(null);
    return null;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await signIn(email, password);
    if (!result.ok) return result.error;
    setClient(result.client);
    setError(null);
    return null;
  }, []);

  const logout = useCallback(async () => {
    if (client) await signOut(client);
    setClient(null);
  }, [client]);

  const value = useMemo(
    () => ({ client, booting, error, register, login, logout }),
    [client, booting, error, register, login, logout],
  );

  if (booting) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Ctx.Provider value={value}>
      {client ? (
        <SnapbackProvider client={client}>
          <DeliverySync />
          {children}
        </SnapbackProvider>
      ) : (
        children
      )}
    </Ctx.Provider>
  );
}
