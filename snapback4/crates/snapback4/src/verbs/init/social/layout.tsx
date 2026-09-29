import { useState } from "react";
import { Button, Text, TextInput, View } from "react-native";
import { Stack } from "expo-router";
import { AppProvider, useAuth } from "snapback4/react";
import { app, tier } from "../src/client";

export default function RootLayout() {
  return <AppProvider app={app}><Account /></AppProvider>;
}
function Account() {
  const auth = useAuth();
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [problem, setProblem] = useState(""), [busy, setBusy] = useState(false);
  async function signIn(kind: "guest" | "login" | "signup") {
    setBusy(true); setProblem("");
    const result = kind === "guest" ? await auth.guest() : await auth[kind](email, password);
    if (!result.ok) setProblem(result.why.message);
    setBusy(false);
  }
  if (auth.state === "restoring") return <Text>Restoring account…</Text>;
  // Plain profile revalidation retains data; actual invalidation still leaves
  // navigation owned by this signed-in identity.
  if (auth.state === "signed-in") return <Stack>
    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    <Stack.Screen name="conversation/[id]" options={{ title: "Conversation" }} />
    <Stack.Screen name="search-chat/[id]" options={{ title: "Search this chat" }} />
  </Stack>;
  return <View style={{ padding: 24, gap: 12 }}><Text>Small social · {tier}</Text>
    <TextInput accessibilityLabel="Email" value={email} onChangeText={setEmail} autoCapitalize="none" />
    <TextInput accessibilityLabel="Password" value={password} onChangeText={setPassword} secureTextEntry />
    <Button title="Sign up" disabled={busy} onPress={() => void signIn("signup")} />
    <Button title="Log in" disabled={busy} onPress={() => void signIn("login")} />
    <Button title="Continue as a guest" disabled={busy} onPress={() => void signIn("guest")} />
    <Text>{problem || auth.why?.message}</Text>
  </View>;
}
