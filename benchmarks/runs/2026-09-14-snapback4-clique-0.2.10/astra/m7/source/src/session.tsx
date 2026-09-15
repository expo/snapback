import React, { createContext, useContext, useEffect, useState } from "react";
import { router } from "expo-router";
import { View, Text, TextInput } from "react-native";
import { createLocalClient } from "snapback4/local";
import { signup, login } from "snapback4/auth";
import { SnapbackProvider } from "snapback4/react";
import { AuthForm } from "../ui";
import { api } from "../snapback/generated/api";
import { DeliveryObserver } from "./chat";
import { device, sessionStore } from "./device";
export const URL =
  process.env.EXPO_PUBLIC_BACKEND_URL || "http://127.0.0.1:49340";
const Ctx = createContext<any>(null);
export const useApp = () => useContext(Ctx);
export function Session({ children }: { children: React.ReactNode }) {
  const [client, setClient] = useState<any>(null),
    [ready, setReady] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [handle, setHandle] = useState(""),
    [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function open(session: any) {
    const c = await createLocalClient({
      url: URL,
      session,
      sessionStore,
      device: device(),
      assets: { keep: "viewed", maxBytes: 67108864 },
    });
    await sessionStore.set("clique-session", JSON.stringify(c.session()));
    c.onSession((s) => {
      if (s) sessionStore.set("clique-session", JSON.stringify(s));
      else {
        sessionStore.delete("clique-session");
        setClient(null);
      }
    });
    setClient(c);
    return c;
  }
  useEffect(() => {
    (async () => {
      try {
        const s = await sessionStore.get("clique-session");
        if (s) await open(JSON.parse(s));
      } catch (e: any) {
        setError(e.message);
      } finally {
        setReady(true);
      }
    })();
  }, []);
  async function auth() {
    setBusy(true);
    setError("");
    try {
      const r = await (mode === "sign-up" ? signup : login)(
        URL,
        email,
        password,
      );
      if (!r.ok) throw new Error(r.why.code + ": " + r.why.message);
      const c = await open(r.session);
      if (mode === "sign-up") {
        const w = await c.mutate(api.saveProfile, {
          handle,
          displayName: handle,
          bio: "",
          location: "",
          link: null,
        });
        if (w.state === "failed") {
          setError(w.why.code + ": " + w.why.message);
          router.replace("/profile/edit");
        }
      }
      setPassword("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    await client.signOut();
    await sessionStore.delete("clique-session");
    setClient(null);
  }
  if (!ready) return <Text>Opening Clique…</Text>;
  if (!client)
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          maxWidth: 520,
          width: "100%",
          alignSelf: "center",
        }}
      >
        {mode === "sign-up" && (
          <TextInput
            testID="sm-signup-handle"
            placeholder="Handle"
            value={handle}
            onChangeText={setHandle}
            style={{ padding: 20 }}
          />
        )}
        <AuthForm
          mode={mode}
          email={email}
          password={password}
          onChangeEmail={setEmail}
          onChangePassword={setPassword}
          onSubmit={auth}
          onToggleMode={() =>
            setMode(mode === "sign-in" ? "sign-up" : "sign-in")
          }
          submitting={busy}
          errorText={error}
        />
      </View>
    );
  return (
    <Ctx.Provider value={{ client, signOut, error, setError }}>
      <SnapbackProvider client={client}>
        <DeliveryObserver />
        {children}
      </SnapbackProvider>
    </Ctx.Provider>
  );
}
