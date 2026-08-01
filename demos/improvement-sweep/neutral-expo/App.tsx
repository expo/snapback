import { useState } from "react";
import { StatusBar } from "expo-status-bar";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

type ScreenName = "notebook" | "event";

function TopBar({ title, eyebrow }: { title: string; eyebrow: string }) {
  return (
    <View style={styles.topbar}>
      <View>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
      </View>
      <View style={styles.statusRow}>
        <Text style={styles.status} testID="connection-state">Online</Text>
        <Text style={[styles.status, styles.stale]} testID="freshness-state">
          Fresh
        </Text>
      </View>
    </View>
  );
}

function NotebookScreen() {
  const records = [
    ["Transformer vault reading", "Alice · Today · 1 attachment", true],
    ["North fence corrosion pass", "Bob · Tomorrow", false],
    ["Pump house vibration log", "Alice · Friday", false],
  ] as const;
  return (
    <View style={styles.screen} testID="notebook-screen">
      <TopBar title="Offline field notebook" eyebrow="A1" />
      <Pressable style={styles.primary} testID="notebook-add-record">
        <Text style={styles.primaryLabel}>Add record</Text>
      </Pressable>
      <ScrollView>
        {records.map(([title, meta, done], index) => (
          <View key={title} style={styles.row} testID={`notebook-record-${index}`}>
            <View style={[styles.check, done && styles.checked]} />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>{title}</Text>
              <Text style={styles.rowMeta}>{meta}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
      <Text style={styles.footNote} testID="notebook-queue-state">
        All changes settled
      </Text>
    </View>
  );
}

function EventScreen() {
  return (
    <View style={styles.screen} testID="event-screen">
      <TopBar title="Event and invitation" eyebrow="A4" />
      <View style={styles.eventArt} testID="event-art">
        <Text style={styles.eventArtLabel}>SUMMER{"\n"}SUPPER</Text>
      </View>
      <Text style={styles.rowTitle}>Summer Supper Club</Text>
      <Text style={styles.rowMeta}>Saturday · 6:30 PM · Oakland, California</Text>
      <View style={styles.rsvpRow} testID="event-rsvp-controls">
        {["Going", "Maybe", "Can’t go"].map((label) => (
          <Pressable key={label} style={styles.rsvpButton}>
            <Text>{label}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.footNote} testID="event-guest-count">
        49 / 50 attending
      </Text>
      <Text style={styles.rowMeta} testID="event-wall">
        Bob — Bringing dessert!
      </Text>
      <TextInput
        style={styles.composer}
        placeholder="Post to the event wall…"
        testID="event-wall-composer"
      />
    </View>
  );
}

export function App() {
  const [screen, setScreen] = useState<ScreenName>("notebook");
  return (
    <View style={styles.frame}>
      <StatusBar style="dark" />
      {screen === "notebook" ? <NotebookScreen /> : <EventScreen />}
      <View style={styles.tabRow}>
        {(["notebook", "event"] as const).map((name) => (
          <Pressable
            key={name}
            onPress={() => setScreen(name)}
            style={[styles.tab, screen === name && styles.tabActive]}
            testID={`navigate-${name}`}
          >
            <Text style={screen === name ? styles.tabLabelActive : styles.tabLabel}>
              {name}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: "#eceee8", paddingTop: 64 },
  screen: { flex: 1, paddingHorizontal: 20 },
  topbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
  },
  eyebrow: {
    color: "#69736e",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: { fontSize: 24, fontWeight: "700", letterSpacing: -0.5 },
  statusRow: { flexDirection: "row", gap: 8 },
  status: {
    backgroundColor: "#dff6df",
    color: "#24622e",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    fontSize: 12,
    overflow: "hidden",
  },
  stale: { backgroundColor: "#f6eddf", color: "#7a5a24" },
  primary: {
    backgroundColor: "#22372f",
    borderRadius: 9,
    paddingVertical: 12,
    alignItems: "center",
    marginBottom: 14,
  },
  primaryLabel: { color: "white", fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e8e1",
  },
  rowBody: { flex: 1 },
  rowTitle: { fontWeight: "700" },
  rowMeta: { color: "#727b76", fontSize: 13, marginTop: 3 },
  check: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderColor: "#aab3ad",
    borderRadius: 6,
    backgroundColor: "white",
  },
  checked: { backgroundColor: "#8fcf58" },
  footNote: { color: "#63716a", fontSize: 13, marginVertical: 12 },
  eventArt: {
    height: 180,
    borderRadius: 16,
    backgroundColor: "#c965a8",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  eventArtLabel: {
    color: "white",
    fontSize: 34,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: -1.5,
  },
  rsvpRow: { flexDirection: "row", gap: 8, marginVertical: 14 },
  rsvpButton: {
    borderWidth: 1,
    borderColor: "#cbd2c8",
    backgroundColor: "white",
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  composer: {
    borderWidth: 1,
    borderColor: "#cbd2c8",
    backgroundColor: "white",
    borderRadius: 11,
    padding: 13,
    marginTop: 8,
  },
  tabRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#dfe3db",
    backgroundColor: "#f9faf6",
  },
  tab: { flex: 1, alignItems: "center", paddingVertical: 16 },
  tabActive: { backgroundColor: "#e9ede5" },
  tabLabel: { color: "#69736e", textTransform: "capitalize" },
  tabLabelActive: { color: "#17231f", fontWeight: "700", textTransform: "capitalize" },
});
