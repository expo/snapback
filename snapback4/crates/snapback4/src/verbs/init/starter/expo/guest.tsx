import { useState } from "react";
import { Button, SafeAreaView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { AppProvider, useAuth } from "snapback4/react";
import { app } from "./src/client";
import { useNativeSmokeGuest } from "./src/native-smoke";

export function App() {
  return <AppProvider app={app}><SafeAreaView style={{ flex: 1 }}>
    <StatusBar style="auto" /><Account />
  </SafeAreaView></AppProvider>;
}

// Every read and write runs as the signed-in viewer, so sign in first.
function Account() {
  useNativeSmokeGuest();
  const auth = useAuth();
  const [problem, setProblem] = useState("");
  if (auth.state === "restoring") return <Text style={{ padding: 24 }}>Restoring your session…</Text>;
  if (auth.state === "signed-in") return <Todos />;
  const signIn = async () => {
    const result = await auth.guest();
    if (!result.ok) setProblem(result.why.message);
  };
  return <View style={{ padding: 24, gap: 12 }}>
    <Text style={{ fontSize: 24 }}>Sign in</Text>
    <Text>{problem || auth.why?.message || "Signed out"}</Text>
    <Button title="Continue as a guest" onPress={() => void signIn()} />
  </View>;
}
