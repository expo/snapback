import { presence, isReady } from "snapback4/contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, FlatList, Image, Text, TextInput, View, type ViewToken } from "react-native";
import { useClient, useLink, useMutation, usePendingWrite, usePendingWrites, useQuery, useViewer } from "snapback4/react";
import { mintId } from "snapback4/client";
import { IntentJournal, intentOutcome, type Intent } from "./intents";
import { intentStorage } from "./intent-store";
import type { Cursor, ResultOf, Write } from "snapback4/contract";
import { api } from "../snapback/generated/api";
import { useOnlineArm } from "./useOnlineArm";
import { useTyping } from "./useTyping";
import { useOnceMedia } from "./useOnceMedia";
import { PhotoPicker } from "./ui";

// @ref LLP 3000.028#8 — route and composer ownership do not follow query status.
export function ConversationScreen({ conversation, url, visible = true }: { conversation: string; url: string; visible?: boolean }) {
  const viewer = useViewer();
  return viewer ? <OwnedConversation key={JSON.stringify([url, viewer, conversation])} conversation={conversation} url={url} visible={visible} viewer={viewer} /> : null;
}
function OwnedConversation({ conversation, url, visible, viewer }: { conversation: string; url: string; visible: boolean; viewer: string }) {
  const client = useClient(), link = useLink();
  const online = useOnlineArm(url);
  const typing = useTyping(online, conversation);
  // Explicit retention choice: use the SDK's bounded one-second default.
  // We never retain a previous answer in application state.
  const room = useQuery(api.conversationScreen, { conversation });
  const member = useQuery(api.receiptMember, { conversation }, { keep: false });
  const pending = usePendingWrites(api.send);
  const sending = useMutation(api.send);
  const [draft, setDraft] = useState(""), [problem, setProblem] = useState("");
  const [photo, setPhoto] = useState<string>();
  const [selected, setSelected] = useState<{ message: string; asset: string }>();
  const journal = useMemo(() => new IntentJournal(intentStorage, url, viewer,
    () => client.viewer() === viewer && client.link() !== "signed-out"), [client, url, viewer]);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, Write>>({});
  const [submitting, setSubmitting] = useState<string>();
  const lifetime = useRef({ active: true, admitting: false });
  useEffect(() => {
    const owner = { active: true, admitting: false }; lifetime.current = owner;
    try { setIntents(journal.read().filter(i => i.args.conversation === conversation)); }
    catch (error) { setProblem(`Could not read saved sends: ${String(error)}`); }
    return () => { owner.active = false; };
  }, [journal, conversation]);
  const dismiss = useCallback((id: string) => {
    try {
      journal.forget(id); setIntents(saved => saved.filter(i => i.id !== id));
      setOutcomes(saved => { const next = { ...saved }; delete next[id]; return next; });
    }
    catch (error) { setProblem(String(error)); }
  }, [journal]);
  // No-horizon members share this conversation's messages audience. Loading is
  // first acquisition; only absence or refusal disables the durable send.
  const canSend = presence(member) !== "absent" && presence(member) !== "denied";
  const canReportSeen = isReady(member) && member.presence === "present" && !member.revalidating;
  const seen = useRef(0);
  const reportSeen = useCallback((through: number) => {
    if (!visible || !canReportSeen || through <= seen.current) return;
    seen.current = through;
    void client.mutate(api.seen, { conversation, through }).then(write => {
      if (write.state === "failed" && seen.current === through) seen.current = 0;
    });
  }, [client, conversation, visible, canReportSeen]);
  useEffect(() => { if (!visible) typing.stop(); }, [visible]);
  async function send() {
    const owner = lifetime.current;
    if (!owner.active || owner.admitting || !canSend || (!draft.trim() && !photo)) return;
    const intent: Intent = { id: mintId(), args: { conversation, text: draft, photo: photo ? { id: photo } : null } };
    // UI references are saved before dispatch; only the SDK owns replay.
    try { journal.remember(intent); }
    catch (error) { setProblem(`Not sent; draft kept: ${String(error)}`); return; }
    owner.admitting = true; setSubmitting(intent.id); typing.stop(); setProblem("");
    setIntents(saved => [...saved, intent]); setDraft(""); setPhoto(undefined);
    try {
      const write = await sending.run(intent.args, { id: intent.id, waitSeconds: 0 });
      if (owner.active) setOutcomes(saved => ({ ...saved, [intent.id]: write }));
    } catch (error) { if (owner.active) setProblem(`Outcome unknown: ${String(error)}`); }
    finally { if (owner.active) { owner.admitting = false; setSubmitting(undefined); } }
  }
  return <View style={{ flex: 1, padding: 16 }} testID="conversation-screen">
    <Text accessibilityRole="header">{isReady(room) && room.presence === "present" ? room.data.title : "Conversation"}</Text>
    <Text>{presence(room) === "loading" ? "Loading…" : presence(room) === "partial" ? "Partial results" : "denied" in room ? room.denied.message : ""}</Text><Text>{link}</Text>
    {/* Composer lives above every transient read and the recycled message list. */}
    <TextInput testID="composer" accessibilityLabel="Message" value={draft} multiline
      onChangeText={text => { setDraft(text); typing.change(text); }} onBlur={typing.stop} />
    <Button title="Send" disabled={!canSend || !!submitting} onPress={() => void send()} />
    <PhotoPicker title={photo ? "Replace once photo" : "Attach once photo"} onUploaded={setPhoto} />
    {photo && <Button title="Remove attachment" onPress={() => setPhoto(undefined)} />}
    <Text>{problem}</Text>
    {intents.map(intent => <SendSettlement key={intent.id} intent={intent} outcome={outcomes[intent.id]}
      submitting={submitting === intent.id} dismiss={dismiss} edit={args => {
        setDraft(current => current ? `${current} ${args.text}` : args.text);
        setPhoto(current => args.photo?.id ?? current);
      }} attachmentBusy={!!photo} />)}
    <Text>{pending.filter(write => write.args.conversation === conversation).length} pending sends</Text>
    {!canSend && <Text>Membership absent or refused: your draft stays here.</Text>}
    <Text>{"data" in typing.read && typing.read.data.length ? "Someone is typing…" : ""}</Text>
    {selected && <OnceViewer key={selected.asset} {...selected} onClose={() => setSelected(undefined)} />}
    <History conversation={conversation} reportSeen={reportSeen} select={setSelected} />
  </View>;
}

function SendSettlement({ intent, outcome, submitting, dismiss, edit, attachmentBusy }: {
  intent: Intent; outcome?: Write; submitting: boolean; dismiss(id: string): void;
  edit(args: Intent["args"]): void; attachmentBusy: boolean;
}) {
  const receipt = usePendingWrite(api.send, intent.id);
  const write = receipt.last && receipt.last.state !== "pending" ? receipt.last : outcome ?? receipt.last;
  useEffect(() => { if (write?.state === "sent") dismiss(intent.id); }, [write?.state, intent.id, dismiss]);
  if (write?.state === "sent") return null;
  const checking = !write && receipt.restoring;
  const actionable = !submitting && !checking && write?.state !== "pending";
  return <View testID={`send-${intent.id}`}>
    <Text>{submitting ? "Saving…" : checking ? "Checking…" : intentOutcome(write)}</Text>
    {actionable && <Text>{intent.args.text}{intent.args.photo ? " · Attached once photo" : ""}</Text>}
    {actionable && write?.state === "failed" && <Button title="Edit unsent message"
      disabled={attachmentBusy && !!intent.args.photo} onPress={() => edit(intent.args)} />}
    {actionable && <Button title="Dismiss" onPress={() => dismiss(intent.id)} />}
  </View>;
}

type HistoryProps = { conversation: string; reportSeen(through: number): void; select(value: { message: string; asset: string }): void };
function History(props: HistoryProps) {
  const [depth, setDepth] = useState(1);
  return <HistoryPage {...props} c={null} depth={depth} older={() => setDepth(n => n + 1)} prior={[]} />;
}
// Each receipt page uses its history page's cursor and index. No saved answers:
// a changed boundary replaces the suffix; decorations never gate the transcript.
function HistoryPage({ c, depth, older, prior, ...props }: HistoryProps & { c: Cursor | null; depth: number; older(): void; prior: string[] }) {
  const history = useQuery(api.history, { conversation: props.conversation, c });
  const receipts = useQuery(api.messageReceipts, { conversation: props.conversation, c }, { keep: false });
  const [viewed, setViewed] = useState<Set<string>>(() => new Set());
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<ResultOf<typeof api.history>[number]>[] }) => {
    setViewed(new Set(viewableItems.filter(item => item.isViewable).map(item => item.item.id)));
  }, []);
  const rows = useMemo(() => "data" in history ? history.data.filter(row => !prior.includes(row.id)) : [], [history, JSON.stringify(prior)]);
  const newest = Math.max(0, ...rows.filter(row => !row.pending && viewed.has(row.id)).map(row => row.ordinal));
  useEffect(() => { if ("data" in history && !history.revalidating) props.reportSeen(newest); }, [newest, history, props.reportSeen]);
  const byId = new Map("data" in receipts ? receipts.data.map(row => [row.id, row.receipt]) : []);
  const next = "data" in history ? history.next : null;
  return <View>
    <Text>{presence(history) === "loading" ? "Loading…" : presence(history) === "partial" ? "Partial results" : "denied" in history ? history.denied.message : ""}</Text><Text>{presence(receipts) === "loading" ? "Loading…" : presence(receipts) === "partial" ? "Partial results" : "denied" in receipts ? receipts.denied.message : ""}</Text>
    {"data" in history && <FlatList testID={c ? `history-${c}` : "history"} data={rows} keyExtractor={row => row.id} onViewableItemsChanged={onViewableItemsChanged}
      renderItem={({ item: row }) => <View testID={`message-${row.id}`}>
        <Text>{row.text}{row.pending ? " · Sending…" : byId.has(row.id) ? ` · ${byId.get(row.id)}` : ""}</Text>
        {row.photo && <Button title="View once photo" onPress={() => props.select({ message: row.id, asset: row.photo!.id })} />}
      </View>} />}
    {next && depth > 1 ? <HistoryPage key={next} {...props} c={next} depth={depth - 1} older={older} prior={[...prior, ...rows.map(row => row.id)]} /> :
      <Button title="Older messages" disabled={!next} onPress={older} />}
  </View>;
}

export function OnceViewer({ message, asset, onClose }: { message: string; asset: string; onClose(): void }) {
  const media = useOnceMedia();
  const row = useQuery(api.messagePhoto, { id: message }, { keep: false });
  const invalid = presence(row) === "denied" || presence(row) === "absent" || (isReady(row) && row.presence === "present" && row.data.photo?.id !== asset);
  const ended = useRef(false); ended.current ||= invalid;
  useEffect(() => { if (invalid) { media.close(); onClose(); } }, [invalid, media.close, onClose]);
  return <View testID="once-viewer">
    <Button title="Close photo" onPress={() => { media.close(); onClose(); }} />
    {media.view?.url ? <Image accessibilityLabel="Once photo" source={{ uri: media.view.url }} style={{ width: 240, height: 240 }} /> :
      <Button title="Open media" disabled={!!media.view || ended.current || !isReady(row) || row.presence !== "present" || row.revalidating} onPress={() => void media.open(asset)} />}
    <Text>{media.view?.problem}</Text>
  </View>;
}
