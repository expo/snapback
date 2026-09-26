import { useRef } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { isReady } from "snapback4/contract";
import { useQuery } from "snapback4/react";
import { api } from "../../chat/snapback/generated/api";

export function Inbox({ onSelect }: { onSelect(id: string): void }) {
  const inbox = useQuery(api.inbox, {});
  const answered = useRef(false);
  if (isReady(inbox)) answered.current = true;
  return <View style={{ flex: 1 }}>
    {"loading" in inbox ? <Text style={styles.note}>{answered.current ? "Updating…" : "Loading…"}</Text> : null}
    {"denied" in inbox ? <Text style={styles.note}>{inbox.denied.message}</Text> : null}
    {isReady(inbox) && !inbox.complete ? <Text style={styles.note}>Conversations may be incomplete.</Text> : null}
    <FlatList data={isReady(inbox) ? inbox.data : []}
      keyExtractor={row => row.conversationId}
      ListEmptyComponent={isReady(inbox) ? <Text style={styles.note}>No conversations yet.</Text> : null}
      renderItem={({ item }) => <Pressable style={styles.row} onPress={() => onSelect(item.conversationId)}>
        <Text style={styles.name}>{item.conversation?.title ?? item.conversationId}</Text>
        <Text style={styles.count}>{item.count ?? "–"}</Text>
      </Pressable>}
    />
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#ddd" },
  name: { fontSize: 16 },
  count: { color: "#666" },
  note: { color: "#666", padding: 16 },
});
