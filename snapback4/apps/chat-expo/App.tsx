import { useEffect, useState } from "react";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import type { Client } from "snapback4/contract";
import { SnapbackProvider, useLink } from "snapback4/react";
import { openClient } from "./src/client";
import { Inbox } from "./src/Inbox";
import { Thread } from "./src/Thread";
import { runWitness } from "./src/witness";

// The local-first tier on a phone: the device holds the viewer's partition
// in SQLite (expo-sqlite), reads run locally, writes queue durably, the
// session is kept in the secure store. `snapback4 dev` serves
// apps/chat/snapback/schema.q; EXPO_PUBLIC_SNAPBACK_URL names it.

export function App() {
  const [client, setClient] = useState<Client | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live: Client | null = null;
    let disposed = false;
    const close = () => { disposed = true; void live?.close(); };
    if (process.env.EXPO_PUBLIC_WITNESS_URL) {
      runWitness(process.env.EXPO_PUBLIC_WITNESS_URL).catch((e: Error) => { if (!disposed) setProblem(`witness: ${e.message}`); });
      return close;
    }
    openClient().then((c) => {
      if (disposed) { void c.close(); return; }
      live = c;
      setClient(c);
    }, (e: Error) => { if (!disposed) setProblem(e.message); });
    return close;
  }, []);
  return <SafeAreaView style={styles.screen}>
    <StatusBar style="auto" />
    {problem ? <Text style={styles.alert}>{problem}</Text> : client ? <SnapbackProvider client={client}><Home /></SnapbackProvider> : <Text style={styles.note}>Opening your replica…</Text>}
  </SafeAreaView>;
}

function Home() {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const link = useLink();
  return <View style={styles.home}>
    <View style={styles.bar}>
      <Text style={styles.title}>Snapback 4 chat</Text>
      <Text style={styles.note}>{link === "online" ? "Online" : link === "offline" ? "Offline" : "Signed out"} · local-first · SQLite</Text>
    </View>
    {selected ? <Thread conversationId={selected} onBack={() => setSelected(undefined)} /> : <Inbox onSelect={setSelected} />}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  home: { flex: 1 },
  bar: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#ccc" },
  title: { fontSize: 18, fontWeight: "600" },
  note: { color: "#666", fontSize: 12 },
  alert: { color: "#b00", padding: 16 },
});
