import React, { Fragment, useState, type ReactNode } from "react";
import { Button, SafeAreaView, Text, TextInput } from "react-native";
import { useAuth } from "snapback2/react-native";

export function Auth({ children }: { children: ReactNode }) {
  const { session, actions } = useAuth();
  const viewer = session.viewer ?? session.restoringViewer;
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await action(); setPassword(""); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={{ flex: 1, padding: 16 }}>
    {viewer ? <><Text selectable>{session.state === "authenticated" ? "Signed in as" : "Restoring"} {viewer} ({session.kind ?? "account"})</Text><Button title="Log out" disabled={busy} onPress={() => void run(actions.logout)} /></> : <>
      <Text>Welcome</Text><TextInput accessibilityLabel="Email" placeholder="Email" keyboardType="email-address" autoCapitalize="none" autoComplete="username" value={email} onChangeText={setEmail} />
      <TextInput accessibilityLabel="Password" placeholder="Password" secureTextEntry autoComplete="current-password" value={password} onChangeText={setPassword} />
      <Button title="Log in" disabled={busy || !email || !password} onPress={() => void run(() => actions.login({ email, password }))} />
      <Button title="Sign up" disabled={busy || !email || !password} onPress={() => void run(() => actions.signup({ email, password }))} />
      <Button title="Continue as guest" disabled={busy} onPress={() => void run(actions.guest)} />
    </>}
    {session.state === "hydrating" ? <Text accessibilityLiveRegion="polite">Restoring session…</Text> : null}
    {error || session.refusal ? <Text accessibilityRole="alert">{error || session.refusal?.message}</Text> : null}
    {viewer ? <Fragment key={viewer}>{children}</Fragment> : null}
  </SafeAreaView>;
}
