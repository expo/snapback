import { useState } from "react";
import { Button, SafeAreaView, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { AppProvider, useAuth } from "snapback4/react";
import { useNativeSmokeGuest } from "./src/native-smoke";
import { app } from "./src/client";

export function App() { return <AppProvider app={app}><SafeAreaView style={{ flex: 1 }}><StatusBar style="auto" /><Account /></SafeAreaView></AppProvider>; }
function Account() {
  useNativeSmokeGuest();
  const auth = useAuth();
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [problem, setProblem] = useState(""), [busy, setBusy] = useState(false);
  if (auth.state === "restoring") return <Text>Restoring your session…</Text>;
  if (auth.state === "signed-in") return <Todos />;
  async function submit(signup: boolean) {
    setBusy(true); setProblem("");
    try { const result = await (signup ? auth.signup(email, password) : auth.login(email, password)); if (!result.ok) setProblem(result.why.message); }
    catch { setProblem("Sign-in failed; retry."); } finally { setBusy(false); }
  }
  return <View style={{ padding: 24, gap: 12 }}><Text>Sign in</Text>
    <TextInput accessibilityLabel="Email" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} />
    <TextInput accessibilityLabel="Password" secureTextEntry autoComplete="current-password" value={password} onChangeText={setPassword} />
    <Button title="Sign in" disabled={busy} onPress={() => void submit(false)} /><Button title="Sign up" disabled={busy} onPress={() => void submit(true)} />
    <Text accessibilityRole="alert">{problem || auth.why?.message}</Text>
  </View>;
}
