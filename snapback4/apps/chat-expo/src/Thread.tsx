import { useRef, useState } from "react";
import { Button, FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { usePendingWrite, usePage, useViewer } from "snapback4/react";
import { api } from "../../chat/snapback/generated/api";

// A screen is a query plus JSX; every word it reads is on the card: data,
// complete, fresh, since, next, pending.
export function Thread({ conversationId, onBack }: { conversationId: string; onBack(): void }) {
  const viewer = useViewer();
  const { items, hasMore, loadMore, read } = usePage(api.thread, { conversationId });
  const send = usePendingWrite(api.send);
  const [body, setBody] = useState("");
  const [unsent, setUnsent] = useState<{ revision: number; body: string; message: string }[]>([]);
  const revision = useRef(0);
  const submit = async () => {
    const text = body.trim();
    if (!text || send.inFlight) return;
    const submitted = revision.current;
    const outcome = await send.run({ conversationId, body: text });
    if (outcome.state === "failed") {
      if (revision.current !== submitted) setUnsent((drafts) => [...drafts, { revision: submitted, body: text, message: outcome.why.message }]);
    } else if (revision.current === submitted) { revision.current++; setBody(""); }
  };
  return <View style={styles.thread}>
    <View style={styles.header}>
      <Button title="Back" onPress={onBack} />
      {"data" in read && !read.fresh ? <Text style={styles.note}>As of {read.since ? new Date(read.since).toLocaleTimeString() : "the last sync"}</Text> : null}
    </View>
    {"denied" in read ? <Text style={styles.alert}>{read.denied.message}</Text> : null}
    <FlatList
      inverted
      data={items}
      keyExtractor={(message) => message.id}
      onEndReached={hasMore ? loadMore : undefined}
      renderItem={({ item }) => (
        <View style={[styles.bubble, item.authorId === viewer ? styles.own : null, item.pending ? styles.pending : null]}>
          <Text>{item.body}</Text>
          <Text style={styles.note}>{item.pending ? "Sending…" : new Date(item.at).toLocaleTimeString()}</Text>
        </View>
      )}
    />
    <View style={styles.composer}>
      <TextInput style={styles.input} value={body} onChangeText={(text) => { revision.current++; setBody(text); }} placeholder="Message" />
      <Button title="Send" disabled={send.inFlight || !body.trim()} onPress={() => { void submit(); }} />
    </View>
    {send.last?.state === "failed" ? <Text style={styles.alert}>Not sent: {send.last.why.message}</Text> : null}
    {send.pending ? <Text style={styles.note}>{send.inFlight ? "Sending…" : "Queued on this device."}</Text> : null}
    {unsent.map((draft) => <View key={draft.revision}>
      <Text style={styles.alert}>Not sent: {draft.message}</Text>
      <Text selectable>{draft.body}</Text>
      <Button title="Dismiss unsent draft" onPress={() => setUnsent((drafts) => drafts.filter((d) => d !== draft))} />
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  thread: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8 },
  bubble: { alignSelf: "flex-start", backgroundColor: "#eee", borderRadius: 12, marginHorizontal: 12, marginVertical: 4, maxWidth: "80%", padding: 10 },
  own: { alignSelf: "flex-end", backgroundColor: "#d6e8ff" },
  pending: { opacity: 0.6 },
  composer: { flexDirection: "row", alignItems: "center", padding: 8, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#ccc" },
  input: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderColor: "#aaa", borderRadius: 8, padding: 8, marginRight: 8 },
  note: { color: "#666", fontSize: 12 },
  alert: { color: "#b00", padding: 12 },
});
