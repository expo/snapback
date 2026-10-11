import { useEffect, useState, type ReactNode } from "react";
import { Button, SafeAreaView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import type { App as SnapbackApp } from "snapback4/app";
import { AppProvider, useAuth } from "snapback4/react";
import { openApp, personas } from "./src/client";

export function App() {
  return <SafeAreaView style={{ flex: 1 }}><StatusBar style="auto" /><Personas /></SafeAreaView>;
}

// Each persona gets its own app (and device store); switching closes the old one.
function Personas() {
  const [persona, setPersona] = useState<string | null>(null);
  const [app, setApp] = useState<SnapbackApp | null>(null);
  useEffect(() => {
    if (!persona) return;
    const opened = openApp(persona);
    setApp(opened);
    return () => { setApp(null); void opened.close(); };
  }, [persona]);
  if (!persona) return <View style={{ padding: 24, gap: 12 }}>
    <Text style={{ fontSize: 24 }}>Act as</Text>
    {personas.map(name => <Button key={name} title={name} onPress={() => setPersona(name)} />)}
  </View>;
  if (!app) return <Text style={{ padding: 24 }}>Opening…</Text>;
  return <AppProvider app={app}><Account leave={() => setPersona(null)}><Todos /></Account></AppProvider>;
}

// Every read and write runs as the persona; there is no session to restore.
function Account({ leave, children }: { leave: () => void; children: ReactNode }) {
  const auth = useAuth();
  if (auth.state === "signed-in") return children;
  return <View style={{ padding: 24, gap: 12 }}>
    <Text>{auth.state === "restoring" ? "Opening…" : auth.why?.message ?? "Signed out"}</Text>
    <Button title="Choose a persona" onPress={leave} />
  </View>;
}
