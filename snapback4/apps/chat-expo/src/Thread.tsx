import { presence } from "snapback4/contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { mintId } from "snapback4/client";
import type { Write } from "snapback4/contract";
import { useClient, usePendingWrite, usePage, useQuery, useViewer } from "snapback4/react";
import { api } from "../../chat/snapback/generated/api";
import { IntentJournal, intentOutcome, type Intent } from "./intents";
import { intentStorage } from "./intent-store";

type Props = { conversationId: string; backend: string; onBack(): void };
export function Thread(props: Props) {
  const viewer = useViewer();
  return viewer ? <OwnedThread key={JSON.stringify([props.backend, viewer, props.conversationId])} {...props} viewer={viewer} /> : null;
}

function OwnedThread({ conversationId, backend, onBack, viewer }: Props & { viewer: string }) {
  const client = useClient();
  const { items, hasMore, loadMore, read } = usePage(api.thread, { conversationId });
  // No-horizon membership shares the messages' group and audience; loading is acquisition.
  const membership = useQuery(api.myMembership, { conversationId });
  const member = presence(membership), blocked = member === "absent" || member === "denied";
  const answered = useRef(false);
  if ("data" in read) answered.current = true;
  const journal = useMemo(() => new IntentJournal(intentStorage, backend, viewer,
    () => client.viewer() === viewer && client.link() !== "signed-out"), [client, backend, viewer]);
  const [body, setBody] = useState("");
  const [intents, setIntents] = useState<Intent[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, Write>>({});
  const [problem, setProblem] = useState("");
  const [submitting, setSubmitting] = useState<string>();
  const lifetime = useRef({ active: true, admitting: false });
  useEffect(() => {
    const owner = { active: true, admitting: false }; lifetime.current = owner;
    try { setIntents(journal.read().filter(i => i.room === conversationId)); }
    catch (error) { setProblem(`Could not read saved writes: ${String(error)}`); }
    return () => { owner.active = false; };
  }, [journal, conversationId]);
  const submit = async () => {
    const owner = lifetime.current, submitted = body, text = body.trim();
    if (!owner.active || owner.admitting || blocked || !text) return;
    const intent: Intent = { id: mintId(), room: conversationId, op: "send", body: text };
    const current = () => owner.active && client.viewer() === viewer && client.link() !== "signed-out";
    // Save before dispatch. A crash in this gap leaves an unknown receipt;
    // only the SDK owns replay, under the original ID and arguments.
    try { journal.remember(intent); }
    catch { setProblem("Not sent: could not save it on this device; your draft is kept."); return; }
    try {
      setIntents(saved => [...saved, intent]);
      owner.admitting = true; setSubmitting(intent.id); setProblem("");
      setBody("");
      const outcome = await client.mutate(api.send, { conversationId, body: text }, { id: intent.id, waitSeconds: 0 });
      if (!current()) return;
      setOutcomes(saved => ({ ...saved, [intent.id]: outcome }));
      if (outcome.state === "failed") setBody(current => current || submitted);
    } catch (error) {
      if (current()) setProblem(`Could not confirm this write. Check the receipt and the conversation before sending again. ${String(error)}`);
    } finally { if (current()) { owner.admitting = false; setSubmitting(undefined); } }
  };
  const dismiss = useCallback((id: string) => {
    try {
      journal.forget(id);
      setIntents(saved => saved.filter(i => i.id !== id));
      setOutcomes(saved => { const next = { ...saved }; delete next[id]; return next; });
    }
    catch (error) { setProblem(String(error)); }
  }, [journal]);
  return <View style={styles.thread}>
    <View style={styles.header}>
      <Button title="Back" onPress={onBack} />
      {"data" in read && !read.fresh ? <Text style={styles.note}>As of {read.since ? new Date(read.since).toLocaleTimeString() : "the last sync"}</Text> : null}
    </View>
    {presence(read) === "loading" ? <Text style={styles.note}>{answered.current ? "Updating…" : "Loading…"}</Text> : null}
    {"denied" in read ? <Text style={styles.alert}>{read.denied.message}</Text> : null}
    {presence(read) === "partial" ? <Text style={styles.note}>History may be incomplete.</Text> : null}
    <FlatList inverted data={"denied" in read ? [] : items}
      keyExtractor={message => message.id} onEndReached={hasMore ? loadMore : undefined}
      renderItem={({ item }) => <View style={[styles.bubble, item.authorId === viewer ? styles.own : null, item.pending ? styles.pending : null]}>
        <Text>{item.body}</Text><Text style={styles.note}>{item.pending ? "Sending…" : new Date(item.at).toLocaleTimeString()}</Text>
      </View>}
    />
    <View style={styles.composer}>
      <TextInput style={styles.input} value={body} onChangeText={setBody} placeholder="Message" />
      <Button title="Send" disabled={blocked || !!submitting || !body.trim()} onPress={() => { void submit(); }} />
    </View>
    {"denied" in membership ? <Text style={styles.alert}>{membership.denied.message}</Text> : member === "absent" ? <Text style={styles.note}>Not a member. Your draft stays here.</Text> : null}
    {problem ? <Text style={styles.alert}>{problem}</Text> : null}
    <View accessibilityLabel="Writes"><Text>Writes</Text>
      {intents.map(intent => <Receipt key={intent.id} intent={intent} outcome={outcomes[intent.id]} submitting={submitting === intent.id} dismiss={dismiss} edit={text => setBody(current => current ? `${current} ${text}` : text)} />)}
    </View>
  </View>;
}

function Receipt({ intent, outcome, submitting, dismiss, edit }: { intent: Intent; outcome?: Write; submitting: boolean; dismiss(id: string): void; edit(body: string): void }) {
  const receipt = usePendingWrite(api.send, intent.id);
  const write = receipt.last && receipt.last.state !== "pending" ? receipt.last : outcome ?? receipt.last;
  useEffect(() => { if (write?.state === "sent") dismiss(intent.id); }, [write?.state, intent.id, dismiss]);
  if (write?.state === "sent") return null;
  const checking = !write && receipt.restoring;
  const actionable = !submitting && !checking && write?.state !== "pending";
  return <View>
    <Text style={write?.state === "failed" ? styles.alert : styles.note}>{submitting ? "Saving…" : checking ? "Checking…" : intentOutcome(write)}</Text>
    {actionable ? <Text selectable>{intent.body}</Text> : null}
    {actionable && write?.state === "failed" ? <Button title="Edit" onPress={() => edit(intent.body)} /> : null}
    {actionable ? <Button title="Dismiss" onPress={() => dismiss(intent.id)} /> : null}
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
