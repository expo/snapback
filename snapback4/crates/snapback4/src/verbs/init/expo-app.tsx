import { useState } from "react";
import { Button, SafeAreaView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { AppProvider, useAuth, useLink } from "snapback4/react";
import { app, tier } from "./src/client";
import { Inbox } from "./src/Inbox";
import { Thread } from "./src/Thread";

export function App() {
  return <AppProvider app={app}><SafeAreaView style={{ flex: 1 }}>
    <StatusBar style="auto" /><Account />
  </SafeAreaView></AppProvider>;
}
function Account() {
  const auth = useAuth();
  const [problem, setProblem] = useState("");
  if (auth.state === "restoring") return <Text>Restoring your account…</Text>;
  if (auth.state === "signed-in") return <Home />;
  return <View><Text>{problem || auth.why?.message || "Welcome"}</Text>
    <Button title="Continue as a guest" onPress={() => { void auth.guest().then(result => { if (!result.ok) setProblem(result.why.message); }); }} />
  </View>;
}
function Home() {
  const [selected, setSelected] = useState<string>();
  const [problem, setProblem] = useState("");
  const auth = useAuth(), link = useLink();
  return <View style={{ flex: 1 }}>
    <Text>Snapback 4 chat · {tier} · {link}</Text><Text>{auth.viewer}</Text>
    {problem && <Text>{problem}</Text>}
    <Button title="Sign out" onPress={() => { void auth.logout().then(result => { if (!result.ok) setProblem(result.why.message); }); }} />
    {selected ? <Thread conversationId={selected} onBack={() => setSelected(undefined)} /> : <Inbox onSelect={setSelected} />}
  </View>;
}
