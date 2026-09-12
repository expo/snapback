import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { isReady } from "snapback4/contract";
import { useQuery } from "snapback4/react";
import { api } from "../../chat/snapback/generated/api";

export function Inbox({ onSelect }: { onSelect(id: string): void }) {
  const inbox = useQuery(api.inbox, {});
  if (!isReady(inbox)) return <Text style={styles.note}>{"denied" in inbox ? inbox.denied.message : "Loading…"}</Text>;
  return <FlatList
    data={inbox.data}
    keyExtractor={(row) => row.conversationId}
    ListEmptyComponent={<Text style={styles.note}>No conversations yet.</Text>}
    renderItem={({ item }) => (
      <Pressable style={styles.row} onPress={() => onSelect(item.conversationId)}>
        <Text style={styles.name}>{item.conversation?.title ?? item.conversationId}</Text>
        <Text style={styles.count}>{item.count}</Text>
      </Pressable>
    )}
  />;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#ddd" },
  name: { fontSize: 16 },
  count: { color: "#666" },
  note: { color: "#666", padding: 16 },
});
