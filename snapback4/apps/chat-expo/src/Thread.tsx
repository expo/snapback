import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { mintId } from "snapback4/client";
import type { Write } from "snapback4/contract";
import { useClient, usePendingWrite, usePage, useViewer } from "snapback4/react";
import { api } from "../../chat/snapback/generated/api";
import { IntentJournal, clearSubmitted, intentOutcome, type Intent } from "./intents";
import { intentStorage } from "./intent-store";

type Props = { conversationId: string; backend: string; onBack(): void };
export function Thread(props: Props) {
  const viewer = useViewer();
  return viewer ? <OwnedThread key={JSON.stringify([props.backend, viewer, props.conversationId])} {...props} viewer={viewer} /> : null;
}

function OwnedThread({ conversationId, backend, onBack, viewer }: Props & { viewer: string }) {
  const client = useClient();
  const { items, hasMore, loadMore, read } = usePage(api.thread, { conversationId });
  const answered = useRef(false);
  if ("data" in read) answered.current = true;
  const journal = useMemo(() => new IntentJournal(intentStorage, backend, viewer,
    () => client.viewer() === viewer && client.link() !== "signed-out"), [client, backend, viewer]);
  const [body, setBody] = useState("");
  const [intents, setIntents] = useState<Intent[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, Write>>({});
  const [problem, setProblem] = useState("");
  const [admitting, setAdmitting] = useState(false);
  const lifetime = useRef({ active: true, admitting: false });
  useEffect(() => {
    const owner = { active: true, admitting: false }; lifetime.current = owner;
    try { setIntents(journal.read().filter(i => i.room === conversationId)); }
    catch (error) { setProblem(`Could not read saved writes: ${String(error)}`); }
    return () => { owner.active = false; };
  }, [journal, conversationId]);
  const submit = async () => {
    const owner = lifetime.current, submitted = body, text = body.trim();
    if (!owner.active || owner.admitting || !text) return;
    const intent: Intent = { id: mintId(), room: conversationId, op: "send", body: text };
    const current = () => owner.active && client.viewer() === viewer && client.link() !== "signed-out";
    try {
      // Save before dispatch. A crash in this gap leaves an unknown receipt;
      // only the SDK owns replay, under the original ID and arguments.
      journal.remember(intent);
      setIntents(saved => [...saved, intent]);
      owner.admitting = true; setAdmitting(true); setProblem("");
      const outcome = await client.mutate(api.send, { conversationId, body: text }, { id: intent.id, waitSeconds: 0 });
      if (!current()) return;
      setOutcomes(saved => ({ ...saved, [intent.id]: outcome }));
      if (outcome.state !== "failed") setBody(current => clearSubmitted(current, submitted));
    } catch (error) {
      if (current()) setProblem(`Could not confirm this write. Keep the draft and check the conversation before sending again. ${String(error)}`);
    } finally { if (current()) { owner.admitting = false; setAdmitting(false); } }
  };
  const dismiss = useCallback((id: string) => {
    try { journal.forget(id); setIntents(saved => saved.filter(i => i.id !== id)); }
    catch (error) { setProblem(String(error)); }
  }, [journal]);
  return <View style={styles.thread}>
    <View style={styles.header}>
      <Button title="Back" onPress={onBack} />
      {"data" in read && !read.fresh ? <Text style={styles.note}>As of {read.since ? new Date(read.since).toLocaleTimeString() : "the last sync"}</Text> : null}
    </View>
    {"loading" in read ? <Text style={styles.note}>{answered.current ? "Updating…" : "Loading…"}</Text> : null}
    {"denied" in read ? <Text style={styles.alert}>{read.denied.message}</Text> : null}
    {"data" in read && !read.complete ? <Text style={styles.note}>History may be incomplete.</Text> : null}
    <FlatList inverted data={"data" in read ? items : []}
      keyExtractor={message => message.id} onEndReached={hasMore ? loadMore : undefined}
      renderItem={({ item }) => <View style={[styles.bubble, item.authorId === viewer ? styles.own : null, item.pending ? styles.pending : null]}>
        <Text>{item.body}</Text><Text style={styles.note}>{item.pending ? "Sending…" : new Date(item.at).toLocaleTimeString()}</Text>
      </View>}
    />
    <View style={styles.composer}>
      <TextInput style={styles.input} value={body} onChangeText={setBody} placeholder="Message" />
      <Button title="Send" disabled={admitting || !body.trim()} onPress={() => { void submit(); }} />
    </View>
    {problem ? <Text style={styles.alert}>{problem}</Text> : null}
    <View accessibilityLabel="Writes"><Text>Writes</Text>
      {intents.map(intent => <Receipt key={intent.id} intent={intent} outcome={outcomes[intent.id]} dismiss={dismiss} edit={setBody} />)}
    </View>
  </View>;
}

function Receipt({ intent, outcome, dismiss, edit }: { intent: Intent; outcome?: Write; dismiss(id: string): void; edit(body: string): void }) {
  const receipt = usePendingWrite(api.send, intent.id);
  const write = receipt.last && receipt.last.state !== "pending" ? receipt.last : outcome ?? receipt.last;
  useEffect(() => { if (write?.state === "sent") dismiss(intent.id); }, [write?.state, intent.id, dismiss]);
  if (write?.state === "sent") return null;
  return <View>
    <Text style={write?.state === "failed" ? styles.alert : styles.note}>{intentOutcome(write)}</Text>
    {write?.state === "failed" ? <><Text selectable>{intent.body}</Text><Button title="Edit" onPress={() => edit(intent.body)} /></> : null}
    {write?.state !== "pending" ? <Button title="Dismiss" onPress={() => dismiss(intent.id)} /> : null}
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
