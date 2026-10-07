import { matchRead, existence, isReady } from "snapback4/contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, FlatList, Image, Text, TextInput, View } from "react-native";
import { useClient, useSeen, useLink, useMutation, usePendingWrite, usePendingWrites, usePage, useQuery, useViewer } from "snapback4/react";
import { mintId } from "snapback4/client";
import { IntentJournal, intentOutcome, type Intent, type Proposal } from "./intents";
import { intentStorage } from "./intent-store";
import type { Write } from "snapback4/contract";
import { api } from "../snapback/generated/api";
import { useOnlineArm } from "./useOnlineArm";
import { useTyping } from "./useTyping";
import { useOnceMedia } from "./useOnceMedia";
import { PhotoPicker } from "./ui";
import { QuotedMessage } from "./QuotedMessage";
import { useJumpToMessage } from "./useJumpToMessage";

// @ref LLP 3000.028#8 — route and composer ownership do not follow query status.
export function ConversationScreen({ conversation, url, visible = true, ownerKey = conversation, proposed, other }: { conversation: string; url: string; visible?: boolean; ownerKey?: string; proposed?: string; other?: string }) {
  const viewer = useViewer();
  return viewer ? <OwnedConversation key={JSON.stringify([url, viewer, ownerKey])} conversation={conversation} url={url} visible={visible} viewer={viewer} proposed={proposed} other={other} /> : null;
}
function OwnedConversation({ conversation, url, visible, viewer, proposed, other }: { conversation: string; url: string; visible: boolean; viewer: string; proposed?: string; other?: string }) {
  const client = useClient(), link = useLink();
  const online = useOnlineArm(url);
  const typing = useTyping(online, conversation);
  // SDK default: plain revalidation retains; change evidence is bounded.
  // We never retain a previous answer in application state.
  const room = useQuery(api.conversationScreen, { conversation });
  const member = useQuery(api.receiptMember, { conversation }, { keep: false });
  const pending = usePendingWrites(api.send);
  const sending = useMutation(api.send);
  const [draft, setDraft] = useState(""), [problem, setProblem] = useState("");
  const [photo, setPhoto] = useState<string>();
  const [replyTo, setReplyTo] = useState<string>();
  const [selected, setSelected] = useState<{ message: string; asset: string }>();
  const journal = useMemo(() => new IntentJournal(intentStorage, url, viewer,
    () => client.viewer() === viewer && client.link() !== "signed-out"), [client, url, viewer]);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const destinations = new Set([conversation, proposed, ...proposals.filter(p => p.canonical === conversation).map(p => p.proposed)]);
  const [outcomes, setOutcomes] = useState<Record<string, Write>>({});
  const [submitting, setSubmitting] = useState<string>();
  const lifetime = useRef({ active: true, admitting: false });
  useEffect(() => {
    const owner = { active: true, admitting: false }; lifetime.current = owner;
    return () => { owner.active = false; };
  }, [journal]);
  const restore = useCallback(() => {
    try {
      journal.prune();
      const saved = journal.proposals(); setProposals(saved);
      const ids = new Set([conversation, proposed, ...saved.filter(p => p.canonical === conversation).map(p => p.proposed)]);
      setIntents(journal.read().filter(i => ids.has(i.args.conversation)));
    }
    catch (error) { setProblem(`Could not read saved sends: ${String(error)}`); }
  }, [journal, conversation, proposed]);
  useEffect(restore, [restore]);
  const resolve = useCallback((other: string, canonical: string) => {
    try { journal.resolve(other, canonical); restore(); }
    catch (error) { setProblem(`Could not save conversation association: ${String(error)}`); }
  }, [journal, restore]);
  const dismiss = useCallback((id: string) => {
    try {
      journal.forget(id); restore();
      setOutcomes(saved => { const next = { ...saved }; delete next[id]; return next; });
    }
    catch (error) { setProblem(String(error)); }
  }, [journal, restore]);
  const currentMember = isReady(member) && member.existence === "present" && !member.revalidating;
  // Custody is not authority: only a confirmed absence/refusal blocks a send.
  const canSend = matchRead(member, { denied: () => false, absent: read => !read.fresh || !!read.revalidating, partial: () => true, otherwise: () => true });
  useEffect(() => { setSelected(undefined); }, [conversation]);
  useEffect(() => { if (!visible) typing.stop(); }, [visible]);
  async function send() {
    const owner = lifetime.current;
    if (!owner.active || owner.admitting || !canSend || (!draft.trim() && !photo)) return;
    const intent: Intent = { id: mintId(), args: { conversation, text: draft, photo: photo ? { id: photo } : null, replyTo: replyTo ?? null } };
    // UI references are saved before dispatch; only the SDK owns replay.
    try { journal.remember(intent, conversation === proposed ? other : undefined); setProposals(journal.proposals()); }
    catch (error) { setProblem(`Not sent; draft kept: ${String(error)}`); return; }
    owner.admitting = true; setSubmitting(intent.id); typing.stop(); setProblem("");
    setIntents(saved => [...saved, intent]); setDraft(""); setPhoto(undefined); setReplyTo(undefined);
    try {
      const write = await sending.run(intent.args, { id: intent.id, waitSeconds: 0 });
      if (owner.active) setOutcomes(saved => ({ ...saved, [intent.id]: write }));
    } catch (error) { if (owner.active) setProblem(`Outcome unknown: ${String(error)}`); }
    finally { if (owner.active) { owner.admitting = false; setSubmitting(undefined); } }
  }
  return <View style={{ flex: 1, minHeight: 0, padding: 16 }} testID="conversation-screen">
    {proposals.some(p => !p.canonical) && <ResolveProposal conversation={conversation} resolve={resolve} />}
    <Text accessibilityRole="header">{matchRead(room, { present: data => data.title, denied: () => "Conversation", partial: () => "Conversation", otherwise: () => "Conversation" })}</Text>
    <Text>{matchRead(room, { loading: () => "Loading…", denied: why => why.message, partial: () => "Partial results", otherwise: () => "" })}</Text><Text>{link}</Text>
    {/* Composer lives above every transient read and the recycled message list. */}
    {replyTo && <View><QuotedMessage id={replyTo} /><Button title="Cancel reply" onPress={() => setReplyTo(undefined)} /></View>}
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
        setReplyTo(current => args.replyTo ?? current);
      }} attachmentBusy={!!photo} />)}
    <Text>{pending.filter(write => destinations.has(write.args.conversation)).length} pending sends</Text>
    {!canSend && <Text>You are no longer a member. Your draft stays here.</Text>}
    {canSend && (!currentMember || ("data" in member && !member.fresh)) && <Text>Membership is being checked. You can queue a message.</Text>}
    <Text>{"data" in typing.read && typing.read.data.length ? "Someone is typing…" : ""}</Text>
    {selected && <OnceViewer key={selected.asset} {...selected} onClose={() => setSelected(undefined)} />}
    <History key={conversation} conversation={conversation} visible={visible} select={setSelected} reply={setReplyTo} />
  </View>;
}

// One reverse lookup for this route, regardless of how many other peers have saved sends.
// Keys are immutable identity references; they confer no membership authority.
function ResolveProposal({ conversation, resolve }: { conversation: string; resolve(other: string, canonical: string): void }) {
  const pair = useQuery(api.directPeer, { conversation });
  const other = "data" in pair && !pair.revalidating && pair.data && !pair.data.pending ? pair.data.peer : null;
  useEffect(() => { if (other) resolve(other, conversation); }, [other, conversation, resolve]);
  return null;
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

type HistoryProps = { conversation: string; visible: boolean; select(value: { message: string; asset: string }): void; reply(id: string): void };
// A short row must fit; a row taller than the viewport must fill the viewport.
const viewabilityConfig = { viewAreaCoveragePercentThreshold: 100 };
function History(props: HistoryProps) {
  const jump = useJumpToMessage(props.conversation);
  const receipts = usePage(api.messageReceipts, { conversation: props.conversation, through: jump.through }, { keep: false });
  const decorations = matchRead(receipts.read, { present: data => data, denied: () => [], partial: data => data, otherwise: () => [] });
  // A receipt withdrawal can reset its cursor chain while history stays put.
  useEffect(() => {
    if (receipts.hasMore && decorations.length < jump.rows.length) receipts.loadMore();
  }, [receipts.hasMore, receipts.loadMore, decorations.length, jump.rows.length]);
  const byId = new Map(decorations.map(row => [row.id, row.receipt]));
  const newest = Math.max(0, ...jump.rows.filter(row => !row.pending && jump.viewed.has(row.id)).map(row => row.ordinal));
  useSeen(api.receiptFamilies.chat, { scope: props.conversation, through: newest, active: props.visible });
  return <View style={{ flex: 1, minHeight: 0 }}>
    <Text>{matchRead(jump.page.read, { loading: () => "Loading…", denied: why => why.message, partial: () => "Partial results", otherwise: () => "" })}</Text>
    <Text>{matchRead(receipts.read, { loading: () => "Loading…", denied: why => why.message, partial: () => "Partial results", otherwise: () => "" })}</Text>
    <Text accessibilityLiveRegion="polite">{jump.jumping ? "Finding quoted message…" : jump.problem}</Text>
    {jump.through !== null && <Button title="Latest messages" onPress={jump.latest} />}
    <View ref={jump.viewport} collapsable={false} onLayout={jump.onLayout} style={{ flex: 1, minHeight: 0 }}>
    {isReady(jump.page.read) && <FlatList ref={jump.bindList} testID="history" style={{ flex: 1 }} data={jump.rows} keyExtractor={row => row.id}
      onViewableItemsChanged={jump.onViewableItemsChanged} viewabilityConfig={viewabilityConfig}
      onScrollToIndexFailed={jump.onScrollToIndexFailed} onContentSizeChange={jump.onLayout}
      onScroll={jump.onScroll} scrollEventThrottle={16} onScrollBeginDrag={jump.cancel} onTouchStart={jump.cancel}
      {...jump.webScrollHandlers} extraData={[jump.highlighted, jump.completed]}
      renderItem={({ item: row }) => <View testID={`message-${row.id}`} nativeID={jump.completed === row.id ? `jump-completed-${row.id}` : undefined}
        ref={node => { if (node) jump.bubbles.current.set(row.id, node); else jump.bubbles.current.delete(row.id); }}
        collapsable={false} onLayout={jump.onLayout} accessibilityLabel={jump.highlighted === row.id ? "Highlighted message" : undefined}
        style={{ padding: 8, backgroundColor: jump.highlighted === row.id ? "#ffe89a" : "transparent" }}>
        {row.replyTo && <QuotedMessage id={row.replyTo} onJump={jump.onJump} />}
        <View ref={node => { if (node) jump.bodies.current.set(row.id, node); else jump.bodies.current.delete(row.id); }}
          collapsable={false} onLayout={jump.onLayout} testID={`jump-body-${row.id}`}>
        <Text>{row.text}{row.pending ? " · Sending…" : byId.has(row.id) ? ` · ${byId.get(row.id)}` : ""}</Text>
        <Button title="Reply" disabled={!!row.pending} onPress={() => props.reply(row.id)} />
        {row.photo && <Button title="View once photo" onPress={() => props.select({ message: row.id, asset: row.photo!.id })} />}
        </View>
      </View>} />}
    </View>
    <Button title="Older messages" disabled={!jump.page.hasMore} onPress={() => { jump.page.loadMore(); receipts.loadMore(); }} />
  </View>;
}

export function OnceViewer({ message, asset, onClose }: { message: string; asset: string; onClose(): void }) {
  const media = useOnceMedia();
  const row = useQuery(api.messagePhoto, { id: message }, { keep: false });
  const invalid = existence(row) === "denied" || existence(row) === "absent" || (isReady(row) && row.existence === "present" && row.data.photo?.id !== asset);
  const ended = useRef(false); ended.current ||= invalid;
  useEffect(() => { if (invalid) { media.close(); onClose(); } }, [invalid, media.close, onClose]);
  return <View testID="once-viewer">
    <Button title="Close photo" onPress={() => { media.close(); onClose(); }} />
    {media.view?.url ? <Image accessibilityLabel="Once photo" source={{ uri: media.view.url }} style={{ width: 240, height: 240 }} /> :
      <Button title="Open media" disabled={!!media.view || ended.current || !isReady(row) || row.existence !== "present" || row.revalidating} onPress={() => void media.open(asset)} />}
    <Text>{media.view?.problem}</Text>
  </View>;
}
