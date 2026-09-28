import { useCallback, useEffect, useRef, useState } from "react";
import { Button, FlatList, Image, Text, TextInput, View, type ViewToken } from "react-native";
import { useClient, useLink, useMutation, usePage, usePendingWrites, useQuery } from "snapback4/react";
import type { ResultOf } from "snapback4/contract";
import { api } from "../snapback/generated/api";
import { useOnlineArm } from "./useOnlineArm";
import { useTyping } from "./useTyping";
import { useOnceMedia } from "./useOnceMedia";
import { ReadState, PhotoPicker } from "./ui";

// @ref LLP 3000.028#8 — route and composer ownership do not follow query status.
export function ConversationScreen({ conversation, url, visible = true }: { conversation: string; url: string; visible?: boolean }) {
  const client = useClient(), link = useLink();
  const online = useOnlineArm(url);
  const typing = useTyping(online, conversation);
  // Explicit retention choice: use the SDK's bounded one-second default.
  // We never retain a previous answer in application state.
  const room = useQuery(api.conversationScreen, { conversation });
  const member = useQuery(api.receiptMember, { conversation }, { keep: false });
  const history = usePage(api.history, { conversation });
  const pending = usePendingWrites(api.send);
  const sending = useMutation(api.send);
  const [draft, setDraft] = useState(""), [problem, setProblem] = useState("");
  const [photo, setPhoto] = useState<string>(), [submitted, setSubmitted] = useState("");
  const [selected, setSelected] = useState<{ message: string; asset: string }>();
  const [viewed, setViewed] = useState<Set<string>>(() => new Set());
  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<ResultOf<typeof api.history>[number]>[] }) => {
    setViewed(new Set(viewableItems.filter(item => item.isViewable).map(item => item.item.id)));
  }, []);
  const seen = useRef(0);
  const canSend = "data" in member && !!member.data && !member.revalidating;
  const newest = Math.max(0, ...history.items.filter(row => !row.pending && viewed.has(row.id)).map(row => row.ordinal));
  useEffect(() => {
    // Delivery is SDK-owned. Only actually visible, settled text reports seen.
    if (!visible || !canSend || newest <= seen.current || !("data" in history.read) || history.read.revalidating) return;
    const through = newest; seen.current = through;
    void client.mutate(api.seen, { conversation, through }).then(write => {
      if (write.state === "failed" && seen.current === through) seen.current = 0;
    });
  }, [client, conversation, visible, canSend, newest, history.read]);
  useEffect(() => { if (!visible) typing.stop(); }, [visible]);
  async function send() {
    if (!canSend || sending.inFlight || (!draft.trim() && !photo)) return;
    const text = draft, image = photo; typing.stop(); setSubmitted(text); setProblem("");
    setDraft(""); setPhoto(undefined);
    try {
      const write = await sending.run({ conversation, text, photo: image ? { id: image } : null }, { waitSeconds: 0 });
      if (write.state === "failed") {
        setDraft(current => current || text); setPhoto(current => current ?? image);
        setProblem(`${write.why.message} — unsent text: ${text}`);
      }
    } catch (error) { setProblem(String(error)); }
  }
  return <View style={{ flex: 1, padding: 16 }} testID="conversation-screen">
    <Text accessibilityRole="header">{"data" in room && room.data ? room.data.title : "Conversation"}</Text>
    <ReadState read={room} /><Text>{link}</Text>
    {/* Composer lives above every transient read and the recycled message list. */}
    <TextInput testID="composer" accessibilityLabel="Message" value={draft} multiline
      onChangeText={text => { setDraft(text); typing.change(text); }} onBlur={typing.stop} />
    <Button title="Send" disabled={!canSend || sending.inFlight} onPress={() => void send()} />
    <PhotoPicker title={photo ? "Replace once photo" : "Attach once photo"} onUploaded={setPhoto} />
    {photo && <Button title="Remove attachment" onPress={() => setPhoto(undefined)} />}
    <Text>{problem}</Text>
    {sending.last?.state === "failed" && <View><Text>{sending.last.why.message}: {submitted}</Text>
      <Button title="Edit unsent text" onPress={() => setDraft(current => current ? `${current} ${submitted}` : submitted)} /></View>}
    <Text>{pending.filter(write => write.args.conversation === conversation).length} pending sends</Text>
    {!canSend && <Text>Membership unavailable or left: your draft stays here; sending needs a current membership.</Text>}
    <Text>{"data" in typing.read && typing.read.data.length ? "Someone is typing…" : ""}</Text>
    {selected && <OnceViewer key={selected.asset} {...selected} onClose={() => setSelected(undefined)} />}
    <ReadState read={history.read} />
    <FlatList testID="history" data={history.items} keyExtractor={row => row.id} onViewableItemsChanged={onViewableItemsChanged}
      renderItem={({ item: row }) => <View testID={`message-${row.id}`}>
        <Text>{row.text}{row.pending ? " · Sending…" : ""}</Text>
        {row.photo && <Button title="View once photo" onPress={() => setSelected({ message: row.id, asset: row.photo!.id })} />}
      </View>} />
    <Button title="Older messages" disabled={!history.hasMore} onPress={history.loadMore} />
    <Decorations conversation={conversation} />
  </View>;
}

function Decorations({ conversation }: { conversation: string }) {
  const receipts = useQuery(api.messageReceipts, { conversation, c: null }, { keep: false });
  return <View testID="receipts"><ReadState read={receipts} />
    {"data" in receipts && receipts.data.map(row => <Text key={row.id}>{row.id}: {row.receipt}</Text>)}
  </View>;
}

export function OnceViewer({ message, asset, onClose }: { message: string; asset: string; onClose(): void }) {
  const media = useOnceMedia();
  const row = useQuery(api.messagePhoto, { id: message }, { keep: false });
  const invalid = "denied" in row || ("data" in row && (!row.data || row.data.photo?.id !== asset));
  const ended = useRef(false); ended.current ||= invalid;
  useEffect(() => { if (invalid) { media.close(); onClose(); } }, [invalid, media.close, onClose]);
  return <View testID="once-viewer">
    <Button title="Close photo" onPress={() => { media.close(); onClose(); }} />
    {media.view?.url ? <Image accessibilityLabel="Once photo" source={{ uri: media.view.url }} style={{ width: 240, height: 240 }} /> :
      <Button title="Open media" disabled={!!media.view || ended.current || !("data" in row) || row.revalidating} onPress={() => void media.open(asset)} />}
    <Text>{media.view?.problem}</Text>
  </View>;
}
