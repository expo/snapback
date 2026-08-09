// Placeholder product page for https://snapback.expo.app — the real
// content lives at /guide (docs projection) until a fuller site exists.
import { View, Text, Pressable, StyleSheet, Linking, Platform } from "react-native";

const open = (url) =>
  Platform.OS === "web" ? (window.location.href = url) : Linking.openURL(url);

export default function Home() {
  return (
    <View style={s.page}>
      <View style={s.card}>
        <Text style={s.logo}>Snapback</Text>
        <Text style={s.tag}>
          The scale-to-zero backend for agent-built apps: server-authoritative
          data, live queries, ephemeral realtime, typed assets, and honest
          offline — with first-party Expo, React, Swift, and headless clients.
        </Text>
        <View style={s.row}>
          <Pressable style={s.btn} onPress={() => open("/guide/")}>
            <Text style={s.btnText}>Read the guide</Text>
          </Pressable>
          <Pressable style={[s.btn, s.btnAlt]} onPress={() => open("/docs/")}>
            <Text style={[s.btnText, s.btnTextAlt]}>Docs</Text>
          </Pressable>
        </View>
        <Text style={s.code}>npm create snapback-app@latest</Text>
        <Text style={s.foot}>
          Agents: start at <Text style={s.mono}>/llms.txt</Text>
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: {
    flex: 1,
    minHeight: "100vh",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0b0d12",
    padding: 24,
  },
  card: { maxWidth: 640, width: "100%" },
  logo: { color: "#f4f6fb", fontSize: 44, fontWeight: "700", marginBottom: 16 },
  tag: { color: "#aab3c5", fontSize: 17, lineHeight: 26, marginBottom: 28 },
  row: { flexDirection: "row", gap: 12, marginBottom: 28 },
  btn: {
    backgroundColor: "#4f7cff",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  btnAlt: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#39435a" },
  btnText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  btnTextAlt: { color: "#c6cede" },
  code: {
    color: "#8be9a8",
    fontFamily: "Menlo, ui-monospace, monospace",
    fontSize: 14,
    backgroundColor: "#131722",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: "flex-start",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#1f2635",
  },
  foot: { fontSize: 13, color: "#5d6880" },
  mono: { fontFamily: "Menlo, ui-monospace, monospace", color: "#8fa1c7" },
});
